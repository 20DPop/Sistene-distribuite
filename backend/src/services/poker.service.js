// src/services/poker.service.js - FIXED VERSION
const Table = require('holdem-poker').Table;

const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/**
 * Creează un pachet de cărți amestecat.
 * @returns {Array<string>} Pachetul de cărți (e.g., ["Ah", "Kd", "Qc", ...])
 */
function createShuffledDeck() {
    const deck = SUITS.flatMap(suit => RANKS.map(rank => rank + suit));
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * ✅ FIX: Evaluare simplificată de fallback pentru când biblioteca nu funcționează
 * Returnează un rank simplificat bazat pe numărul de cărți identice
 */
function simpleFallbackEvaluation(cards) {
    const ranks = cards.map(c => c.slice(0, -1));
    const suits = cards.map(c => c.slice(-1));
    
    // Numără apariții pentru fiecare rank
    const rankCounts = {};
    ranks.forEach(r => {
        rankCounts[r] = (rankCounts[r] || 0) + 1;
    });
    
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const maxCount = counts[0];
    
    // Verifică flush (toate aceleași suit)
    const isFlush = suits.every(s => s === suits[0]);
    
    // Evaluare simplă
    if (maxCount === 4) {
        return { name: 'Four of a Kind', rank: 8 };
    } else if (maxCount === 3 && counts[1] === 2) {
        return { name: 'Full House', rank: 7 };
    } else if (isFlush) {
        return { name: 'Flush', rank: 6 };
    } else if (maxCount === 3) {
        return { name: 'Three of a Kind', rank: 4 };
    } else if (maxCount === 2 && counts[1] === 2) {
        return { name: 'Two Pair', rank: 3 };
    } else if (maxCount === 2) {
        return { name: 'Pair', rank: 2 };
    }
    
    return { name: 'High Card', rank: 1 };
}

/**
 * Resetează și începe o nouă mână de poker.
 * @param {object} game Starea curentă a jocului
 * @returns {object} Starea actualizată a jocului
 */
function startNewHand(game) {
    console.log('[Poker] Starting new hand...');
    
    // 1. Curățare și Filtrare - eliminăm jucătorii fără stack
    game.players = game.players.filter(p => p.stack > 0);

    if (game.players.length < game.options.minPlayers) {
        game.inProgress = false;
        game.round = 'finished';
        game.currentPlayerIndex = -1;
        throw new Error("Nu sunt suficienți jucători pentru a continua jocul.");
    }
    
    // 2. Reset stare joc
    game.pot = 0;
    game.board = [];
    game.deck = createShuffledDeck();
    
    // 3. Resetare stare jucători
    game.players.forEach(p => {
        p.hand = [];
        p.currentBet = 0;
        p.hasActed = false;
        p.isWinner = false;
        p.evaluatedHand = null;
        p.status = 'active'; 
    });

    // 4. Dealer Button Logic
    const numPlayers = game.players.length;
    game.dealerIndex = (game.dealerIndex + 1) % numPlayers;
    
    let sbIndex = (game.dealerIndex + 1) % numPlayers;
    let bbIndex = (game.dealerIndex + 2) % numPlayers;
    
    const smallBlindPlayer = game.players[sbIndex];
    const bigBlindPlayer = game.players[bbIndex];
    
    console.log(`[Poker] Dealer: ${game.players[game.dealerIndex].username}, SB: ${smallBlindPlayer.username}, BB: ${bigBlindPlayer.username}`);
    
    // 5. Plată Blind-uri
    
    // Small Blind
    const sbAmount = Math.min(smallBlindPlayer.stack, game.options.smallBlind);
    smallBlindPlayer.stack -= sbAmount;
    smallBlindPlayer.currentBet = sbAmount;
    
    // Big Blind
    const bbAmount = Math.min(bigBlindPlayer.stack, game.options.bigBlind);
    bigBlindPlayer.stack -= bbAmount;
    bigBlindPlayer.currentBet = bbAmount;

    // 6. Distribuirea cărților și setarea statusului All-in dacă este cazul
    game.players.forEach(p => {
        p.hand.push(game.deck.pop(), game.deck.pop());
        if (p.stack === 0 && p.currentBet > 0) {
            p.status = 'all-in';
            console.log(`[Poker] ${p.username} is all-in with blinds`);
        }
    });

    // 7. Primul la acțiune (UTG - după big blind)
    game.currentPlayerIndex = (bbIndex + 1) % numPlayers;
    
    // Dacă UTG este all-in (caz rar, dar posibil), sărim peste el
    let attempts = 0;
    while (game.players[game.currentPlayerIndex].status !== 'active' && attempts < numPlayers) {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % numPlayers;
        attempts++;
    }
    
    // 8. Asigurăm că blindurile au acționat
    smallBlindPlayer.hasActed = true;
    bigBlindPlayer.hasActed = true;

    // Resetăm acțiunea pentru primul jucător activ
    if(game.players[game.currentPlayerIndex] && game.players[game.currentPlayerIndex].status === 'active') {
        game.players[game.currentPlayerIndex].hasActed = false;
    }

    game.lastRaiserUsername = bigBlindPlayer.username;
    game.lastRaiseAmount = game.options.bigBlind;
    game.round = 'pre-flop';
    game.inProgress = true;
    
    console.log(`[Poker] Hand started. Current player: ${game.players[game.currentPlayerIndex].username}`);
    
    return game;
}

/**
 * Gestionează acțiunea trimisă de un jucător.
 * @param {object} game Starea jocului
 * @param {string} username Numele jucătorului care acționează
 * @param {string} action Acțiunea ('fold', 'check', 'call', 'raise', 'start_game', 'start_new_hand')
 * @param {number} amount Suma totală pariată (doar pentru raise)
 * @returns {object} Starea jocului actualizată
 */
function handlePlayerAction(game, username, action, amount = 0) {
    // 1. Acțiuni de Setup (Start Game / New Hand)
    const isCreator = username === game.creatorUsername;
    
    if (action === 'start_game') {
        if (!isCreator) throw new Error("Doar creatorul poate începe jocul.");
        if (game.players.length < game.options.minPlayers) {
            throw new Error(`Minim ${game.options.minPlayers} jucători necesari.`);
        }
        
        game.inProgress = true;
        return startNewHand(game);
    }
    
    if (action === 'start_new_hand') {
        if (!isCreator) throw new Error("Doar creatorul poate începe mâna nouă.");
        if (game.round !== 'showdown' && game.round !== 'finished') {
            throw new Error("Runda curentă nu s-a terminat.");
        }
        return startNewHand(game);
    }

    // 2. Validare acțiuni de joc
    if (!game.inProgress || game.round === 'showdown' || game.round === 'finished') {
        throw new Error("Jocul nu este în desfășurare.");
    }
    
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.username !== username) {
        throw new Error("Nu este rândul tău.");
    }
    if (currentPlayer.status !== 'active' && currentPlayer.status !== 'all-in') {
        throw new Error("Nu poți acționa în starea curentă.");
    }

    const highestBet = Math.max(...game.players.map(p => p.currentBet));
    
    // Jucătorii All-in nu pot acționa
    if (currentPlayer.status === 'all-in') {
        throw new Error("Ești All-in și nu mai poți acționa.");
    }
    
    console.log(`[Poker] ${username} action: ${action}, amount: ${amount}, highestBet: ${highestBet}, currentBet: ${currentPlayer.currentBet}`);
    
    // 3. Executarea acțiunii
    switch (action.toLowerCase()) {
        case 'fold':
            currentPlayer.status = 'folded';
            console.log(`[Poker] ${username} folded`);
            break;
            
        case 'check':
            if (currentPlayer.currentBet < highestBet) {
                throw new Error("Nu poți da check, trebuie să dai call sau raise.");
            }
            console.log(`[Poker] ${username} checked`);
            break;
            
        case 'call': {
            const callAmount = highestBet - currentPlayer.currentBet;
            if (callAmount <= 0) {
                throw new Error("Nu poți da call, folosește Check.");
            }
            
            const effectiveCall = Math.min(callAmount, currentPlayer.stack);
            currentPlayer.stack -= effectiveCall;
            currentPlayer.currentBet += effectiveCall;
            
            if (currentPlayer.stack === 0) {
                currentPlayer.status = 'all-in';
                console.log(`[Poker] ${username} called ${effectiveCall} (ALL-IN)`);
            } else {
                console.log(`[Poker] ${username} called ${effectiveCall}`);
            }
            break;
        }
            
        case 'raise': {
            const raiseAmount = amount;
            
            if (raiseAmount <= highestBet) {
                throw new Error("Raise-ul trebuie să fie mai mare decât highest bet.");
            }
            
            const minRaise = highestBet + game.options.bigBlind;
            if (raiseAmount < minRaise) {
                throw new Error(`Raise-ul minim este ${minRaise}.`);
            }
            
            const totalNeeded = raiseAmount - currentPlayer.currentBet;
            
            if (totalNeeded > currentPlayer.stack) {
                throw new Error("Nu ai suficiente fise pentru acest raise.");
            }
            
            currentPlayer.stack -= totalNeeded;
            currentPlayer.currentBet = raiseAmount;
            
            game.lastRaiserUsername = username;
            game.lastRaiseAmount = raiseAmount;
            
            // Resetăm hasActed pentru toți jucătorii activi
            game.players.forEach(p => {
                if (p.status === 'active' && p.username !== username) {
                    p.hasActed = false;
                }
            });
            
            if (currentPlayer.stack === 0) {
                currentPlayer.status = 'all-in';
                console.log(`[Poker] ${username} raised to ${raiseAmount} (ALL-IN)`);
            } else {
                console.log(`[Poker] ${username} raised to ${raiseAmount}`);
            }
            break;
        }
            
        default:
            throw new Error(`Acțiune invalidă: ${action}`);
    }
    
    // 4. Marchează jucătorul ca având acționat
    currentPlayer.hasActed = true;
    
    // 5. Adaugă bet-ul curent la pot
    const totalBets = game.players.reduce((sum, p) => sum + p.currentBet, 0);
    
    // 6. Avansează la următorul jucător sau rundă
    return advanceGame(game);
}

