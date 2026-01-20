// server.js
const Koa = require("koa");
const serve = require("koa-static");
const bodyParser = require('koa-bodyparser');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Configurații și Module de Comunicare
const config = require("./src/config");
const { routes } = require("./src/routes");
const { subscriber: redisSubscriber } = require('./src/redisClient');
const { connectRabbitMQ, getChannel, isConnected, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./src/rabbitClient');
const sseManager = require('./src/sseManager');

// Modele pentru interogări în Subscriberi
const PokerGame = require('./src/models/pokerGame.model');
const HangmanGame = require('./src/models/hangmanGame.model');

const app = new Koa();

// --- 1. CONECTARE MONGODB (Baza de date partajată) ---
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/distributed_games';

mongoose.connect(mongoURI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => { 
    console.error('❌ MongoDB Connection Error:', err); 
    process.exit(1); 
});

// MongoDB error handlers
mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});

// --- 2. CONFIGURARE RABBITMQ (Distribuție Chat între Noduri) ---
async function setupRabbitMQSubscription() {
    try {
        await connectRabbitMQ();
        
        if (!isConnected()) {
            console.error('[RabbitMQ] Failed to establish connection');
            return;
        }
        
        const channel = getChannel();
        
        // Creăm o coadă temporară, exclusivă pentru acest nod de server
        const { queue } = await channel.assertQueue('', { exclusive: true });

        // Bindings: Ascultăm mesajele de chat din toată rețeaua
        await channel.bindQueue(queue, GLOBAL_CHAT_EXCHANGE, '');            
        await channel.bindQueue(queue, ROOM_CHAT_EXCHANGE, 'room.#');       
        await channel.bindQueue(queue, ROOM_CHAT_EXCHANGE, 'private.#');    

        console.log(`✅ RabbitMQ Subscribed on this node (Queue: ${queue})`);

        channel.consume(queue, (msg) => {
            if (msg && msg.content) {
                try {
                    const data = JSON.parse(msg.content.toString());
                    const routingKey = msg.fields.routingKey;

                    // Redirecționăm mesajul către clienții SSE conectați la ACEST nod
                    if (msg.fields.exchange === GLOBAL_CHAT_EXCHANGE) {
                        sseManager.broadcastEvent('globalChatMessage', data);
                    } 
                    else if (routingKey.startsWith('room.')) {
                        sseManager.sendEventToRoom(data.room, 'roomChatMessage', data);
                    }
                    else if (routingKey.startsWith('private.')) {
                        sseManager.sendEventToUser(data.to, 'privateChatMessage', data);
                        sseManager.sendEventToUser(data.sender, 'privateChatMessage', data);
                    }
                } catch (e) {
                    console.error("[RabbitMQ Consumer] Error processing message:", e);
                }
            }
        }, { noAck: true });
        
    } catch (err) {
        console.error('❌ RabbitMQ Subscription setup failed:', err);
        // Nu oprim serverul, va reîncerca automat să se reconecteze
    }
}

// --- 3. CONFIGURARE REDIS (Sincronizare Stare Jocuri) ---
async function setupRedisSubscription() {
    try {
        // Ascultăm actualizările de joc publicate de ORICE nod din cluster
        await redisSubscriber.pSubscribe('game-updates:*', async (message, channelName) => {
            try {
                const gameId = channelName.split(':')[1];
                const updatedGameState = JSON.parse(message);

                // Găsim jucătorii în DB pentru a vedea cine este conectat local pe acest nod
                let game = await PokerGame.findOne({ gameId }, 'players.username');
                if (!game) game = await HangmanGame.findOne({ gameId }, 'players.username');

                if (game && game.players) {
                    game.players.forEach(player => {
                        // Trimitem starea nouă doar dacă utilizatorul are un stream SSE deschis aici
                        sseManager.sendEventToUser(player.username, 'gameStateUpdate', updatedGameState);
                    });
                }
            } catch (err) {
                console.error("[Redis Subscriber] Error processing game update:", err);
            }
        });

        // Sync listă utilizatori online
        await redisSubscriber.subscribe('user-presence-updates', async () => {
            try {
                const onlineUsers = await sseManager.getGlobalOnlineUsers();
                sseManager.broadcastEvent('usersOnlineUpdate', onlineUsers);
            } catch (err) {
                console.error("[Redis Subscriber] Error broadcasting users:", err);
            }
        });

        console.log("✅ Redis Subscribed to game-updates and presence");
    } catch (err) {
        console.error("❌ Redis Subscription failed:", err);
        // Redis client are propria logică de reconnect
    }
}

// Pornire procese asincrone
setupRabbitMQSubscription();
setupRedisSubscription();

// --- 4. MIDDLEWARE-URI KOA ---

// A. Gestionare erori (ignora EPIPE pentru SSE)
app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        // Ignoră EPIPE și ECONNRESET - normale pentru SSE disconnect
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
            return;
        }
        
        ctx.status = err.status || 500;
        ctx.body = { success: false, error: err.message };
        ctx.app.emit('error', err, ctx);
    }
});

// B. Parser pentru JSON body
app.use(bodyParser({
    enableTypes: ['json', 'form'],
    jsonLimit: '10mb',
    formLimit: '10mb',
    onerror: (err, ctx) => {
        ctx.throw(422, 'Body parse error: ' + err.message);
    }
}));

// C. Servire Frontend (folderul /dist generat de React)
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
    app.use(serve(distPath));
} else {
    console.warn('⚠️ Warning: dist folder not found. Frontend will not be served.');
}

// D. Rutele API
app.use(routes.routes());
app.use(routes.allowedMethods());

// E. SPA FALLBACK (Rezolvă eroarea 404 la refresh pe rute de React precum /home/poker)
app.use(async (ctx) => {
    // Dacă am ajuns aici, înseamnă că nicio rută API sau fișier static nu s-a potrivit
    if (ctx.status === 404 && !ctx.path.startsWith('/api')) {
        const indexPath = path.join(__dirname, 'dist', 'index.html');
        if (fs.existsSync(indexPath)) {
            ctx.type = 'html';
            ctx.body = fs.createReadStream(indexPath);
        }
    }
});

// --- 5. PORNIRE SERVER ---
const port = process.env.PORT || config.port;
const server = app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
    console.log(`🔧 Environment: ${config.isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`📦 Infrastructure: MongoDB, Redis (pub/sub), RabbitMQ (chat)`);
});

// --- 6. GRACEFUL SHUTDOWN ---
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    // Oprim acceptarea de noi conexiuni
    server.close(async () => {
        console.log('HTTP server closed');
        
        try {
            // Curățăm conexiunile SSE
            console.log('Closing SSE connections...');
            // sseManager va fi curățat automat când clienții se deconectează
            
            // Închidem MongoDB
            console.log('Closing MongoDB connection...');
            await mongoose.connection.close();
            
            console.log('✅ Graceful shutdown completed');
            process.exit(0);
        } catch (err) {
            console.error('❌ Error during shutdown:', err);
            process.exit(1);
        }
    });
    
    // Forțăm oprirea după 30 secunde
    setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
};

// Listeners pentru shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log erori neprevăzute
app.on('error', (err, ctx) => {
    if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.error('[Koa Error]', err);
    }
});

// Unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

module.exports = app;