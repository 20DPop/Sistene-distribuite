import React, { useState, useEffect } from 'react';

// ============================================================================
// COMPONENTA CARD - Afișează o carte de joc
// ============================================================================
const Card = ({ card }) => {
    // Dacă nu există carte, afișăm spatele cărții
    if (!card) {
        return (
            <div className="card text-white bg-danger" style={{ width: '80px', height: '110px', borderWidth: '3px' }}>
                <div className="card-body d-flex align-items-center justify-content-center">
                    <i className="bi bi-suit-spade-fill fs-2"></i>
                </div>
            </div>
        );
    }
    
    // ✅ FIX: Parsează cartea dacă e string (ex: "Ah" → {rank: "A", suit: "h"})
    let rank, suit;
    
    if (typeof card === 'string') {
        // Carte ca string: ultimul caracter = suit, restul = rank
        suit = card.slice(-1).toLowerCase(); // "h", "d", "c", "s"
        rank = card.slice(0, -1); // "A", "K", "Q", "J", "T", "9", etc.
    } else if (typeof card === 'object' && card.rank && card.suit) {
        // Carte ca obiect (backwards compatibility)
        rank = card.rank;
        suit = card.suit.toLowerCase();
    } else {
        // Carte invalidă
        console.error('[Card] Invalid card format:', card);
        return (
            <div className="card text-white bg-secondary" style={{ width: '80px', height: '110px' }}>
                <div className="card-body d-flex align-items-center justify-content-center">
                    <span className="text-white">?</span>
                </div>
            </div>
        );
    }
    
    // Simboluri pentru culori
    const suitSymbols = { 
        h: '♥',  // hearts
        d: '♦',  // diamonds
        c: '♣',  // clubs
        s: '♠'   // spades
    };
    
    // Roșu pentru inimă și caro, negru pentru treflă și pică
    const colorClass = (suit === 'h' || suit === 'd') ? 'text-danger' : 'text-dark';

    return (
        <div className="card bg-white" style={{ width: '80px', height: '110px', border: '2px solid #333' }}>
            <div className={`card-body d-flex flex-column justify-content-between p-1 ${colorClass} fw-bold`}>
                <span className="fs-6 lh-1">{rank}</span>
                <span className="fs-2 lh-1 align-self-center">{suitSymbols[suit] || '?'}</span>
                <span className="fs-6 lh-1 align-self-end" style={{ transform: 'rotate(180deg)' }}>{rank}</span>
            </div>
        </div>
    );
};

// ============================================================================
// COMPONENTA SHOWDOWN - Afișează câștigătorii la final de mână
// ============================================================================
const ShowdownDisplay = ({ players, onNewHand, isCreator }) => {
    const winners = players.filter(p => p.isWinner);
    const winnerNames = winners.map(p => p.username).join(', ');

    return (
        <div 
            className="position-absolute top-50 start-50 translate-middle bg-dark bg-opacity-75 p-4 rounded text-white text-center shadow-lg" 
            style={{ zIndex: 100, maxWidth: '90%' }}
        >
            <h2 className="text-warning mb-3">
                <i className="bi bi-trophy-fill me-2"></i>
                Showdown!
            </h2>
            
            <h4 className="mb-4">
                Câștigător: <span className="text-success fw-bold">{winnerNames}</span>
            </h4>
            
            {/* Afișează mâinile tuturor jucătorilor care nu au foldat */}
            <div className="d-flex flex-column gap-3 mb-4" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                {players
                    .filter(p => p.status !== 'folded' && p.hand && p.hand.length > 0)
                    .map(player => (
                        <div key={player.username} className="bg-dark bg-opacity-50 p-2 rounded">
                            <div className="mb-2">
                                <strong className="fs-5">{player.username}</strong>
                                {player.isWinner && (
                                    <span className="badge bg-success ms-2">
                                        <i className="bi bi-trophy-fill me-1"></i>
                                        WINNER
                                    </span>
                                )}
                            </div>
                            
                            <div className="d-flex justify-content-center align-items-center gap-2 flex-wrap">
                                {player.hand.map((c, i) => (
                                    <Card key={i} card={c} />
                                ))}
                                
                                {player.evaluatedHand && (
                                    <span className="ms-2 fst-italic text-warning">
                                        ({player.evaluatedHand.name})
                                    </span>
                                )}
                            </div>
                        </div>
                    ))
                }
            </div>

            {/* Buton pentru mâna următoare - doar pentru creator */}
            {isCreator ? (
                <button className="btn btn-lg btn-primary px-4" onClick={onNewHand}>
                    <i className="bi bi-arrow-clockwise me-2"></i>
                    Începe Mâna Următoare
                </button>
            ) : (
                <p className="text-muted fst-italic mb-0">
                    <i className="bi bi-hourglass-split me-2"></i>
                    Așteaptă ca gazda să înceapă mâna următoare...
                </p>
            )}
        </div>
    );
};

