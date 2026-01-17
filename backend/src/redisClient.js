const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const publisher = createClient({ url: redisUrl });
const subscriber = publisher.duplicate();

async function connectRedis() {
    try {
        await Promise.all([publisher.connect(), subscriber.connect()]);
        console.log('✅ Connected to Redis (Publisher and Subscriber)...');
    } catch (err) {
        console.error('❌ Could not connect to Redis. Is the Docker container running?', err);
        process.exit(1);
    }
}

connectRedis();

module.exports = {
    publisher,
    subscriber
};