/**
 * Avansează jocul la următorul jucător sau rundă.
 * @param {object} game Starea jocului
 * @returns {object} Starea actualizată
 */
function advanceGame(game) {
    const activePlayers = game.players.filter(p => p.status === 'active');
    const allInPlayers = game.players.filter(p => p.status === 'all-in');
    const foldedPlayers = game.players.filter(p => p.status === 'folded');
    
    const playersInHand = activePlayers.length + allInPlayers.length;
    
    // Dacă doar un jucător a rămas (toți ceilalți au dat fold)
    if (playersInHand === 1) {
        return declareWinner(game);
    }
    
    // Verificăm dacă toți jucătorii activi au acționat
    const allActed = activePlayers.every(p => p.hasActed);
    
    // Verificăm dacă toți au același bet (sau sunt all-in/folded)
    const highestBet = Math.max(...game.players.map(p => p.currentBet));
    const allBetsEqual = activePlayers.every(p => p.currentBet === highestBet);
    
    if (allActed && allBetsEqual) {
        // Toți au acționat și bet-urile sunt egale -> trecem la următoarea rundă
        return advanceToNextRound(game);
    }
    
    // Găsim următorul jucător activ
    let nextIndex = (game.currentPlayerIndex + 1) % game.players.length;
    let attempts = 0;
    
    while (attempts < game.players.length) {
        const nextPlayer = game.players[nextIndex];
        
        if (nextPlayer.status === 'active') {
            game.currentPlayerIndex = nextIndex;
            console.log(`[Poker] Next player: ${nextPlayer.username}`);
            return game;
        }
        
        nextIndex = (nextIndex + 1) % game.players.length;
        attempts++;
    }
    
    // Dacă nu mai există jucători activi (toți all-in/folded)
    return advanceToNextRound(game);
}