// ============================================================================
// COMPONENTA PRINCIPALĂ - POKER TABLE
// ============================================================================
const PokerTable = ({ 
    pokerState, 
    myHand, 
    username, 
    onPokerAction, 
    onStartGame, 
    onNewHand, 
    onLeaveGame 
}) => {
    
    // ========== LOADING STATE ==========
    if (!pokerState) {
        return (
            <div className="d-flex align-items-center justify-content-center h-100 bg-dark text-white">
                <div className="text-center">
                    <div className="spinner-border text-primary mb-3" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                    <h3>Se încarcă masa...</h3>
                </div>
            </div>
        );
    }

    // ========== EXTRAGERE DATE DIN STATE ==========
    const options = pokerState.options || {};
    const maxPlayers = options.maxPlayers || 9;
    const minPlayers = options.minPlayers || 2;
    const players = pokerState.players || [];
    const board = pokerState.board || [];
    const pot = pokerState.pot || 0;
    const round = pokerState.round || 'pre-game';
    const currentPlayerIndex = pokerState.currentPlayerIndex;
    const isCreator = username === pokerState.creatorUsername;
    
    // Debug logging (util pentru debugging)
    console.log('[PokerTable] State:', {
        gameId: pokerState.gameId,
        inProgress: pokerState.inProgress,
        round: round,
        maxPlayers: maxPlayers,
        minPlayers: minPlayers,
        playersCount: players.length,
        pot: pot,
        boardCards: board.length,
        currentPlayerIndex: currentPlayerIndex,
        myHand: myHand
    });

    // ========== ECRAN DE AȘTEPTARE (PRE-GAME) ==========
    if (!pokerState.inProgress) {
        return (
            <div className="container-fluid d-flex flex-column align-items-center justify-content-center h-100 text-center p-4 bg-light">
                {/* Header */}
                <div className="mb-4">
                    <h1 className="display-5 mb-2">
                        <i className="bi bi-suit-spade-fill text-dark me-2"></i>
                        Masa: <span className="text-primary">{pokerState.gameId}</span>
                    </h1>
                    
                    <p className="lead text-muted mb-1">
                        <i className="bi bi-info-circle me-2"></i>
                        Small Blind: <strong>{options.smallBlind}</strong> | Big Blind: <strong>{options.bigBlind}</strong>
                    </p>
                </div>

                {/* Lista Jucători */}
                <div className="card shadow-lg mb-4" style={{ maxWidth: '600px', width: '100%' }}>
                    <div className="card-header bg-primary text-white">
                        <h5 className="mb-0">
                            <i className="bi bi-people-fill me-2"></i>
                            Jucători ({players.length} / {maxPlayers})
                        </h5>
                    </div>
                    <ul className="list-group list-group-flush">
                        {players.length > 0 ? (
                            players.map((player, idx) => (
                                <li key={player.username} className="list-group-item d-flex justify-content-between align-items-center">
                                    <div>
                                        <strong className="me-2">{idx + 1}.</strong>
                                        {player.username}
                                        {player.username === pokerState.creatorUsername && (
                                            <span className="badge bg-warning text-dark ms-2">Gazdă</span>
                                        )}
                                    </div>
                                    <span className="badge bg-secondary rounded-pill">
                                        <i className="bi bi-coin me-1"></i>
                                        {player.stack}
                                    </span>
                                </li>
                            ))
                        ) : (
                            <li className="list-group-item text-muted fst-italic">
                                Nu există jucători...
                            </li>
                        )}
                    </ul>
                </div>

                {/* Status & Control Buttons */}
                <div>
                    {players.length < minPlayers ? (
                        <div className="alert alert-warning" role="alert">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            Se așteaptă mai mulți jucători (minim {minPlayers} necesari)
                        </div>
                    ) : isCreator ? (
                        <button 
                            className="btn btn-lg btn-success px-5"
                            onClick={onStartGame}
                        >
                            <i className="bi bi-play-circle-fill me-2"></i>
                            Începe Jocul
                        </button>
                    ) : (
                        <div className="alert alert-info" role="alert">
                            <i className="bi bi-hourglass-split me-2"></i>
                            Așteaptă ca gazda să înceapă jocul...
                        </div>
                    )}
                </div>
                
                {/* Buton Leave */}
                <div className="mt-4">
                    <button 
                        className="btn btn-outline-danger"
                        onClick={onLeaveGame}
                    >
                        <i className="bi bi-door-open me-2"></i>
                        Părăsește Masa
                    </button>
                </div>
            </div>
        );
    }
    
    // ========== JOC ÎN DESFĂȘURARE ==========
    
    // State pentru betting
    const [betAmount, setBetAmount] = useState(options.bigBlind * 2 || 20);
    
    // Găsim jucătorul curent (eu) și verificăm dacă e rândul meu
    const me = players.find(p => p.username === username);
    const myIndex = players.findIndex(p => p.username === username);
    
    // ✅ FIX PROBLEMA 2: Verificăm index-ul, nu token-ul
    const isMyTurn = myIndex !== -1 && myIndex === currentPlayerIndex && me && me.status === 'active';
    
    // Găsim jucătorul curent pentru afișare
    const currentPlayer = currentPlayerIndex >= 0 && currentPlayerIndex < players.length 
        ? players[currentPlayerIndex] 
        : null;
    
    // Calculăm highest bet și call amount
    const highestBet = Math.max(0, ...players.map(p => p.currentBet || 0));
    const callAmount = highestBet - (me?.currentBet || 0);

    // Debug pentru turn checking
    console.log('[PokerTable] Turn Check:', {
        username,
        myIndex,
        currentPlayerIndex,
        isMyTurn,
        myStatus: me?.status,
        currentPlayerUsername: currentPlayer?.username
    });

    // Update bet amount când se schimbă highest bet
    useEffect(() => {
        const minRaise = highestBet + (options.bigBlind || 20);
        if (betAmount < minRaise) {
            setBetAmount(minRaise);
        }
    }, [highestBet, options.bigBlind, betAmount]);

    return (
        <div className="d-flex flex-column h-100" style={{ backgroundColor: '#1a5f3f', color: 'white' }}>
            
            {/* ========== ZONA DE JOC PRINCIPALĂ ========== */}
            <div className="flex-grow-1 d-flex align-items-center justify-content-center position-relative p-3">
                
                {/* Board & Pot (centru) */}
                <div className="text-center">
                    <h2 className="mb-3">
                        <i className="bi bi-coin me-2"></i>
                        Pot: <span className="badge bg-warning text-dark fs-3">{pot}</span>
                    </h2>
                    
                    {/* Cărțile de pe masă */}
                    <div className="d-flex justify-content-center gap-2 mb-3">
                        {board.map((card, index) => (
                            <Card key={index} card={card} />
                        ))}
                        {/* Cărți nedeschise */}
                        {Array(5 - board.length).fill(null).map((_, index) => (
                            <Card key={`back-${index}`} card={null} />
                        ))}
                    </div>
                    
                    {/* Indicator rundă */}
                    <div className="badge bg-secondary fs-6 text-uppercase">
                        {round === 'pre-flop' && 'Pre-Flop'}
                        {round === 'flop' && 'Flop'}
                        {round === 'turn' && 'Turn'}
                        {round === 'river' && 'River'}
                        {round === 'showdown' && 'Showdown'}
                        {round === 'pre-game' && 'Așteptare'}
                    </div>
                </div>

                {/* ========== LISTA JUCĂTORI (stânga sus) ========== */}
                <div 
                    className="position-absolute top-0 start-0 p-3 bg-dark bg-opacity-75 rounded m-2" 
                    style={{ zIndex: 1, maxHeight: '50vh', overflowY: 'auto' }}
                >
                    <h6 className="text-white mb-3">
                        <i className="bi bi-people-fill me-2"></i>
                        Jucători:
                    </h6>
                    <ul className="list-unstyled">
                        {players.map((player, idx) => {
                            const isCurrentPlayer = idx === currentPlayerIndex;
                            return (
                                <li 
                                    key={player.username} 
                                    className={`p-2 rounded mb-2 ${
                                        isCurrentPlayer ? 'bg-warning text-dark' : 
                                        player.status === 'folded' ? 'bg-secondary bg-opacity-50 text-muted' :
                                        player.status === 'all-in' ? 'bg-info text-white' :
                                        'bg-dark bg-opacity-75 text-white'
                                    }`}
                                    style={{ minWidth: '200px' }}
                                >
                                    <div className="d-flex justify-content-between align-items-center">
                                        <strong>
                                            {isCurrentPlayer && (
                                                <i className="bi bi-arrow-right-circle-fill me-1"></i>
                                            )}
                                            {player.username}
                                        </strong>
                                        
                                        {player.status === 'folded' && (
                                            <span className="badge bg-danger">Fold</span>
                                        )}
                                        {player.status === 'all-in' && (
                                            <span className="badge bg-primary">All-in</span>
                                        )}
                                    </div>
                                    
                                    <small className="d-block mt-1">
                                        <i className="bi bi-coin me-1"></i>
                                        Fise: <strong>{player.stack}</strong>
                                    </small>
                                    
                                    {player.currentBet > 0 && (
                                        <small className="d-block">
                                            <i className="bi bi-cash-stack me-1"></i>
                                            Pariu: <strong>{player.currentBet}</strong>
                                        </small>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>

                {/* ========== MÂINILE MELE (jos centru) ========== */}
                <div className="position-absolute bottom-0 mb-5 d-flex gap-3">
                    {myHand && myHand.length > 0 ? (
                        <>
                            <Card card={myHand[0]} />
                            <Card card={myHand[1]} />
                        </>
                    ) : (
                        me && me.status !== 'folded' && (
                            <div className="text-white-50 fst-italic">
                                Așteptând cărți...
                            </div>
                        )
                    )}
                </div>

                {/* ========== SHOWDOWN OVERLAY ========== */}
                {round === 'showdown' && (
                    <ShowdownDisplay 
                        players={players} 
                        onNewHand={onNewHand} 
                        isCreator={isCreator} 
                    />
                )}
            </div>

            {/* ========== FOOTER - CONTROALE DE JOC ========== */}
            <footer className="py-3 px-4 bg-dark flex-shrink-0">
                {isMyTurn && round !== 'showdown' ? (
                    <div className="d-flex justify-content-center align-items-center gap-2 flex-wrap">
                        {/* Buton Fold */}
                        <button 
                            className="btn btn-lg btn-danger px-4"
                            onClick={() => onPokerAction('fold')}
                        >
                            <i className="bi bi-x-circle-fill me-2"></i>
                            Fold
                        </button>
                        
                        {/* Buton Call / Check */}
                        {callAmount > 0 ? (
                            <button 
                                className="btn btn-lg btn-primary px-4"
                                onClick={() => onPokerAction('call')}
                            >
                                <i className="bi bi-check-circle-fill me-2"></i>
                                Call {callAmount}
                            </button>
                        ) : (
                            <button 
                                className="btn btn-lg btn-secondary px-4"
                                onClick={() => onPokerAction('check')}
                            >
                                <i className="bi bi-hand-index me-2"></i>
                                Check
                            </button>
                        )}

                        {/* Input și Buton Raise */}
                        <div className="input-group" style={{ width: '280px' }}>
                            <span className="input-group-text">
                                <i className="bi bi-arrow-up-circle-fill"></i>
                            </span>
                            <input 
                                type="number" 
                                className="form-control form-control-lg"
                                value={betAmount}
                                onChange={(e) => setBetAmount(parseInt(e.target.value, 10) || 0)}
                                min={highestBet + (options.bigBlind || 20)}
                                step={options.bigBlind || 10}
                                max={me?.stack || 1000}
                            />
                            <button 
                                className="btn btn-lg btn-warning text-dark fw-bold" 
                                onClick={() => onPokerAction('raise', betAmount)}
                                disabled={betAmount < highestBet + (options.bigBlind || 20)}
                            >
                                Raise
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-muted">
                        {round === 'showdown' ? (
                            <span>
                                <i className="bi bi-trophy me-2"></i>
                                Mâna s-a terminat.
                            </span>
                        ) : me?.status === 'folded' ? (
                            <span>
                                <i className="bi bi-x-circle me-2"></i>
                                Ai dat fold.
                            </span>
                        ) : me?.status === 'all-in' ? (
                            <span>
                                <i className="bi bi-exclamation-circle me-2"></i>
                                Ești all-in!
                            </span>
                        ) : currentPlayer ? (
                            <span>
                                <i className="bi bi-hourglass-split me-2"></i>
                                Așteaptă rândul tău... (Rândul lui {currentPlayer.username})
                            </span>
                        ) : (
                            <span>
                                <i className="bi bi-hourglass-split me-2"></i>
                                Așteaptă...
                            </span>
                        )}
                    </div>
                )}
            </footer>

            {/* ========== BUTON LEAVE (fix jos) ========== */}
            <div className="text-center py-2 border-top border-secondary" style={{ backgroundColor: 'rgba(0,0,0,0.3)'}}>
                <button 
                    className="btn btn-sm btn-outline-light"
                    onClick={onLeaveGame}
                >
                    <i className="bi bi-door-open me-2"></i>
                    Părăsește Masa (Înapoi la Lobby)
                </button>
            </div>
        </div>
    );
};

export default PokerTable;
