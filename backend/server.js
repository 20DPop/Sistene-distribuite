// server.js
const Koa = require("koa");
const serve = require("koa-static");
const bodyParser = require('koa-bodyparser');
const mongoose = require('mongoose');
const path = require('path');

// Configurații și Module Interne
const config = require("./src/config");
const { routes } = require("./src/routes");
const { subscriber: redisSubscriber } = require('./src/redisClient');
const { connectRabbitMQ, getChannel, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./src/rabbitClient');
const sseManager = require('./src/sseManager');

// Modele pentru interogări în Subscriberi
const PokerGame = require('./src/models/pokerGame.model');
const HangmanGame = require('./src/models/hangmanGame.model');

const app = new Koa();

// --- 1. CONECTARE MONGODB ---
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/distributed_games';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB (Shared Database)'))
  .catch(err => { 
      console.error('❌ MongoDB Connection Error:', err); 
      process.exit(1); 
  });

// --- 2. CONFIGURARE RABBITMQ (CHAT DISTRIBUIT) ---
async function setupRabbitMQSubscription() {
    try {
        await connectRabbitMQ();
        const channel = getChannel();
        
        // Creăm o coadă temporară, exclusivă pentru acest nod de server
        const { queue } = await channel.assertQueue('', { exclusive: true });

        // Bindings: Ascultăm tot ce mișcă în rețeaua de chat
        channel.bindQueue(queue, GLOBAL_CHAT_EXCHANGE, '');            // Global
        channel.bindQueue(queue, ROOM_CHAT_EXCHANGE, 'room.#');       // Camere
        channel.bindQueue(queue, ROOM_CHAT_EXCHANGE, 'private.#');    // Mesaje Private

        console.log(`✅ RabbitMQ Subscribed on this node (Queue: ${queue})`);

        channel.consume(queue, (msg) => {
            if (msg.content) {
                try {
                    const data = JSON.parse(msg.content.toString());
                    const routingKey = msg.fields.routingKey;

                    // A. Chat Global
                    if (msg.fields.exchange === GLOBAL_CHAT_EXCHANGE) {
                        sseManager.broadcastEvent('globalChatMessage', data);
                    } 
                    // B. Chat de Cameră (Poker sau Hangman Room)
                    else if (routingKey.startsWith('room.')) {
                        sseManager.sendEventToRoom(data.room, 'roomChatMessage', data);
                    }
                    // C. Chat Privat
                    else if (routingKey.startsWith('private.')) {
                        // Managerul va livra mesajul doar dacă Ionuț e conectat la ACEST nod
                        sseManager.sendEventToUser(data.to, 'privateChatMessage', data);
                        // Trimitem și expeditorului pentru a sincroniza UI-ul (în caz că are mai multe tab-uri)
                        sseManager.sendEventToUser(data.sender, 'privateChatMessage', data);
                    }
                } catch (e) {
                    console.error("[RabbitMQ Consumer] Error processing message:", e);
                }
            }
        }, { noAck: true });
    } catch (err) {
        console.error('❌ Failed to set up RabbitMQ subscription:', err);
    }
}

// --- 3. CONFIGURARE REDIS (GAME UPDATES DISTRIBUITE) ---
async function setupRedisSubscription() {
    try {
        // Ascultăm orice update de joc (Poker sau Hangman)
        await redisSubscriber.pSubscribe('game-updates:*', async (message, channelName) => {
            try {
                const gameId = channelName.split(':')[1];
                const updatedGameState = JSON.parse(message);

                // Încercăm să găsim jucătorii în Poker
                let game = await PokerGame.findOne({ gameId }, 'players.username');
                
                // Dacă nu e poker, căutăm în Hangman
                if (!game) {
                    game = await HangmanGame.findOne({ gameId }, 'players.username');
                }

                if (game && game.players) {
                    // Trimitem starea proaspătă doar jucătorilor din acel joc
                    // care sunt conectați la ACEST nod de server
                    game.players.forEach(player => {
                        sseManager.sendEventToUser(player.username, 'gameStateUpdate', updatedGameState);
                    });
                }
            } catch (err) {
                console.error("[Redis Subscriber] Error processing game update:", err);
            }
        });

        // Opțional: Ascultăm și update-uri de prezență (pentru a forța refresh la lista de useri online)
        await redisSubscriber.subscribe('user-presence-updates', async (message) => {
            const onlineUsers = await sseManager.getGlobalOnlineUsers();
            sseManager.broadcastEvent('usersOnlineUpdate', onlineUsers);
        });

        console.log("✅ Redis Subscribed to game-updates:* and presence");
    } catch (err) {
        console.error("❌ Failed to subscribe to Redis channels:", err);
    }
}

// --- 4. PORNIRE SUBSCRIPȚII ---
setupRabbitMQSubscription();
setupRedisSubscription();

// --- 5. MIDDLEWARE-URI KOA ---

// Gestionare erori globale
app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        ctx.status = err.status || 500;
        ctx.body = { success: false, error: err.message };
        ctx.app.emit('error', err, ctx);
    }
});

app.use(bodyParser());

// Servire fișiere statice (Frontend-ul build-uit)
app.use(serve(path.join(__dirname, "dist")));

// Rutele API
app.use(routes.routes());
app.use(routes.allowedMethods());

// --- 6. LANSARE SERVER ---
const port = process.env.PORT || config.port;
app.listen(port, () => {
    console.log(`🚀 Distributed Node running on http://localhost:${port}`);
    console.log(`🔗 Connected to Shared Infrastructure (Mongo, Redis, Rabbit)`);
});

app.on('error', (err, ctx) => {
    if (err.code !== 'EPIPE') { // Ignorăm erorile de tip "pipe" (când un client SSE închide brusc)
        console.error('[Koa Server Error]', err);
    }
});

module.exports = app;