/**
 * Avansează la următoarea rundă (flop, turn, river, showdown).
 * @param {object} game Starea jocului
 * @returns {object} Starea actualizată
 */
function advanceToNextRound(game) {
    // Colectăm bet-urile în pot
    const totalBets = game.players.reduce((sum, p) => sum + p.currentBet, 0);
    game.pot += totalBets;
    
    // Resetăm bet-urile jucătorilor
    game.players.forEach(p => {
        p.currentBet = 0;
        p.hasActed = false;
    });
    
    console.log(`[Poker] Pot updated: ${game.pot}`);
    
    // Determinăm următoarea rundă
    switch (game.round) {
        case 'pre-flop':
            // Flop: 3 cărți
            game.board.push(game.deck.pop(), game.deck.pop(), game.deck.pop()); 
            game.round = 'flop';
            console.log(`[Poker] Flop: ${game.board.join(' ')}`);
            break;
            
        case 'flop':
            // Turn: 1 carte
            game.board.push(game.deck.pop()); 
            game.round = 'turn';
            console.log(`[Poker] Turn: ${game.board.join(' ')}`);
            break;
            
        case 'turn':
            // River: 1 carte
            game.board.push(game.deck.pop()); 
            game.round = 'river';
            console.log(`[Poker] River: ${game.board.join(' ')}`);
            break;
            
        case 'river':
            // Showdown
            return evaluateShowdown(game);
            
        default:
            console.error(`[Poker] Invalid round: ${game.round}`);
            return game;
    }
    
    // Găsim primul jucător activ după dealer pentru următoarea rundă
    let startIndex = (game.dealerIndex + 1) % game.players.length;
    let attempts = 0;
    
    while (attempts < game.players.length) {
        if (game.players[startIndex].status === 'active') {
            game.currentPlayerIndex = startIndex;
            console.log(`[Poker] ${game.round} begins. Current player: ${game.players[startIndex].username}`);
            return game;
        }
        startIndex = (startIndex + 1) % game.players.length;
        attempts++;
    }
    
    // Dacă nu mai există jucători activi (toți all-in), trecem direct la următoarea rundă
    console.log('[Poker] All players all-in, auto-advancing...');
    return advanceToNextRound(game);
}

