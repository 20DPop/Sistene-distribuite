// src/routes.js
const Router = require('@koa/router');
const { PassThrough } = require('stream');
const config = require("./config");
const auth = require("./auth");

// Modele
const User = require("./models/user.model");
const PokerGame = require("./models/pokerGame.model");
const HangmanGame = require("./models/hangmanGame.model");
const ChatMessage = require('./models/chatMessage.model');

// Servicii
const PokerService = require("./services/poker.service");
const HangmanService = require("./services/hangman.service");

// Module Comunicare
const { publisher: redisPublisher } = require('./redisClient');
const { getChannel: getRabbitChannel, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./rabbitClient');
const sseManager = require('./sseManager');

const routes = new Router({ prefix: '/api' });

// --- Ajutor Sincronizare Redis ---
async function publishGameState(gameId, gameState) {
    try {
        const channel = `game-updates:${gameId}`;
        await redisPublisher.publish(channel, JSON.stringify(gameState));
    } catch (error) {
        console.error(`[Redis Publish Error] ${gameId}:`, error);
    }
}

// --- Middleware Autentificare ---
routes.use(async (ctx, next) => {
    // Rute publice
    if (ctx.path === '/api/auth/register' || ctx.path === '/api/auth/login' || ctx.path === '/api/events') {
        return await next();
    }

    const token = ctx.cookies.get("token");
    if (!auth.isValidToken(token)) {
        ctx.status = 401;
        ctx.body = { success: false, error: "Sesiune expirată. Te rugăm să te autentifici." };
        return;
    }
    ctx.state.username = auth.getUsernameFromToken(token);
    await next();
});

// --- Rute Autentificare ---
routes.post('/auth/register', async (ctx) => {
    const { username, password } = ctx.request.body;
    const { errors } = await auth.registerUser(username, password);
    if (Object.keys(errors).length > 0) {
        ctx.status = 400;
        return ctx.body = { success: false, errors };
    }
    ctx.status = 201;
    ctx.body = { success: true, message: "Cont creat!" };
});

routes.post('/auth/login', async (ctx) => {
    const { username, password } = ctx.request.body;
    const { errors } = await auth.authenticateUser(username, password);
    if (Object.keys(errors).length > 0) {
        ctx.status = 401;
        return ctx.body = { success: false, errors };
    }
    const token = auth.createToken(username);
    ctx.cookies.set("token", token, config.cookieOptions);
    ctx.body = { success: true, username };
});

routes.post('/auth/logout', async (ctx) => {
    ctx.cookies.set("token", null);
    ctx.body = { success: true };
});

// --- SSE (Server-Sent Events) ---
routes.get('/events', async (ctx) => {
    const token = ctx.cookies.get("token");
    const username = auth.getUsernameFromToken(token);
    
    if (!username) {
        ctx.status = 401;
        return;
    }

    ctx.request.socket.setTimeout(0);
    ctx.req.socket.setNoDelay(true);
    ctx.req.socket.setKeepAlive(true);

    ctx.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const stream = new PassThrough();
    ctx.status = 200;
    ctx.body = stream;

    // Înregistrăm clientul pe acest nod
    await sseManager.addClient(username, ctx);

    ctx.req.on('close', () => {
        sseManager.removeClient(username);
    });
});

// --- Utilitare Utilizatori ---
routes.get('/users/online', async (ctx) => {
    const users = await sseManager.getGlobalOnlineUsers();
    ctx.body = { success: true, users };
});

// --- Rute POKER ---
routes.get('/poker/games', async (ctx) => {
    const games = await PokerGame.find({ inProgress: false });
    ctx.body = { success: true, games };
});

routes.post('/poker/create', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, options } = ctx.request.body;
    
    const existing = await PokerGame.findOne({ gameId });
    if (existing) { ctx.status = 400; return ctx.body = { success: false, error: "Numele mesei există deja." }; }

    const newGame = new PokerGame({
        gameId,
        creatorUsername: username,
        options: options || { smallBlind: 10, bigBlind: 20, maxPlayers: 9, minPlayers: 2 },
        players: [{ username, stack: 1000, status: 'waiting' }]
    });

    await newGame.save();
    ctx.body = { success: true, gameState: newGame };
});

