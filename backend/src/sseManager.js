// src/sseManager.js - FIXED VERSION
const { publisher: redisPublisher } = require('./redisClient');

const clients = new Map(); // { username: { stream, timestamp } }
const rooms = new Map();   // { roomId: Set<username> }

async function addClient(username, ctx, stream) {
    // Dacă utilizatorul are deja o conexiune, o închidem
    if (clients.has(username)) {
        console.log(`[SSE Manager] User ${username} reconnecting, closing old connection`);
        await removeClient(username);
    }
    
    // Salvăm stream-ul prin care trimitem datele + timestamp
    clients.set(username, { 
        stream,
        timestamp: Date.now()
    });
    
    try {
        await redisPublisher.sAdd('online_users', username);
        await redisPublisher.publish('user-presence-updates', JSON.stringify({
            type: 'USER_CONNECTED',
            username: username,
            timestamp: Date.now()
        }));

        console.log(`[SSE Manager] ✅ User connected: ${username} (Total: ${clients.size})`);
        
        // Trimitem un semnal "keep-alive" imediat ca browserul să confirme conexiunea
        stream.write(': connected\n\n');
        
        // Trimitem lista de utilizatori online imediat după conectare
        const onlineUsers = await getGlobalOnlineUsers();
        sendEventToUser(username, 'usersOnlineUpdate', onlineUsers);
        
    } catch (err) {
        console.error(`[SSE Manager] Redis error for ${username}:`, err);
        // Continuăm oricum - conexiunea SSE funcționează local
    }
}

async function removeClient(username) {
    const client = clients.get(username);
    
    if (client) {
        // Închidem stream-ul
        if (client.stream) {
            try {
                client.stream.end();
            } catch (e) {
                // Stream deja închis
            }
        }
        
        clients.delete(username);
        
        // Curățăm din toate rooms
        rooms.forEach((users, roomId) => {
            users.delete(username);
            // Ștergem room-urile goale
            if (users.size === 0) {
                rooms.delete(roomId);
            }
        });

        try {
            await redisPublisher.sRem('online_users', username);
            await redisPublisher.publish('user-presence-updates', JSON.stringify({
                type: 'USER_DISCONNECTED',
                username: username,
                timestamp: Date.now()
            }));
            console.log(`[SSE Manager] ❌ User disconnected: ${username} (Total: ${clients.size})`);
        } catch (err) {
            console.error(`[SSE Manager] Redis error removing ${username}:`, err);
        }
    }
}

function sendEventToUser(username, eventName, data) {
    const client = clients.get(username);
    if (client && client.stream) {
        try {
            const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            client.stream.write(message);
        } catch (e) {
            // ✅ FIX: NU apelăm removeClient() aici!
            // Event listeners din routes.js ('close', 'error') se ocupă de cleanup
            console.error(`[SSE Manager] Error sending to ${username}:`, e.message);
            
            // Doar marcăm clientul ca invalid
            clients.delete(username);
        }
    }
}

function broadcastEvent(eventName, data) {
    let successCount = 0;
    let failCount = 0;
    
    clients.forEach((client, username) => {
        try {
            const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            client.stream.write(message);
            successCount++;
        } catch (e) {
            console.error(`[SSE Manager] Broadcast failed for ${username}:`, e.message);
            
            // ✅ FIX: NU apelăm removeClient() aici!
            // Doar ștergem din map
            clients.delete(username);
            failCount++;
        }
    });
    
    if (failCount > 0) {
        console.log(`[SSE Manager] Broadcast: ${successCount} sent, ${failCount} failed`);
    }
}

function joinRoom(username, roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(username);
    console.log(`[SSE Manager] ${username} joined room: ${roomId} (Room size: ${rooms.get(roomId).size})`);
}

function leaveRoom(username, roomId) {
    const room = rooms.get(roomId);
    if (room) {
        room.delete(username);
        console.log(`[SSE Manager] ${username} left room: ${roomId} (Room size: ${room.size})`);
        
        // Curățăm room-ul dacă e gol
        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`[SSE Manager] Room ${roomId} deleted (empty)`);
        }
    }
}

function sendEventToRoom(roomId, eventName, data) {
    const usersInRoom = rooms.get(roomId);
    if (usersInRoom) {
        let count = 0;
        usersInRoom.forEach(username => {
            sendEventToUser(username, eventName, data);
            count++;
        });
        console.log(`[SSE Manager] Room ${roomId} broadcast: ${count} users`);
    }
}

async function getGlobalOnlineUsers() {
    try {
        const redisUsers = await redisPublisher.sMembers('online_users');
        return redisUsers;
    } catch (err) {
        console.error('[SSE Manager] Redis error getting online users:', err);
        // Fallback la lista locală
        return Array.from(clients.keys());
    }
}

// Funcție pentru debug - verifică starea conexiunilor
function getStatus() {
    return {
        connectedClients: clients.size,
        users: Array.from(clients.keys()),
        rooms: Array.from(rooms.entries()).map(([roomId, users]) => ({
            roomId,
            userCount: users.size,
            users: Array.from(users)
        }))
    };
}

module.exports = {
    addClient, 
    removeClient, 
    sendEventToUser, 
    broadcastEvent,
    joinRoom, 
    leaveRoom, 
    sendEventToRoom, 
    getGlobalOnlineUsers,
    getStatus // Pentru debugging
};