/**
 * Declară câștigătorul când toți ceilalți au dat fold.
 * @param {object} game Starea jocului
 * @returns {object} Starea actualizată
 */
function declareWinner(game) {
    const contenders = game.players.filter(p => p.status !== 'folded');
    
    if (contenders.length === 1) {
        const winner = contenders[0];
        winner.stack += game.pot;
        winner.isWinner = true;
        console.log(`[Poker] ${winner.username} wins by default (pot: ${game.pot})`);
        game.round = 'showdown';
        game.currentPlayerIndex = -1;
        return game;
    }
    
    return evaluateShowdown(game);
}

/**
 * ✅ FIXED: Evaluează mâinile la showdown cu logging îmbunătățit și fallback
 * @param {object} game Starea jocului
 * @returns {object} Starea actualizată
 */
function evaluateShowdown(game) {
    const contenders = game.players.filter(p => p.status !== 'folded');
    
    if (contenders.length === 0) {
        console.error('[Poker] No contenders at showdown!');
        game.round = 'showdown';
        return game;
    }
    
    if (contenders.length === 1) {
        const winner = contenders[0];
        winner.stack += game.pot;
        winner.isWinner = true;
        console.log(`[Poker] ${winner.username} wins by default (pot: ${game.pot})`);
        game.round = 'showdown';
        game.currentPlayerIndex = -1;
        return game;
    }

    // SHOWDOWN REAL - Evaluare mâini
    console.log(`[Poker] ====== SHOWDOWN ======`);
    console.log(`[Poker] Board: ${game.board.join(' ')}`);
    console.log(`[Poker] Contenders: ${contenders.map(p => p.username).join(', ')}`);
    
    let evaluations = [];
    let evaluationFailed = false;
    
    try {
        // Încercăm mai întâi cu biblioteca holdem-poker
        evaluations = contenders.map(player => {
            if (!player.hand || player.hand.length !== 2) {
                console.warn(`[Poker] ${player.username} has invalid hand`);
                return {
                    player,
                    handRank: 0,
                    handName: 'Invalid Hand',
                    cards: []
                };
            }

            const allCards = [...player.hand, ...game.board];
            console.log(`[Poker] ${player.username} cards: ${player.hand.join(' ')}`);
            
            try {
                // ✅ FIX: Încercăm evaluarea cu biblioteca
                const result = Table.evaluateHand(allCards);
                
                console.log(`[Poker] ${player.username}: ${result.name} (rank: ${result.rank})`);
                
                return {
                    player,
                    handRank: result.rank,
                    handName: result.name,
                    cards: result.cards || allCards
                };
            } catch (err) {
                console.error(`[Poker] Table.evaluateHand failed for ${player.username}:`, err.message);
                evaluationFailed = true;
                
                // ✅ FIX: Folosim fallback simplu
                const fallbackResult = simpleFallbackEvaluation(allCards);
                console.log(`[Poker] ${player.username} (FALLBACK): ${fallbackResult.name} (rank: ${fallbackResult.rank})`);
                
                return {
                    player,
                    handRank: fallbackResult.rank,
                    handName: fallbackResult.name + ' (fallback)',
                    cards: allCards
                };
            }
        });

        if (evaluationFailed) {
            console.warn('[Poker] ⚠️ Using fallback evaluation - results may not be 100% accurate');
        }

        // Găsim cel mai mare rank
        const bestRank = Math.max(...evaluations.map(e => e.handRank));
        console.log(`[Poker] Best rank: ${bestRank}`);
        
        // Găsim toți câștigătorii
        const winners = evaluations.filter(e => e.handRank === bestRank);
        console.log(`[Poker] Winners: ${winners.map(w => `${w.player.username} (${w.handName})`).join(', ')}`);

        // Salvăm evaluările în obiectele jucătorilor
        evaluations.forEach(e => {
            e.player.evaluatedHand = {
                name: e.handName,
                rank: e.handRank
            };
        });

        // Împărțim potul între câștigători
        const winAmount = Math.floor(game.pot / winners.length);
        const remainder = game.pot % winners.length;

        winners.forEach((w, index) => {
            w.player.stack += winAmount;
            if (index === 0) {
                w.player.stack += remainder;
            }
            w.player.isWinner = true;
            console.log(`[Poker] ${w.player.username} wins ${winAmount + (index === 0 ? remainder : 0)} with ${w.handName}`);
        });

    } catch (error) {
        console.error('[Poker Evaluation CRITICAL Error]', error);
        console.error('[Poker] Stack trace:', error.stack);
        
        // ✅ FIX: Fallback complet - împărțim egal
        console.log('[Poker] ⚠️ CRITICAL: Using emergency fallback (equal split)');
        
        const shareAmount = Math.floor(game.pot / contenders.length);
        const remainder = game.pot % contenders.length;
        
        contenders.forEach((player, index) => {
            player.stack += shareAmount;
            if (index === 0) player.stack += remainder;
            player.isWinner = true;
            player.evaluatedHand = { name: 'Error - Equal Split', rank: 0 };
            console.log(`[Poker] ${player.username} wins ${shareAmount + (index === 0 ? remainder : 0)} (emergency split)`);
        });
    }
    
    game.round = 'showdown';
    game.currentPlayerIndex = -1;
    console.log(`[Poker] ====== SHOWDOWN END ======`);
    return game;
}

module.exports = { startNewHand, handlePlayerAction };