routes.post('/poker/join', async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    const game = await PokerGame.findOne({ gameId });

    if (!game || game.players.length >= game.options.maxPlayers) {
        ctx.status = 400; return ctx.body = { success: false, error: "Nu te poți alătura." };
    }

    game.players.push({ username, stack: 1000, status: 'waiting' });
    await game.save();
    
    sseManager.joinRoom(username, gameId);
    await publishGameState(gameId, game);
    ctx.body = { success: true, gameState: game };
});

routes.post('/poker/action', async (ctx) => {
    const { gameId, action, amount } = ctx.request.body;
    const game = await PokerGame.findOne({ gameId });
    
    try {
        const updatedData = PokerService.handlePlayerAction(game, ctx.state.username, action, amount);
        // Optimistic Locking Check
        const result = await PokerGame.updateOne({ gameId, version: game.version }, updatedData);
        
        if (result.modifiedCount === 0) throw new Error("Conflict de versiune. Reîncearcă.");

        const finalState = await PokerGame.findOne({ gameId });
        await publishGameState(gameId, finalState);
        ctx.body = { success: true };
    } catch (e) {
        ctx.status = 400; ctx.body = { success: false, error: e.message };
    }
});

// --- Rute HANGMAN ---
routes.get('/hangman/games', async (ctx) => {
    const games = await HangmanGame.find({ status: 'waiting_for_guesser' });
    ctx.body = { success: true, games: games.map(g => HangmanService.getPublicState(g)) };
});

routes.post('/hangman/create', async (ctx) => {
    const { gameId } = ctx.request.body;
    const newGame = new HangmanGame({ gameId, hostUsername: ctx.state.username, players: [{username: ctx.state.username}] });
    await newGame.save();
    ctx.body = { success: true, gameState: HangmanService.getPublicState(newGame) };
});

routes.post('/hangman/join', async (ctx) => {
    const { gameId } = ctx.request.body;
    const game = await HangmanGame.findOne({ gameId });
    game.guesserUsername = ctx.state.username;
    game.players.push({ username: ctx.state.username });
    game.status = 'waiting_for_word';
    await game.save();
    
    sseManager.joinRoom(ctx.state.username, gameId);
    await publishGameState(gameId, HangmanService.getPublicState(game));
    ctx.body = { success: true };
});

routes.post('/hangman/action', async (ctx) => {
    const { gameId, letter } = ctx.request.body;
    const game = await HangmanGame.findOne({ gameId });
    const updated = HangmanService.handleGuess(game, letter);
    await updated.save();
    await publishGameState(gameId, HangmanService.getPublicState(updated));
    ctx.body = { success: true };
});

// --- Rute CHAT (DISTRIBUITE VIA RABBITMQ) ---

routes.post('/chat/global', async (ctx) => {
    const { message } = ctx.request.body;
    const data = { sender: ctx.state.username, message, timestamp: new Date() };
    getRabbitChannel().publish(GLOBAL_CHAT_EXCHANGE, '', Buffer.from(JSON.stringify(data)));
    ctx.body = { success: true };
});

routes.post('/chat/room/:roomId', async (ctx) => {
    const { message } = ctx.request.body;
    const { roomId } = ctx.params;
    const data = { room: roomId, sender: ctx.state.username, message, timestamp: new Date() };
    getRabbitChannel().publish(ROOM_CHAT_EXCHANGE, `room.${roomId}`, Buffer.from(JSON.stringify(data)));
    ctx.body = { success: true };
});

routes.post('/chat/private', async (ctx) => {
    const { to, message } = ctx.request.body;
    const data = { sender: ctx.state.username, to, message, timestamp: new Date() };
    getRabbitChannel().publish(ROOM_CHAT_EXCHANGE, `private.${to}`, Buffer.from(JSON.stringify(data)));
    ctx.body = { success: true };
});

routes.get('/chat/history/:room', async (ctx) => {
    const messages = await ChatMessage.find({ room: ctx.params.room }).sort({ createdAt: -1 }).limit(50);
    ctx.body = { success: true, messages: messages.reverse() };
});

module.exports = { routes };