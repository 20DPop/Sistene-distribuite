// src/routes.js - RUTE COMPLETE PENTRU SISTEM DISTRIBUIT
const Router = require('@koa/router');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Configurații și Module
const config = require('./config');
const sseManager = require('./sseManager');
const { publisher: redisPublisher } = require('./redisClient');
const { getChannel, isConnected, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./rabbitClient');

// Modele
const User = require('./models/user.model');
const ChatMessage = require('./models/chatMessage.model');
const PokerGame = require('./models/pokerGame.model');
const HangmanGame = require('./models/hangmanGame.model');

// Servicii
const { startNewHand, handlePlayerAction } = require('./services/poker.service');
const { getPublicState: getHangmanPublicState, handleGuess, handleSetWord } = require('./services/hangman.service');

const router = new Router();

// ============================================================================
// MIDDLEWARE - AUTENTIFICARE
// ============================================================================
const authMiddleware = async (ctx, next) => {
    const token = ctx.cookies.get('token');
    
    if (!token) {
        ctx.status = 401;
        ctx.body = { success: false, error: 'Unauthorized - No token provided' };
        return;
    }

    try {
        const decoded = jwt.verify(token, config.secretKey);
        ctx.state.username = decoded.username;
        await next();
    } catch (err) {
        console.error('[Auth Middleware] Token verification failed:', err.message);
        ctx.status = 401;
        ctx.body = { success: false, error: 'Unauthorized - Invalid token' };
    }
};

// ============================================================================
// RUTE - AUTENTIFICARE
// ============================================================================

// Register
router.post('/api/auth/register', async (ctx) => {
    const { username, password } = ctx.request.body;

    if (!username || username.length < 3) {
        ctx.status = 400;
        ctx.body = { success: false, errors: { username: "Username-ul trebuie să aibă cel puțin 3 caractere." } };
        return;
    }

    if (!password || password.length < 6) {
        ctx.status = 400;
        ctx.body = { success: false, errors: { password: "Parola trebuie să aibă cel puțin 6 caractere." } };
        return;
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            ctx.status = 400;
            ctx.body = { success: false, errors: { username: "Acest username este deja folosit." } };
            return;
        }

        const newUser = new User({ username, password });
        await newUser.save();

        console.log(`[Register] New user created: ${username}`);
        ctx.body = { success: true, message: 'User registered successfully' };
    } catch (err) {
        console.error('[Register] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, errors: { server: "Eroare la înregistrare." } };
    }
});

// Login
router.post('/api/auth/login', async (ctx) => {
    const { username, password } = ctx.request.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            ctx.status = 401;
            ctx.body = { success: false, errors: { auth: "Username sau parolă invalidă." } };
            return;
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            ctx.status = 401;
            ctx.body = { success: false, errors: { auth: "Username sau parolă invalidă." } };
            return;
        }

        // Creează token JWT
        const token = jwt.sign({ username }, config.secretKey, { expiresIn: '24h' });

        // Setează cookie
        ctx.cookies.set('token', token, config.cookieOptions);

        console.log(`[Login] User logged in: ${username}`);
        ctx.body = { success: true, username };
    } catch (err) {
        console.error('[Login] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, errors: { server: "Eroare la autentificare." } };
    }
});

// Logout
router.post('/api/auth/logout', async (ctx) => {
    ctx.cookies.set('token', '', { ...config.cookieOptions, maxAge: 0 });
    ctx.body = { success: true, message: 'Logged out successfully' };
});

// Verify Token
router.get('/api/auth/verify', authMiddleware, async (ctx) => {
    ctx.body = { success: true, username: ctx.state.username };
});

// ============================================================================
// RUTE - SSE (Server-Sent Events)
// ============================================================================
router.get('/api/events', authMiddleware, async (ctx) => {
    const username = ctx.state.username;

    console.log(`[SSE] Connection request from: ${username}`);

    // Setează headers pentru SSE
    ctx.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    ctx.status = 200;

    const stream = ctx.res;

    // Adaugă client în SSE Manager
    await sseManager.addClient(username, ctx, stream);

    // Keep-alive ping la fiecare 30 secunde
    const keepAliveInterval = setInterval(() => {
        try {
            stream.write(': ping\n\n');
        } catch (e) {
            console.log(`[SSE] Keep-alive failed for ${username}, cleaning up`);
            clearInterval(keepAliveInterval);
            sseManager.removeClient(username);
        }
    }, 30000);

    // Cleanup la deconectare
    ctx.req.on('close', () => {
        console.log(`[SSE] Connection closed for: ${username}`);
        clearInterval(keepAliveInterval);
        sseManager.removeClient(username);
    });

    ctx.req.on('error', (err) => {
        console.error(`[SSE] Connection error for ${username}:`, err.message);
        clearInterval(keepAliveInterval);
        sseManager.removeClient(username);
    });

    //  FIX CRITICA: Previne închiderea automată a conexiunii SSE
    // Promise care nu se rezolvă niciodată = conexiunea rămâne deschisă
    await new Promise(() => {
        // Această Promise nu se rezolvă niciodată
        // Menține conexiunea SSE deschisă indefinit
        // Cleanup se face automat prin event listeners ('close', 'error')
    });
});

