// src/services/poker.service.js
const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

function createShuffledDeck() {
    const deck = SUITS.flatMap(suit => RANKS.map(rank => rank + suit));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function parseCard(cardString) {
    if (!cardString || cardString.length !== 2) return null;
    return { rank: cardString[0], suit: cardString[1] };
}

function startNewHand(game) {
    game.players = game.players.filter(p => p.stack > 0);
    game.players.forEach(p => p.status = 'waiting'); // Mark everyone as waiting first

    if (game.players.length < game.options.minPlayers) {
        game.inProgress = false;
        game.round = 'finished';
        throw new Error("Nu sunt suficienți jucători pentru a continua jocul.");
    }
    
    game.pot = 0;
    game.board = [];
    game.deck = createShuffledDeck();
    
    game.players.forEach(p => {
        p.hand = [];
        p.currentBet = 0;
        p.hasActed = false;
        p.isWinner = false;
        p.evaluatedHand = null;
        p.status = 'active';
    });

    game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
    const sbIndex = (game.dealerIndex + 1) % game.players.length;
    const bbIndex = (game.dealerIndex + 2) % game.players.length;
    
    const smallBlindPlayer = game.players[sbIndex];
    const bigBlindPlayer = game.players[bbIndex];
    
    const sbAmount = Math.min(smallBlindPlayer.stack, game.options.smallBlind);
    smallBlindPlayer.stack -= sbAmount;
    smallBlindPlayer.currentBet = sbAmount;
    
    const bbAmount = Math.min(bigBlindPlayer.stack, game.options.bigBlind);
    bigBlindPlayer.stack -= bbAmount;
    bigBlindPlayer.currentBet = bbAmount;

    game.players.forEach(p => {
        if (p.status === 'active') {
            p.hand.push(game.deck.pop(), game.deck.pop());
        }
    });

    game.currentPlayerIndex = (bbIndex + 1) % game.players.length;
    game.lastRaiserUsername = bigBlindPlayer.username;
    game.round = 'pre-flop';
    game.inProgress = true;
    
    return game;
}

function handlePlayerAction(game, username, action, amount = 0) {
    if (game.round === 'showdown') throw new Error("Mâna s-a terminat. Așteaptă runda următoare.");
    
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.username !== username) throw new Error("Nu este rândul tău.");

    const highestBet = Math.max(...game.players.map(p => p.currentBet));

    switch (action.toLowerCase()) {
        case 'fold':
            currentPlayer.status = 'folded';
            break;
        case 'check':
            if (currentPlayer.currentBet < highestBet) throw new Error("Nu poți da check, trebuie să dai call sau raise.");
            break;
        case 'call': {
            const callAmount = highestBet - currentPlayer.currentBet;
            if (callAmount <= 0 && highestBet > 0) throw new Error("Nu poți da call, trebuie să dai check.");
            
            const effectiveCall = Math.min(callAmount, currentPlayer.stack);
            currentPlayer.stack -= effectiveCall;
            currentPlayer.currentBet += effectiveCall;
            if (currentPlayer.stack === 0) currentPlayer.status = 'all-in';
            break;
        }
        case 'raise': {
            const totalNewBet = amount;
            const raiseAmount = totalNewBet - currentPlayer.currentBet;
            const minRaise = highestBet + (game.lastRaiseAmount || game.options.bigBlind);

            if (totalNewBet < minRaise) throw new Error(`Raise-ul trebuie să fie cel puțin la ${minRaise}.`);
            if (raiseAmount > currentPlayer.stack) throw new Error("Fonduri insuficiente pentru acest raise.");

            currentPlayer.stack -= raiseAmount;
            currentPlayer.currentBet = totalNewBet;
            game.lastRaiserUsername = currentPlayer.username;
            game.lastRaiseAmount = totalNewBet - highestBet;

            game.players.forEach(p => {
                if (p.username !== currentPlayer.username && p.status === 'active') {
                    p.hasActed = false;
                }
            });
            
            if (currentPlayer.stack === 0) currentPlayer.status = 'all-in';
            break;
        }
        default:
            throw new Error(`Acțiune invalidă: ${action}`);
    }

    currentPlayer.hasActed = true;

    if (isRoundComplete(game)) {
        return advanceToNextState(game);
    } else {
        return moveToNextPlayer(game);
    }
}

function moveToNextPlayer(game) {
    const numPlayers = game.players.length;
    for(let i=1; i <= numPlayers; i++) {
        const nextIndex = (game.currentPlayerIndex + i) % numPlayers;
        const nextPlayer = game.players[nextIndex];
        if (nextPlayer.status === 'active' && !nextPlayer.hasActed) {
            game.currentPlayerIndex = nextIndex;
            return game;
        }
    }
    // Dacă nu găsim pe nimeni, înseamnă că runda s-a terminat
    return advanceToNextState(game);
}

function isRoundComplete(game) {
    const playersInHand = game.players.filter(p => p.status !== 'folded' && p.status !== 'out');
    if (playersInHand.length < 2) return true;

    const activePlayers = playersInHand.filter(p => p.status === 'active');
    if (activePlayers.length === 0) return true;
    
    const highestBet = Math.max(...playersInHand.map(p => p.currentBet));
    const allActivePlayersMatched = activePlayers.every(p => p.hasActed && p.currentBet === highestBet);
    
    return allActivePlayersMatched;
}

function advanceToNextState(game) {
    game.players.forEach(p => {
        game.pot += p.currentBet;
        p.currentBet = 0;
        p.hasActed = false;
    });
    game.lastRaiseAmount = 0;
    game.lastRaiserUsername = null;

    const playersLeft = game.players.filter(p => p.status !== 'folded' && p.status !== 'out');
    if (playersLeft.length <= 1) {
        return determineWinners(game);
    }

    switch (game.round) {
        case 'pre-flop': game.round = 'flop'; game.board.push(game.deck.pop(), game.deck.pop(), game.deck.pop()); break;
        case 'flop': game.round = 'turn'; game.board.push(game.deck.pop()); break;
        case 'turn': game.round = 'river'; game.board.push(game.deck.pop()); break;
        case 'river': return determineWinners(game);
    }

    game.currentPlayerIndex = (game.dealerIndex + 1) % game.players.length;
    while(game.players[game.currentPlayerIndex].status !== 'active') {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
    }

    return game;
}

function determineWinners(game) {
    game.players.forEach(p => { game.pot += p.currentBet; p.currentBet = 0; });

    const contenders = game.players.filter(p => p.status !== 'folded' && p.status !== 'out');
    
    if (contenders.length === 1) {
        contenders[0].stack += game.pot;
        contenders[0].isWinner = true;
    } else {
        // ... (logica de evaluare a mâinii, care este complexă și o putem adăuga ulterior)
        // Simplificat: primul jucător câștigă deocamdată
        const winner = contenders[0];
        winner.isWinner = true;
        winner.stack += game.pot;
    }
    
    game.round = 'showdown';
    game.currentPlayerIndex = -1;
    game.inProgress = false;
    return game;
}

module.exports = { startNewHand, handlePlayerAction };