// src/models/chatMessage.model.js
const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    message: { type: String, required: true },
    // 'global' pentru chat-ul global, sau un gameId pentru o cameră de joc
    room: { type: String, required: true, index: true }, 
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);