// ============================================================================
// RUTE - UTILIZATORI
// ============================================================================
router.get('/api/users/online', authMiddleware, async (ctx) => {
    const users = await sseManager.getGlobalOnlineUsers();
    ctx.body = { success: true, users };
});

// ============================================================================
// RUTE - CHAT GLOBAL
// ============================================================================
router.post('/api/chat/global', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { message } = ctx.request.body;

    if (!message || message.trim() === '') {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Message cannot be empty' };
        return;
    }

    try {
        // Salvează în MongoDB
        const chatMessage = new ChatMessage({
            sender: username,
            message: message.trim(),
            room: 'global'
        });
        await chatMessage.save();

        // Publică în RabbitMQ pentru distribuție
        const channel = getChannel();
        if (isConnected()) {
            const messageData = {
                username,
                content: message.trim(),
                timestamp: new Date().toISOString()
            };
            channel.publish(GLOBAL_CHAT_EXCHANGE, '', Buffer.from(JSON.stringify(messageData)));
            console.log(`[Global Chat] ${username}: ${message.trim()}`);
        }

        ctx.body = { success: true };
    } catch (err) {
        console.error('[POST /api/chat/global] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to send message' };
    }
});

// Get chat history
router.get('/api/chat/global/history', authMiddleware, async (ctx) => {
    try {
        const messages = await ChatMessage.find({ room: 'global' })
            .sort({ createdAt: -1 })
            .limit(100);
        ctx.body = { success: true, messages: messages.reverse() };
    } catch (err) {
        console.error('[GET /api/chat/global/history] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to fetch messages' };
    }
});

// ============================================================================
// RUTE - CHAT CAMERE (SISTEM NOU)
// ============================================================================

// Creează cameră
router.post('/api/chat/rooms/create', authMiddleware, async (ctx) => {
    const { roomName } = ctx.request.body;
    const username = ctx.state.username;

    if (!roomName || typeof roomName !== 'string' || roomName.trim() === '') {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Room name is required.' };
        return;
    }

    const trimmedRoomName = roomName.trim();

    try {
        // Verifică dacă camera există deja
        const roomExists = await redisPublisher.sIsMember('available_rooms', trimmedRoomName);
        if (roomExists) {
            ctx.status = 400;
            ctx.body = { success: false, error: 'Room already exists.' };
            return;
        }

        // Salvează camera în Redis
        await redisPublisher.sAdd('available_rooms', trimmedRoomName);
        await redisPublisher.sAdd(`room:${trimmedRoomName}:members`, username);
        
        // Join SSE room pentru mesaje real-time
        sseManager.joinRoom(username, trimmedRoomName);

        //  BROADCAST LA TOȚI UTILIZATORII
        const allRooms = await redisPublisher.sMembers('available_rooms');
        sseManager.broadcastEvent('roomsUpdate', { 
            availableRooms: Array.from(allRooms)
        });
        
        console.log(`[Room Created] ${trimmedRoomName} by ${username}`);

        ctx.body = { 
            success: true, 
            roomName: trimmedRoomName,
            message: 'Room created successfully'
        };
    } catch (err) {
        console.error('[POST /api/chat/rooms/create] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to create room' };
    }
});

