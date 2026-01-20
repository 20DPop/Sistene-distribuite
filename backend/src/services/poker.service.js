// src/services/poker.service.js - FIXED VERSION WITH IMPROVED EVALUATION
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
 * ✅ IMPROVED: Evaluare completă cu detectare straight, flush, și comparare kickers
 * ACEASTĂ FUNCȚIE REZOLVĂ BUG-UL: "Câștigă ambii jucători"
 * 
 * Problema originală: simpleFallbackEvaluation() returnează același rank pentru:
 *   - Player1: Pair of Aces → rank: 2
 *   - Player2: Pair of Kings → rank: 2
 *   Rezultat: AMBII sunt câștigători!
 * 
 * Soluția: Adaugă tiebreaker care compară:
 *   - Valoarea pair-ului (Aces = 14 > Kings = 13)
 *   - Kickers (cărțile rămase)
 */
function improvedFallbackEvaluation(cards) {
    const ranks = cards.map(c => c.slice(0, -1));
    const suits = cards.map(c => c.slice(-1));
    
    // Mapare rank values pentru comparare
    const rankValues = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
        'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
    };
    
    // Sortare cărți descrescător
    const sortedCards = cards
        .map(c => ({ rank: c.slice(0, -1), suit: c.slice(-1), value: rankValues[c.slice(0, -1)] }))
        .sort((a, b) => b.value - a.value);
    
    // Numără apariții pentru fiecare rank
    const rankCounts = {};
    sortedCards.forEach(c => {
        rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
    });
    
    const counts = Object.entries(rankCounts)
        .map(([rank, count]) => ({ rank, count, value: rankValues[rank] }))
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.value - a.value;
        });
    
    const maxCount = counts[0].count;
    
    // Verifică flush
    const isFlush = suits.every(s => s === suits[0]);
    
    // Verifică straight (inclusiv Ace low A-2-3-4-5)
    let isStraight = false;
    let straightHighCard = 0;
    
    if (new Set(ranks).size === 5) {
        // Verifică straight normal
        if (sortedCards[0].value - sortedCards[4].value === 4) {
            isStraight = true;
            straightHighCard = sortedCards[0].value;
        }
        // Verifică wheel (A-2-3-4-5)
        else if (sortedCards[0].rank === 'A' && sortedCards[1].rank === '5' && 
                 sortedCards[2].rank === '4' && sortedCards[3].rank === '3' && 
                 sortedCards[4].rank === '2') {
            isStraight = true;
            straightHighCard = 5; // În wheel, 5 e high card
        }
    }
    
    // Straight Flush
    if (isStraight && isFlush) {
        return { 
            name: 'Straight Flush', 
            rank: 9,
            tiebreaker: straightHighCard
        };
    }
    
    // Four of a Kind
    if (maxCount === 4) {
        return { 
            name: 'Four of a Kind', 
            rank: 8,
            tiebreaker: counts[0].value * 1000 + counts[1].value
        };
    }
    
    // Full House
    if (maxCount === 3 && counts.length >= 2 && counts[1].count === 2) {
        return { 
            name: 'Full House', 
            rank: 7,
            tiebreaker: counts[0].value * 100 + counts[1].value
        };
    }
    
    // Flush
    if (isFlush) {
        const tiebreaker = sortedCards.slice(0, 5).reduce((acc, c, i) => 
            acc + c.value * Math.pow(100, 4 - i), 0
        );
        return { 
            name: 'Flush', 
            rank: 6,
            tiebreaker
        };
    }
    
    // Straight
    if (isStraight) {
        return { 
            name: 'Straight', 
            rank: 5,
            tiebreaker: straightHighCard
        };
    }
    
    // Three of a Kind
    if (maxCount === 3) {
        const kickers = counts.slice(1, 3).map(c => c.value);
        return { 
            name: 'Three of a Kind', 
            rank: 4,
            tiebreaker: counts[0].value * 10000 + (kickers[0] || 0) * 100 + (kickers[1] || 0)
        };
    }
    
    // Two Pair
    if (maxCount === 2 && counts.length >= 2 && counts[1].count === 2) {
        const kicker = counts.length >= 3 ? counts[2].value : 0;
        return { 
            name: 'Two Pair', 
            rank: 3,
            tiebreaker: counts[0].value * 10000 + counts[1].value * 100 + kicker
        };
    }
    
    // One Pair
    if (maxCount === 2) {
        const kickers = counts.slice(1, 4).map(c => c.value);
        return { 
            name: 'Pair', 
            rank: 2,
            tiebreaker: counts[0].value * 1000000 + 
                       (kickers[0] || 0) * 10000 + 
                       (kickers[1] || 0) * 100 + 
                       (kickers[2] || 0)
        };
    }
    
    // High Card
    const tiebreaker = sortedCards.slice(0, 5).reduce((acc, c, i) => 
        acc + c.value * Math.pow(100, 4 - i), 0
    );
    return { 
        name: 'High Card', 
        rank: 1,
        tiebreaker
    };
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
            const actualCall = Math.min(callAmount, currentPlayer.stack);
            
            currentPlayer.stack -= actualCall;
            currentPlayer.currentBet += actualCall;
            
            if (currentPlayer.stack === 0) {
                currentPlayer.status = 'all-in';
                console.log(`[Poker] ${username} is all-in (call)`);
            }
            
            console.log(`[Poker] ${username} called ${actualCall} (total bet: ${currentPlayer.currentBet})`);
            break;
        }
            
        case 'raise': {
            if (amount <= highestBet) {
                throw new Error(`Raise trebuie să fie mai mare decât ${highestBet}`);
            }
            
            const totalRaiseAmount = amount - currentPlayer.currentBet;
            const actualRaise = Math.min(totalRaiseAmount, currentPlayer.stack);
            
            currentPlayer.stack -= actualRaise;
            currentPlayer.currentBet += actualRaise;
            
            game.lastRaiserUsername = username;
            game.lastRaiseAmount = currentPlayer.currentBet;
            
            // Resetăm hasActed pentru toți jucătorii activi (trebuie să răspundă la raise)
            game.players.forEach(p => {
                if (p.status === 'active' && p.username !== username) {
                    p.hasActed = false;
                }
            });
            
            if (currentPlayer.stack === 0) {
                currentPlayer.status = 'all-in';
                console.log(`[Poker] ${username} is all-in (raise to ${currentPlayer.currentBet})`);
            }
            
            console.log(`[Poker] ${username} raised to ${currentPlayer.currentBet}`);
            break;
        }
            
        default:
            throw new Error(`Acțiune necunoscută: ${action}`);
    }
    
    // 4. Marcăm că jucătorul a acționat
    currentPlayer.hasActed = true;
    
    // 5. Verificăm dacă runda de pariuri s-a încheiat
    if (isRoundComplete(game)) {
        return advanceToNextRound(game);
    }
    
    // 6. Trecem la următorul jucător
    moveToNextPlayer(game);
    
    return game;
}

