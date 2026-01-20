// src/rabbitClient.js
const amqp = require('amqplib');

const GLOBAL_CHAT_EXCHANGE = 'chat.global';
const ROOM_CHAT_EXCHANGE = 'chat.rooms';

let connection = null;
let channel = null;
let isReconnecting = false;

const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Încearcă să se conecteze la RabbitMQ cu logică de reîncercare.
 * @param {number} retries Numărul de încercări
 * @param {number} delay Întârziere între încercări în milisecunde
 */
async function connectRabbitMQ(retries = MAX_RECONNECT_ATTEMPTS, delay = RECONNECT_DELAY) {
    const rabbitUrl = process.env.RABBIT_URI || 'amqp://guest:guest@localhost:5672';
    
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`[RabbitMQ] Connection attempt ${i + 1}/${retries}...`);
            
            connection = await amqp.connect(rabbitUrl);
            
            // Handler pentru erori de conexiune
            connection.on('error', (err) => {
                console.error("❌ RabbitMQ connection error:", err.message);
                if (!isReconnecting) {
                    scheduleReconnect();
                }
            });
    
            connection.on('close', () => {
                console.error("❌ RabbitMQ connection closed");
                if (!isReconnecting) {
                    scheduleReconnect();
                }
            });
    
            channel = await connection.createChannel();
            
            // Handler pentru erori de canal
            channel.on('error', (err) => {
                console.error("❌ RabbitMQ channel error:", err.message);
            });
            
            channel.on('close', () => {
                console.log("⚠️ RabbitMQ channel closed");
            });
    
            // Asigurăm că exchange-urile necesare pentru aplicație există
            await channel.assertExchange(GLOBAL_CHAT_EXCHANGE, 'fanout', { durable: true });
            await channel.assertExchange(ROOM_CHAT_EXCHANGE, 'topic', { durable: true });
    
            console.log('✅ Connected to RabbitMQ');
            isReconnecting = false;
            return; // Succes!
            
        } catch (err) {
            console.warn(`⚠️ RabbitMQ connection attempt ${i + 1}/${retries} failed: ${err.message}`);
            
            if (i < retries - 1) {
                console.log(`[RabbitMQ] Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    // Dacă toate încercările au eșuat, oprim procesul
    console.error(`❌ Could not connect to RabbitMQ after ${retries} attempts. Exiting.`);
    process.exit(1);
}

/**
 * Programează reconectarea automată
 */
function scheduleReconnect() {
    if (isReconnecting) return;
    
    isReconnecting = true;
    console.log(`[RabbitMQ] Scheduling reconnect in ${RECONNECT_DELAY / 1000}s...`);
    
    // Curățăm resurse vechi
    channel = null;
    connection = null;
    
    setTimeout(() => {
        connectRabbitMQ();
    }, RECONNECT_DELAY);
}

/**
 * Returnează canalul RabbitMQ stabilit.
 * @returns {object} Canalul AMQP.
 */
function getChannel() {
    if (!channel) {
        throw new Error("RabbitMQ channel not established. Connection may be down.");
    }
    return channel;
}

/**
 * Verifică dacă conexiunea este activă
 */
function isConnected() {
    return channel !== null && connection !== null;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[RabbitMQ] SIGTERM received, closing connection...');
    try {
        if (channel) await channel.close();
        if (connection) await connection.close();
        console.log('[RabbitMQ] Connection closed gracefully');
    } catch (err) {
        console.error('[RabbitMQ] Error during shutdown:', err);
    }
});

module.exports = {
    connectRabbitMQ,
    getChannel,
    isConnected,
    GLOBAL_CHAT_EXCHANGE,
    ROOM_CHAT_EXCHANGE
};