// Join cameră
router.post('/api/chat/rooms/join', authMiddleware, async (ctx) => {
    const { roomName } = ctx.request.body;
    const username = ctx.state.username;

    if (!roomName) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Room name is required.' };
        return;
    }

    try {
        // Verifică dacă camera există
        const roomExists = await redisPublisher.sIsMember('available_rooms', roomName);
        if (!roomExists) {
            ctx.status = 404;
            ctx.body = { success: false, error: 'Room does not exist.' };
            return;
        }

        // Adaugă utilizatorul în cameră
        await redisPublisher.sAdd(`room:${roomName}:members`, username);
        sseManager.joinRoom(username, roomName);

        // Notifică membrii camerei
        const memberCount = await redisPublisher.sCard(`room:${roomName}:members`);
        sseManager.sendEventToRoom(roomName, 'roomMemberUpdate', { 
            roomName, 
            memberCount,
            newMember: username
        });

        console.log(`[Room Joined] ${username} joined ${roomName}`);

        ctx.body = { 
            success: true, 
            roomName,
            memberCount 
        };
    } catch (err) {
        console.error('[POST /api/chat/rooms/join] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to join room' };
    }
});

// Leave cameră
router.post('/api/chat/rooms/leave', authMiddleware, async (ctx) => {
    const { roomName } = ctx.request.body;
    const username = ctx.state.username;

    if (!roomName) {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Room name is required.' };
        return;
    }

    try {
        // Șterge utilizatorul din cameră
        await redisPublisher.sRem(`room:${roomName}:members`, username);
        sseManager.leaveRoom(username, roomName);

        const memberCount = await redisPublisher.sCard(`room:${roomName}:members`);
        
        // Șterge camera dacă e goală
        if (memberCount === 0) {
            await redisPublisher.sRem('available_rooms', roomName);
            
            // Broadcast că lista de camere s-a schimbat
            const allRooms = await redisPublisher.sMembers('available_rooms');
            sseManager.broadcastEvent('roomsUpdate', { 
                availableRooms: Array.from(allRooms)
            });
            
            console.log(`[Room Deleted] ${roomName} (empty)`);
        } else {
            // Notifică membrii rămași
            sseManager.sendEventToRoom(roomName, 'roomMemberUpdate', { 
                roomName, 
                memberCount,
                leftMember: username
            });
        }

        console.log(`[Room Left] ${username} left ${roomName}`);

        ctx.body = { success: true };
    } catch (err) {
        console.error('[POST /api/chat/rooms/leave] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to leave room' };
    }
});

// Get toate camerele
router.get('/api/chat/rooms', authMiddleware, async (ctx) => {
    try {
        const allRooms = await redisPublisher.sMembers('available_rooms');
        
        // Obține și numărul de membri pentru fiecare cameră
        const roomsWithCounts = await Promise.all(
            Array.from(allRooms).map(async (roomName) => {
                const memberCount = await redisPublisher.sCard(`room:${roomName}:members`);
                return { roomName, memberCount };
            })
        );
        
        ctx.body = { 
            success: true, 
            rooms: roomsWithCounts
        };
    } catch (err) {
        console.error('[GET /api/chat/rooms] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to fetch rooms' };
    }
});

