// src/redisClient.js
const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const publisher = createClient({ url: redisUrl });
const subscriber = publisher.duplicate();

let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 5000;

/**
 * Conectare la Redis cu retry logic
 */
async function connectRedis() {
    if (isConnecting) {
        console.log('[Redis] Connection already in progress...');
        return;
    }
    
    isConnecting = true;
    
    try {
        console.log('[Redis] Attempting to connect...');
        
        await Promise.all([
            publisher.connect(), 
            subscriber.connect()
        ]);
        
        reconnectAttempts = 0;
        console.log('✅ Connected to Redis (Publisher and Subscriber)');
        isConnecting = false;
        
    } catch (err) {
        isConnecting = false;
        console.error('❌ Could not connect to Redis:', err.message);
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`[Redis] Retrying in ${RECONNECT_DELAY/1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(connectRedis, RECONNECT_DELAY);
        } else {
            console.error('❌ Redis connection failed after max retries. Exiting.');
            process.exit(1);
        }
    }
}

/**
 * Handler pentru reconectare automată
 */
function setupReconnectHandlers() {
    publisher.on('error', (err) => {
        console.error('[Redis Publisher] Error:', err.message);
    });

    publisher.on('reconnecting', () => {
        console.log('[Redis Publisher] Reconnecting...');
    });

    publisher.on('ready', () => {
        console.log('[Redis Publisher] Ready');
        reconnectAttempts = 0;
    });

    subscriber.on('error', (err) => {
        console.error('[Redis Subscriber] Error:', err.message);
    });

    subscriber.on('reconnecting', () => {
        console.log('[Redis Subscriber] Reconnecting...');
    });

    subscriber.on('ready', () => {
        console.log('[Redis Subscriber] Ready');
    });
}

// Setup handlers înainte de conectare
setupReconnectHandlers();

// Inițializare conexiune
connectRedis();

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Redis] SIGTERM received, closing connections...');
    try {
        await Promise.all([
            publisher.quit(),
            subscriber.quit()
        ]);
        console.log('[Redis] Connections closed gracefully');
    } catch (err) {
        console.error('[Redis] Error during shutdown:', err);
    }
});

module.exports = {
    publisher,
    subscriber
};