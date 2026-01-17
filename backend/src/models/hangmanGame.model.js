const mongoose = require('mongoose');

const hangmanGameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true, trim: true },
    hostUsername: { type: String, required: true },
    guesserUsername: { type: String, default: null },
    // Folosim un array de jucători pentru a fi compatibili cu logica de notificare din server.js
    players: [{ username: String }], 
    secretWord: { type: String, default: '' },
    guessedLetters: [{ type: String }],
    status: { 
        type: String, 
        enum: ['waiting_for_guesser', 'waiting_for_word', 'in_progress', 'won', 'lost'], 
        default: 'waiting_for_guesser' 
    },
    mistakes: { type: Number, default: 0 },
    maxGuesses: { type: Number, default: 6 },
}, { 
    timestamps: true,
    versionKey: 'version' 
});

module.exports = mongoose.model('HangmanGame', hangmanGameSchema);