// Trimite mesaj în cameră
router.post('/api/chat/room/:roomName', authMiddleware, async (ctx) => {
    const { roomName } = ctx.params;
    const username = ctx.state.username;
    const { message } = ctx.request.body;

    if (!message || message.trim() === '') {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Message cannot be empty' };
        return;
    }

    try {
        // Verifică dacă utilizatorul e în cameră
        const isMember = await redisPublisher.sIsMember(`room:${roomName}:members`, username);
        if (!isMember) {
            ctx.status = 403;
            ctx.body = { success: false, error: 'You are not a member of this room' };
            return;
        }

        // Salvează în MongoDB
        const chatMessage = new ChatMessage({
            sender: username,
            message: message.trim(),
            room: roomName
        });
        await chatMessage.save();

        // Publică în RabbitMQ
        const channel = getChannel();
        if (isConnected()) {
            const messageData = {
                sender: username,
                text: message.trim(),
                room: roomName,
                timestamp: new Date().toISOString()
            };
            channel.publish(ROOM_CHAT_EXCHANGE, `room.${roomName}`, Buffer.from(JSON.stringify(messageData)));
            console.log(`[Room Chat] ${username} in ${roomName}: ${message.trim()}`);
        }

        ctx.body = { success: true };
    } catch (err) {
        console.error(`[POST /api/chat/room/${roomName}] Error:`, err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to send message' };
    }
});

// ============================================================================
// RUTE - CHAT PRIVAT
// ============================================================================
router.post('/api/chat/private', authMiddleware, async (ctx) => {
    const sender = ctx.state.username;
    const { to, message } = ctx.request.body;

    if (!to || !message || message.trim() === '') {
        ctx.status = 400;
        ctx.body = { success: false, error: 'Recipient and message are required' };
        return;
    }

    try {
        // Salvează în MongoDB
        const chatMessage = new ChatMessage({
            sender,
            message: message.trim(),
            room: `private:${sender}:${to}` // Room pentru private chat
        });
        await chatMessage.save();

        // Publică în RabbitMQ
        const channel = getChannel();
        if (isConnected()) {
            const messageData = {
                sender,
                to,
                text: message.trim(),
                timestamp: new Date().toISOString()
            };
            channel.publish(ROOM_CHAT_EXCHANGE, `private.${to}`, Buffer.from(JSON.stringify(messageData)));
            console.log(`[Private Chat] ${sender} -> ${to}: ${message.trim()}`);
        }

        ctx.body = { success: true };
    } catch (err) {
        console.error('[POST /api/chat/private] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to send private message' };
    }
});

// ============================================================================
// RUTE - POKER
// ============================================================================

// Get toate jocurile de poker
router.get('/api/poker/games', authMiddleware, async (ctx) => {
    try {
        const games = await PokerGame.find({ inProgress: false });
        ctx.body = { 
            success: true, 
            games: games.map(g => ({ 
                ...g.toObject(), 
                hasPassword: !!g.password,
                maxPlayers: g.options?.maxPlayers || 9,
                minPlayers: g.options?.minPlayers || 2
            })) 
        };
    } catch (err) {
        console.error('[GET /api/poker/games] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to fetch poker games' };
    }
});

// Creează joc de poker
router.post('/api/poker/create', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId, options, password } = ctx.request.body;
    
    if (!gameId || typeof gameId !== 'string' || gameId.trim().length < 3) {
        ctx.status = 400;
        ctx.body = { success: false, error: "Numele mesei trebuie să aibă cel puțin 3 caractere." };
        return;
    }
    
    const trimmedGameId = gameId.trim();
    
    try {
        const existing = await PokerGame.findOne({ gameId: trimmedGameId });
        if (existing) { 
            ctx.status = 400; 
            ctx.body = { success: false, error: "Numele mesei există deja." }; 
            return;
        }

        //  Asigură că options conține minPlayers
        const gameOptions = {
            smallBlind: options?.smallBlind || 10,
            bigBlind: options?.bigBlind || 20,
            maxPlayers: options?.maxPlayers || 9,
            minPlayers: options?.minPlayers || 2
        };

        const newGame = new PokerGame({
            gameId: trimmedGameId,
            creatorUsername: username,
            password: password || undefined,
            options: gameOptions,
            players: [{ username, stack: 1000, status: 'waiting' }]
        });

        await newGame.save();
        sseManager.joinRoom(username, trimmedGameId);
        
        console.log(`[Poker] Game created: ${trimmedGameId} by ${username}`);
        
        ctx.body = { success: true, gameState: newGame };
    } catch (err) {
        console.error('[POST /api/poker/create] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to create poker game' };
    }
});

// Join joc de poker
router.post('/api/poker/join', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId, password, stack } = ctx.request.body;
    
    if (!gameId) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId lipsește." };
        return;
    }
    
    try {
        const game = await PokerGame.findOne({ gameId }).select('+password');

        if (!game) { 
            ctx.status = 404; 
            ctx.body = { success: false, error: "Jocul nu există." }; 
            return;
        }
        
        if (game.password && game.password !== password) { 
            ctx.status = 401; 
            ctx.body = { success: false, error: "Parolă incorectă." }; 
            return;
        }
        
        if (game.players.some(p => p.username === username)) {
            ctx.status = 400;
            ctx.body = { success: false, error: "Ești deja în joc." };
            return;
        }
        
        if (game.players.length >= (game.options?.maxPlayers || 9)) {
            ctx.status = 400;
            ctx.body = { success: false, error: "Masa e plină." };
            return;
        }

        game.players.push({ 
            username, 
            stack: stack || 1000, 
            status: 'waiting' 
        });
        
        await game.save();
        sseManager.joinRoom(username, gameId);
        
        // Notifică toți jucătorii
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(game));
        
        console.log(`[Poker] ${username} joined game: ${gameId}`);
        
        ctx.body = { success: true, gameState: game };
    } catch (err) {
        console.error('[POST /api/poker/join] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to join poker game' };
    }
});

