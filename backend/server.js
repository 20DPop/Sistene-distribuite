// server.js
const Koa = require("koa");
const serve = require("koa-static");
const bodyParser = require('koa-bodyparser');
const mongoose = require('mongoose');

// Căile sunt relative la rădăcina proiectului, unde se află server.js
const config = require("./src/config");
const { routes } = require("./src/routes");
const { subscriber: redisSubscriber } = require('./src/redisClient');
const { connectRabbitMQ, getChannel, GLOBAL_CHAT_EXCHANGE, ROOM_CHAT_EXCHANGE } = require('./src/rabbitClient');
const sseManager = require('./src/sseManager');
const PokerGame = require('./src/models/pokerGame.model');

const app = new Koa();

// --- Conectare la MongoDB ---
const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/distributed_games';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB...'))
  .catch(err => { console.error('❌ Could not connect to MongoDB.', err); process.exit(1); });

// --- Configurare Subscriber RabbitMQ pentru Chat ---
async function setupRabbitMQSubscription() {
    try {
        await connectRabbitMQ();
        const channel = getChannel();
        const { queue } = await channel.assertQueue('', { exclusive: true });
        channel.bindQueue(queue, GLOBAL_CHAT_EXCHANGE, '');
        channel.bindQueue(queue, ROOM_CHAT_EXCHANGE, 'room.#');
        console.log("✅ RabbitMQ subscribed to global and room chats.");

        channel.consume(queue, (msg) => {
            if (msg.content) {
                try {
                    const chatMessage = JSON.parse(msg.content.toString());
                    if (msg.fields.exchange === GLOBAL_CHAT_EXCHANGE) {
                        sseManager.broadcastEvent('globalChatMessage', chatMessage);
                    } else if (msg.fields.exchange === ROOM_CHAT_EXCHANGE) {
                        sseManager.sendEventToRoom(chatMessage.room, 'roomChatMessage', chatMessage);
                    }
                } catch (e) {
                    console.error("[RabbitMQ] Failed to process message", e);
                }
            }
        }, { noAck: true });
    } catch (err) {
        console.error('❌ Failed to set up RabbitMQ subscription:', err);
    }
}

// --- Configurare Subscriber Redis pentru Notificări de Joc ---
async function setupRedisSubscription() {
    try {
        await redisSubscriber.pSubscribe('game-updates:*', async (message, channel) => {
            try {
                const gameId = channel.split(':')[1];
                const updatedGameState = JSON.parse(message);
                const game = await PokerGame.findOne({ gameId }, 'players.username');
                if (game && game.players) {
                    game.players.forEach(player => {
                        sseManager.sendEventToUser(player.username, 'gameStateUpdate', updatedGameState);
                    });
                }
            } catch (err) {
                console.error("[Redis Subscriber] Error processing message:", err);
            }
        });
        console.log("✅ Redis subscribed to 'game-updates:*'");
    } catch (err) {
        console.error("❌ Failed to subscribe to Redis channels", err);
    }
}

// Pornim subscrierile
setupRabbitMQSubscription();
setupRedisSubscription();

// --- Middleware-uri Koa ---
app.use(serve(__dirname + "/dist"));
app.use(bodyParser());
app.use(routes.routes());
app.use(routes.allowedMethods());

// --- Gestionare erori globale ---
app.on('error', (err, ctx) => {
    console.error('Server error', err);
});

// --- Pornire Server ---
const port = process.env.PORT || config.port;
app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});

module.exports = app;