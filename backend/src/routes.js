// src/routes.js
const Router = require('@koa/router');
const { PassThrough } = require('stream');
const config = require("./config");
const auth = require("./auth");

// Modele
const PokerGame = require("./models/pokerGame.model.js");
const HangmanGame = require("./models/hangmanGame.model.js"); // Nou
const ChatMessage = require('./models/chatMessage.model');

// Servicii
const PokerService = require("./services/poker.service.js");
const HangmanService = require("./services/hangman.service.js"); // Nou

// Module pentru comunicare
const { publisher: redisPublisher } = require('./redisClient');
const { getChannel: getRabbitChannel, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./rabbitClient');
const sseManager = require('./sseManager');

const routes = new Router({
    prefix: '/api'
});

// --- Funcție Helper ---
async function publishGameState(gameId, gameState) {
    try {
        const channel = `game-updates:${gameId}`;
        await redisPublisher.publish(channel, JSON.stringify(gameState));
    } catch (error) {
        console.error(`[Redis] Failed to publish game state for ${gameId}:`, error);
    }
}

// --- Middleware de Autentificare ---
routes.use(async (ctx, next) => {
    if (ctx.path.startsWith('/api/auth') || ctx.path === '/api/events') {
        await next();
        return;
    }
    const token = ctx.cookies.get("token");
    if (!auth.isValidToken(token)) {
        ctx.status = 401;
        ctx.body = { success: false, error: "Token invalid sau expirat." };
        return;
    }
    ctx.state.username = auth.getUsernameFromToken(token);
    await next();
});

// --- Rute de Autentificare ---
routes.post('/auth/register', async (ctx) => {
    const { username, password } = ctx.request.body;
    const { errors } = await auth.registerUser(username, password);
    if (Object.keys(errors).length > 0) {
        ctx.status = 400;
        return ctx.body = { success: false, errors };
    }
    ctx.status = 201;
    ctx.body = { success: true, message: "Cont creat cu succes!" };
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
    ctx.status = 200;
    ctx.body = { success: true, token };
});

// --- RUTA PENTRU SERVER-SENT EVENTS (SSE) ---
routes.get('/events', async (ctx) => {
    const token = ctx.cookies.get("token");
    const username = auth.getUsernameFromToken(token);
    if (!username) {
        ctx.status = 401;
        return ctx.body = "Unauthorized";
    }
    ctx.request.socket.setTimeout(0);
    ctx.req.socket.setNoDelay(true);
    ctx.req.socket.setKeepAlive(true);
    ctx.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const stream = new PassThrough();
    ctx.status = 200;
    ctx.body = stream;
    ctx.res = stream;
    sseManager.addClient(username, ctx);
    sseManager.sendEventToUser(username, 'connected', { message: `Welcome, ${username}!` });
    ctx.req.on('close', () => { sseManager.removeClient(username); });
});

// --- Rute pentru Poker ---
routes.get('/poker/games', async (ctx) => {
    const games = await PokerGame.find({ inProgress: false }, 'gameId creatorUsername players options.maxPlayers');
    const gamesList = games.map(game => ({ gameId: game.gameId, creatorUsername: game.creatorUsername, playerCount: game.players.length, maxPlayers: game.options.maxPlayers }));
    ctx.body = { success: true, games: gamesList };
});

routes.post('/poker/create', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, password, smallBlind, bigBlind, maxPlayers, stack } = ctx.request.body;
    if (await PokerGame.findOne({ gameId })) {
        ctx.status = 400;
        return ctx.body = { success: false, error: "O masă cu acest nume există deja." };
    }
    const newGame = new PokerGame({
        gameId, creatorUsername: username, password: password || null,
        options: { smallBlind: smallBlind || 10, bigBlind: bigBlind || 20, maxPlayers: maxPlayers || 9, minPlayers: 2 },
        players: [{ username, stack: stack || 1000, status: 'waiting' }]
    });
    await newGame.save();
    ctx.status = 201;
    ctx.body = { success: true, gameState: newGame.toObject() };
});

routes.post('/poker/join', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, password, stack } = ctx.request.body;
    const game = await PokerGame.findOne({ gameId }).select('+password');
    if (!game) { ctx.status = 404; return ctx.body = { success: false, error: "Masa nu există." }; }
    if (game.password && game.password !== password) { ctx.status = 403; return ctx.body = { success: false, error: "Parolă incorectă." }; }
    if (game.players.length >= game.options.maxPlayers) { ctx.status = 400; return ctx.body = { success: false, error: "Masa este plină." }; }
    if (game.players.some(p => p.username === username)) { ctx.status = 400; return ctx.body = { success: false, error: "Ești deja la această masă." }; }
    game.players.push({ username, stack: stack || 1000, status: 'waiting' });
    await game.save();
    const gameState = game.toObject();
    sseManager.joinRoom(username, gameId);
    await publishGameState(gameId, gameState);
    ctx.status = 200;
    ctx.body = { success: true, gameState };
});

routes.post('/poker/start', async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    let game = await PokerGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return; }
    if (game.creatorUsername !== username) { ctx.status = 403; return ctx.body = { success: false, error: "Doar creatorul poate porni jocul." }; }
    try {
        game = PokerService.startNewHand(game);
        await game.save();
        const gameState = game.toObject();
        await publishGameState(gameId, gameState);
        ctx.status = 200;
        ctx.body = { success: true, gameState };
    } catch (error) {
        ctx.status = 400;
        ctx.body = { success: false, error: error.message };
    }
});