// Start joc de poker
router.post('/api/poker/start', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    
    if (!gameId) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId lipsește." };
        return;
    }
    
    try {
        const game = await PokerGame.findOne({ gameId });
        
        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        if (game.creatorUsername !== username) {
            ctx.status = 403;
            ctx.body = { success: false, error: "Doar creatorul poate începe jocul." };
            return;
        }
        
        if (game.players.length < (game.options?.minPlayers || 2)) {
            ctx.status = 400;
            ctx.body = { success: false, error: "Nu sunt suficienți jucători." };
            return;
        }
        
        // Începe jocul
        game.inProgress = true;
        const updatedGame = startNewHand(game);
        
        await updatedGame.save();
        
        // Notifică toți jucătorii
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(updatedGame));
        
        console.log(`[Poker] Game started: ${gameId}`);
        
        ctx.body = { success: true, gameState: updatedGame };
    } catch (err) {
        console.error('[POST /api/poker/start] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: err.message || 'Failed to start game' };
    }
});

// Acțiune în joc (fold, call, raise, check)
router.post('/api/poker/action', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId, action, amount } = ctx.request.body;
    
    if (!gameId || !action) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId și action sunt necesare." };
        return;
    }
    
    try {
        const game = await PokerGame.findOne({ gameId });
        
        if (!game || !game.inProgress) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există sau nu e în desfășurare." };
            return;
        }
        
        // Procesează acțiunea
        const updatedGame = handlePlayerAction(game, username, action, amount);
        
        await updatedGame.save();
        
        // Notifică toți jucătorii
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(updatedGame));
        
        console.log(`[Poker] ${username} ${action} in ${gameId}`);
        
        ctx.body = { success: true, gameState: updatedGame };
    } catch (err) {
        console.error('[POST /api/poker/action] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: err.message || 'Failed to process action' };
    }
});

// Mână nouă
router.post('/api/poker/newhand', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    
    if (!gameId) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId lipsește." };
        return;
    }
    
    try {
        const game = await PokerGame.findOne({ gameId });
        
        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        if (game.creatorUsername !== username) {
            ctx.status = 403;
            ctx.body = { success: false, error: "Doar creatorul poate începe mâna nouă." };
            return;
        }
        
        // Începe mână nouă
        const updatedGame = startNewHand(game);
        
        await updatedGame.save();
        
        // Notifică toți jucătorii
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(updatedGame));
        
        console.log(`[Poker] New hand started in ${gameId}`);
        
        ctx.body = { success: true, gameState: updatedGame };
    } catch (err) {
        console.error('[POST /api/poker/newhand] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: err.message || 'Failed to start new hand' };
    }
});

// Leave joc de poker
router.post('/api/poker/leave', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    
    if (!gameId) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId lipsește." };
        return;
    }
    
    try {
        const game = await PokerGame.findOne({ gameId });
        
        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        // Șterge jucătorul
        game.players = game.players.filter(p => p.username !== username);
        
        // Șterge jocul dacă nu mai sunt jucători
        if (game.players.length === 0) {
            await PokerGame.deleteOne({ gameId });
            console.log(`[Poker] Game deleted: ${gameId} (empty)`);
        } else {
            await game.save();
            // Notifică jucătorii rămași
            await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(game));
        }
        
        sseManager.leaveRoom(username, gameId);
        
        console.log(`[Poker] ${username} left game: ${gameId}`);
        
        ctx.body = { success: true };
    } catch (err) {
        console.error('[POST /api/poker/leave] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to leave game' };
    }
});

// ============================================================================
// RUTE - HANGMAN
// ============================================================================

// Get toate jocurile de Hangman
router.get('/api/hangman/games', authMiddleware, async (ctx) => {
    try {
        const games = await HangmanGame.find({ 
            status: { $in: ['waiting_for_guesser', 'waiting_for_word', 'in_progress'] }
        });
        
        ctx.body = { 
            success: true, 
            games: games.map(g => getHangmanPublicState(g))
        };
    } catch (err) {
        console.error('[GET /api/hangman/games] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to fetch hangman games' };
    }
});

// Creează joc de Hangman
router.post('/api/hangman/create', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    
    if (!gameId || typeof gameId !== 'string' || gameId.trim().length < 3) {
        ctx.status = 400;
        ctx.body = { success: false, error: "Numele jocului trebuie să aibă cel puțin 3 caractere." };
        return;
    }
    
    const trimmedGameId = gameId.trim();
    
    try {
        const existing = await HangmanGame.findOne({ gameId: trimmedGameId });
        if (existing) {
            ctx.status = 400;
            ctx.body = { success: false, error: "Numele jocului există deja." };
            return;
        }

        const newGame = new HangmanGame({
            gameId: trimmedGameId,
            hostUsername: username,
            players: [{ username }],
            status: 'waiting_for_guesser'
        });

        await newGame.save();
        sseManager.joinRoom(username, trimmedGameId);
        
        console.log(`[Hangman] Game created: ${trimmedGameId} by ${username}`);
        
        ctx.body = { 
            success: true, 
            gameState: getHangmanPublicState(newGame)
        };
    } catch (err) {
        console.error('[POST /api/hangman/create] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to create hangman game' };
    }
});