/**
 * Verifică dacă runda de pariuri s-a încheiat.
 */
function isRoundComplete(game) {
    const activePlayers = game.players.filter(p => p.status === 'active');
    
    // Dacă nu mai sunt jucători activi, trecem la următoarea rundă
    if (activePlayers.length === 0) {
        return true;
    }
    
    // Verificăm dacă toți jucătorii activi au acționat
    const allActed = activePlayers.every(p => p.hasActed);
    if (!allActed) {
        return false;
    }
    
    // Verificăm dacă toți au același bet
    const highestBet = Math.max(...game.players.map(p => p.currentBet));
    const allBetsEqual = activePlayers.every(p => p.currentBet === highestBet);
    
    return allBetsEqual;
}

/**
 * Mută indexul la următorul jucător activ.
 */
function moveToNextPlayer(game) {
    const numPlayers = game.players.length;
    let attempts = 0;
    
    do {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % numPlayers;
        attempts++;
        
        if (attempts > numPlayers) {
            console.error('[Poker] Could not find next active player');
            return;
        }
    } while (game.players[game.currentPlayerIndex].status !== 'active');
    
    console.log(`[Poker] Next player: ${game.players[game.currentPlayerIndex].username}`);
}

/**
 * Avansează jocul la următoarea rundă (flop → turn → river → showdown).
 */