routes.post('/poker/action', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, action, amount } = ctx.request.body;
    const game = await PokerGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return ctx.body = { success: false, error: "Jocul nu a fost găsit." }; }
    try {
        const updatedGame = PokerService.handlePlayerAction(game, username, action, amount);
        const result = await PokerGame.updateOne({ gameId, version: game.version }, updatedGame);
        if (result.modifiedCount === 0) {
            const freshGame = await PokerGame.findOne({ gameId });
            if (freshGame && freshGame.version !== game.version) {
                 throw new Error("Conflict de stare. Alt jucător a acționat. Starea a fost actualizată.");
            }
        }
        const finalGameState = await PokerGame.findOne({ gameId });
        await publishGameState(gameId, finalGameState.toObject());
        ctx.status = 200;
        ctx.body = { success: true, gameState: finalGameState.toObject() };
    } catch (error) {
        ctx.status = 400;
        ctx.body = { success: false, error: error.message };
    }
});

routes.post('/poker/leave/:gameId', async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.params;
    const game = await PokerGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return; }
    game.players = game.players.filter(p => p.username !== username);
    await game.save();
    sseManager.leaveRoom(username, gameId);
    await publishGameState(gameId, game.toObject());
    ctx.status = 200;
    ctx.body = { success: true, message: `Ai părăsit jocul ${gameId}` };
});

// --- Rute pentru Hangman (DISTRIBUITE) ---
routes.get('/hangman/games', async (ctx) => {
    const games = await HangmanGame.find({ status: 'waiting_for_guesser' });
    ctx.body = { success: true, games: games.map(g => HangmanService.getPublicState(g)) };
});

routes.post('/hangman/create', async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;

    if (await HangmanGame.findOne({ gameId })) {
        ctx.status = 400;
        return ctx.body = { success: false, error: "Numele jocului este deja luat." };
    }

    const newGame = new HangmanGame({
        gameId,
        hostUsername: username,
        players: [{ username }]
    });

    await newGame.save();
    ctx.status = 201;
    ctx.body = { success: true, gameState: HangmanService.getPublicState(newGame) };
});

routes.post('/hangman/join', async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;

    const game = await HangmanGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return ctx.body = { success: false, error: "Jocul nu există." }; }
    if (game.guesserUsername) { ctx.status = 400; return ctx.body = { success: false, error: "Jocul este plin." }; }

    game.guesserUsername = username;
    game.players.push({ username });
    game.status = 'waiting_for_word';

    await game.save();
    sseManager.joinRoom(username, gameId);
    await publishGameState(gameId, HangmanService.getPublicState(game));
    
    ctx.body = { success: true, gameState: HangmanService.getPublicState(game) };
});

routes.post('/hangman/set-word', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, word } = ctx.request.body;

    const game = await HangmanGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return; }
    if (game.hostUsername !== username) { ctx.status = 403; return ctx.body = { success: false, error: "Doar gazda poate pune cuvântul." }; }

    if (!word || word.length < 3) {
        ctx.status = 400;
        return ctx.body = { success: false, error: "Cuvântul trebuie să aibă minim 3 litere." };
    }

    game.secretWord = word.toUpperCase();
    game.status = 'in_progress';

    await game.save();
    await publishGameState(gameId, HangmanService.getPublicState(game));
    ctx.body = { success: true, gameState: HangmanService.getPublicState(game) };
});

routes.post('/hangman/action', async (ctx) => {
    const username = ctx.state.username;
    const { gameId, letter } = ctx.request.body;

    const game = await HangmanGame.findOne({ gameId });
    if (!game) { ctx.status = 404; return; }
    if (game.guesserUsername !== username) { ctx.status = 403; return ctx.body = { success: false, error: "Doar cel care ghicește poate face această acțiune." }; }

    try {
        const updatedGame = HangmanService.handleGuess(game, letter);
        await updatedGame.save();
        await publishGameState(gameId, HangmanService.getPublicState(updatedGame));
        ctx.body = { success: true, gameState: HangmanService.getPublicState(updatedGame) };
    } catch (error) {
        ctx.status = 400;
        ctx.body = { success: false, error: error.message };
    }
});

// --- Rute pentru Chat ---
routes.post('/chat/global', async (ctx) => {
    const username = ctx.state.username;
    const { message } = ctx.request.body;
    if (!message || !message.trim()) { ctx.status = 400; return; }
    const newChatMessage = new ChatMessage({ sender: username, message, room: 'global' });
    await newChatMessage.save();
    getRabbitChannel().publish(GLOBAL_CHAT_EXCHANGE, '', Buffer.from(JSON.stringify(newChatMessage.toObject())));
    ctx.status = 200;
    ctx.body = { success: true };
});

routes.post('/chat/room/:roomId', async (ctx) => {
    const username = ctx.state.username;
    const { roomId } = ctx.params;
    const { message } = ctx.request.body;
    if (!message || !message.trim()) { ctx.status = 400; return; }
    const newChatMessage = new ChatMessage({ sender: username, message, room: roomId });
    await newChatMessage.save();
    getRabbitChannel().publish(ROOM_CHAT_EXCHANGE, `room.${roomId}`, Buffer.from(JSON.stringify(newChatMessage.toObject())));
    ctx.status = 200;
    ctx.body = { success: true };
});

routes.get('/chat/history/:room', async (ctx) => {
    const { room } = ctx.params;
    const messages = await ChatMessage.find({ room }).sort({ createdAt: -1 }).limit(50);
    ctx.body = { success: true, messages: messages.reverse() };
});

module.exports = { routes };