// Join joc de Hangman
router.post('/api/hangman/join', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId } = ctx.request.body;
    
    if (!gameId) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId lipsește." };
        return;
    }
    
    try {
        const game = await HangmanGame.findOne({ gameId });

        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        if (game.status !== 'waiting_for_guesser') {
            ctx.status = 400;
            ctx.body = { success: false, error: "Jocul nu așteaptă ghicitor." };
            return;
        }
        
        if (game.hostUsername === username) {
            ctx.status = 400;
            ctx.body = { success: false, error: "Nu poți fi și gazdă și ghicitor." };
            return;
        }

        game.guesserUsername = username;
        game.status = 'waiting_for_word';
        game.players.push({ username });
        
        await game.save();
        sseManager.joinRoom(username, gameId);
        
        // Notifică ambii jucători
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(getHangmanPublicState(game)));
        
        console.log(`[Hangman] ${username} joined game: ${gameId}`);
        
        ctx.body = { 
            success: true, 
            gameState: getHangmanPublicState(game)
        };
    } catch (err) {
        console.error('[POST /api/hangman/join] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: 'Failed to join hangman game' };
    }
});

// Setează cuvântul secret
router.post('/api/hangman/setword', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId, word } = ctx.request.body;
    
    if (!gameId || !word) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId și word sunt necesare." };
        return;
    }
    
    try {
        const game = await HangmanGame.findOne({ gameId });
        
        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        if (game.hostUsername !== username) {
            ctx.status = 403;
            ctx.body = { success: false, error: "Doar gazda poate seta cuvântul." };
            return;
        }
        
        // Setează cuvântul
        const updatedGame = handleSetWord(game, word);
        
        await updatedGame.save();
        
        // Notifică ambii jucători
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(getHangmanPublicState(updatedGame)));
        
        console.log(`[Hangman] Word set in ${gameId}`);
        
        ctx.body = { 
            success: true, 
            gameState: getHangmanPublicState(updatedGame)
        };
    } catch (err) {
        console.error('[POST /api/hangman/setword] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: err.message || 'Failed to set word' };
    }
});

// Ghicește o literă
router.post('/api/hangman/guess', authMiddleware, async (ctx) => {
    const username = ctx.state.username;
    const { gameId, letter } = ctx.request.body;
    
    if (!gameId || !letter) {
        ctx.status = 400;
        ctx.body = { success: false, error: "gameId și letter sunt necesare." };
        return;
    }
    
    try {
        const game = await HangmanGame.findOne({ gameId });
        
        if (!game) {
            ctx.status = 404;
            ctx.body = { success: false, error: "Jocul nu există." };
            return;
        }
        
        if (game.guesserUsername !== username) {
            ctx.status = 403;
            ctx.body = { success: false, error: "Doar ghicitorul poate ghici." };
            return;
        }
        
        // Procesează ghicirea
        const updatedGame = handleGuess(game, letter);
        
        await updatedGame.save();
        
        // Notifică ambii jucători
        await redisPublisher.publish(`game-updates:${gameId}`, JSON.stringify(getHangmanPublicState(updatedGame)));
        
        console.log(`[Hangman] ${username} guessed ${letter} in ${gameId}`);
        
        ctx.body = { 
            success: true, 
            gameState: getHangmanPublicState(updatedGame)
        };
    } catch (err) {
        console.error('[POST /api/hangman/guess] Error:', err);
        ctx.status = 500;
        ctx.body = { success: false, error: err.message || 'Failed to process guess' };
    }
});

// ============================================================================
// RUTE - HEALTH CHECK
// ============================================================================
router.get('/api/ping', async (ctx) => {
    ctx.body = { success: true, message: 'pong', timestamp: new Date().toISOString() };
});

router.get('/api/health', async (ctx) => {
    ctx.body = { 
        success: true, 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        sseClients: sseManager.getStatus()
    };
});

// Export routes
const routes = router;
module.exports = { routes };