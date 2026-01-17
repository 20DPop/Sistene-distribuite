// src/models/pokerGame.model.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    username: { type: String, required: true },
    stack: { type: Number, required: true },
    hand: [String],
    currentBet: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'folded', 'all-in', 'out', 'waiting'], default: 'waiting' },
    hasActed: { type: Boolean, default: false },
    isWinner: { type: Boolean, default: false },
    evaluatedHand: { name: String, rank: Number },
}, { _id: false });

const pokerGameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true, trim: true },
    creatorUsername: String,
    password: { type: String, select: false },
    players: [playerSchema],
    options: {
        smallBlind: Number,
        bigBlind: Number,
        maxPlayers: Number,
        minPlayers: Number,
    },
    deck: [String],
    board: [String],
    pot: { type: Number, default: 0 },
    inProgress: { type: Boolean, default: false },
    round: { type: String, default: 'pre-game' },
    dealerIndex: { type: Number, default: -1 },
    currentPlayerIndex: { type: Number, default: -1 },
    lastRaiserUsername: String,
    lastRaiseAmount: { type: Number, default: 0 },
}, { 
    timestamps: true,
    versionKey: 'version' // Folosim 'version' pentru locking optimist
});

module.exports = mongoose.model('PokerGame', pokerGameSchema);