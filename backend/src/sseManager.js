// src/sseManager.js
const { publisher: redisPublisher } = require('./redisClient');


const clients = new Map();

const rooms = new Map();

async function addClient(username, ctx) {
    clients.set(username, ctx);
    
    try {
        // Adăugăm utilizatorul în Set-ul global din Redis
        await redisPublisher.sAdd('online_users', username);
        
        // Notificăm restul sistemului (opțional, prin Redis Pub/Sub) că un user s-a conectat
        await redisPublisher.publish('user-presence-updates', JSON.stringify({
            type: 'USER_CONNECTED',
            username: username
        }));

        console.log(`[SSE Manager] User connected: ${username} (Local node). Total global: (see Redis)`);
    } catch (err) {
        console.error(`[SSE Manager] Redis error on addClient for ${username}:`, err);
    }
}

/**
 * Elimină un client și îl șterge din prezența globală Redis.
 */
async function removeClient(username) {
    if (clients.has(username)) {
        clients.delete(username);
        
        // Curățăm prezența utilizatorului în camerele locale ale acestui server
        rooms.forEach((users, roomId) => {
            if (users.has(username)) {
                users.delete(username);
            }
        });

        try {
            // Îl ștergem din Set-ul global din Redis
            await redisPublisher.sRem('online_users', username);
            
            // Notificăm restul sistemului
            await redisPublisher.publish('user-presence-updates', JSON.stringify({
                type: 'USER_DISCONNECTED',
                username: username
            }));

            console.log(`[SSE Manager] User disconnected: ${username} (Local node).`);
        } catch (err) {
            console.error(`[SSE Manager] Redis error on removeClient for ${username}:`, err);
        }
    }
}

/**
 * Trimite un eveniment către un utilizator specific, dacă este conectat la acest server.
 */
function sendEventToUser(username, eventName, data) {
    const clientCtx = clients.get(username);
    
    if (clientCtx && !clientCtx.res.writableEnded) {
        try {
            // Formatul standard SSE: event: numele_evenimentului \n data: JSON_string \n\n
            clientCtx.res.write(`event: ${eventName}\n`);
            clientCtx.res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (e) {
            console.error(`[SSE Manager] Write error for ${username}:`, e.message);
            removeClient(username);
        }
    }
}

/**
 * Trimite un eveniment către TOȚI utilizatorii conectați la ACEST server.
 * (Folosit pentru broadcast local după ce s-a primit un mesaj global din RabbitMQ)
 */
function broadcastEvent(eventName, data) {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    
    clients.forEach((clientCtx, username) => {
        if (!clientCtx.res.writableEnded) {
            try {
                clientCtx.res.write(message);
            } catch (e) {
                console.error(`[SSE Manager] Broadcast error for ${username}:`, e.message);
                removeClient(username);
            }
        }
    });
}

/**
 * Înregistrează local un utilizator într-o cameră de joc/chat.
 */
function joinRoom(username, roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(username);
    console.log(`[SSE Manager] ${username} joined room ${roomId} (on this node).`);
}

/**
 * Elimină local un utilizator dintr-o cameră.
 */
function leaveRoom(username, roomId) {
    const room = rooms.get(roomId);
    if (room) {
        room.delete(username);
        if (room.size === 0) rooms.delete(roomId);
        console.log(`[SSE Manager] ${username} left room ${roomId} (on this node).`);
    }
}

/**
 * Trimite un eveniment către utilizatorii dintr-o cameră conectați la acest server.
 */
function sendEventToRoom(roomId, eventName, data) {
    const usersInRoom = rooms.get(roomId);
    if (usersInRoom) {
        usersInRoom.forEach(username => {
            sendEventToUser(username, eventName, data);
        });
    }
}

/**
 * Returnează lista tuturor utilizatorilor online de pe TOATE serverele.
 */
async function getGlobalOnlineUsers() {
    try {
        return await redisPublisher.sMembers('online_users');
    } catch (err) {
        console.error("[SSE Manager] Error fetching global users:", err);
        return Array.from(clients.keys()); // Fallback la lista locală
    }
}

module.exports = {
    addClient,
    removeClient,
    sendEventToUser,
    broadcastEvent,
    joinRoom,
    leaveRoom,
    sendEventToRoom,
    getGlobalOnlineUsers
};