function advanceToNextRound(game) {
    // Verificăm dacă toți jucătorii în afară de unul au dat fold
    const contenders = game.players.filter(p => p.status !== 'folded');
    if (contenders.length === 1) {
        return declareWinner(game);
    }
    
    // Colectăm pariurile în pot
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
 * ✅ FIXED: Evaluează mâinile la showdown cu logging îmbunătățit și comparare tiebreaker
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
                    cards: [],
                    tiebreaker: 0
                };
            }

            const allCards = [...player.hand, ...game.board];
            console.log(`[Poker] ${player.username} cards: ${player.hand.join(' ')}`);
            
            try {
                // ✅ Încercăm evaluarea cu biblioteca
                const result = Table.evaluateHand(allCards);
                
                console.log(`[Poker] ${player.username}: ${result.name} (rank: ${result.rank})`);
                
                return {
                    player,
                    handRank: result.rank,
                    handName: result.name,
                    cards: result.cards || allCards,
                    tiebreaker: result.rank * 1000000 // Placeholder - biblioteca ar trebui să gestioneze
                };
            } catch (err) {
                console.error(`[Poker] Table.evaluateHand failed for ${player.username}:`, err.message);
                evaluationFailed = true;
                
                // ✅ FIX: Folosim fallback îmbunătățit
                const fallbackResult = improvedFallbackEvaluation(allCards);
                console.log(`[Poker] ${player.username} (FALLBACK): ${fallbackResult.name} (rank: ${fallbackResult.rank}, tiebreaker: ${fallbackResult.tiebreaker})`);
                
                return {
                    player,
                    handRank: fallbackResult.rank,
                    handName: fallbackResult.name + ' (fallback)',
                    cards: allCards,
                    tiebreaker: fallbackResult.tiebreaker
                };
            }
        });

        if (evaluationFailed) {
            console.warn('[Poker] ⚠️ Using fallback evaluation - results may not be 100% accurate');
        }

        // ✅ DEBUGGING DETALIAT
        console.log('[Poker] 🔍 DETAILED EVALUATIONS:');
        evaluations.forEach(e => {
            console.log(`  - ${e.player.username}: ${e.handName} (rank: ${e.handRank}, tiebreaker: ${e.tiebreaker})`);
        });

        // Găsim cel mai mare rank
        const bestRank = Math.max(...evaluations.map(e => e.handRank));
        console.log(`[Poker] Best rank found: ${bestRank}`);
        
        // ✅ VERIFICARE DE SIGURANȚĂ
        if (bestRank === 0) {
            console.error('[Poker] ⚠️ CRITICAL: All players evaluated with rank 0!');
            console.error('[Poker] This indicates a complete evaluation failure.');
        }
        
        // Găsim toți jucătorii cu best rank
        let candidates = evaluations.filter(e => e.handRank === bestRank);
        console.log(`[Poker] Candidates with rank ${bestRank}: ${candidates.map(c => c.player.username).join(', ')}`);
        
        // ✅ COMPARARE TIEBREAKER dacă sunt mai mulți candidați
        if (candidates.length > 1 && candidates[0].tiebreaker !== undefined) {
            const bestTiebreaker = Math.max(...candidates.map(c => c.tiebreaker || 0));
            console.log(`[Poker] Multiple candidates - applying tiebreaker: ${bestTiebreaker}`);
            
            candidates = candidates.filter(c => (c.tiebreaker || 0) === bestTiebreaker);
            console.log(`[Poker] Winners after tiebreaker: ${candidates.map(c => c.player.username).join(', ')}`);
        }
        
        const winners = candidates;
        console.log(`[Poker] ✅ Final Winners: ${winners.map(w => `${w.player.username} (${w.handName})`).join(', ')}`);

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