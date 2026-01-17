// src/rabbitClient.js
const amqp = require('amqplib');

const GLOBAL_CHAT_EXCHANGE = 'chat.global';
const ROOM_CHAT_EXCHANGE = 'chat.rooms';

let channel = null;

async function connectRabbitMQ() {
    try {
        const rabbitUrl = process.env.RABBIT_URI || 'amqp://guest:guest@localhost:5672';
        const connection = await amqp.connect(rabbitUrl);
        
        connection.on('error', (err) => {
            console.error("❌ RabbitMQ connection error", err);
            process.exit(1);
        });

        connection.on('close', () => {
            console.error("❌ RabbitMQ connection closed. Retrying...");
            // Aici se poate adăuga logică de reconectare
            process.exit(1);
        });

        channel = await connection.createChannel();

        await channel.assertExchange(GLOBAL_CHAT_EXCHANGE, 'fanout', { durable: true });
        await channel.assertExchange(ROOM_CHAT_EXCHANGE, 'topic', { durable: true });

        console.log('✅ Connected to RabbitMQ...');
        
    } catch (err) {
        console.error('❌ Could not connect to RabbitMQ. Is the Docker container running?', err);
        process.exit(1);
    }
}

function getChannel() {
    if (!channel) {
        throw new Error("RabbitMQ channel not established.");
    }
    return channel;
}

module.exports = {
    connectRabbitMQ,
    getChannel,
    GLOBAL_CHAT_EXCHANGE,
    ROOM_CHAT_EXCHANGE
};