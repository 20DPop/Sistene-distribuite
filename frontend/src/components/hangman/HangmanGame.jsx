import React, { useState } from 'react';

const HangmanDrawing = ({ mistakes }) => {
    const bodyParts = [
        <circle key="head" cx="140" cy="70" r="20" stroke="white" strokeWidth="4" fill="none" />,
        <line key="body" x1="140" y1="90" x2="140" y2="150" stroke="white" strokeWidth="4" />,
        <line key="arm1" x1="140" y1="120" x2="110" y2="100" stroke="white" strokeWidth="4" />,
        <line key="arm2" x1="140" y1="120" x2="170" y2="100" stroke="white" strokeWidth="4" />,
        <line key="leg1" x1="140" y1="150" x2="110" y2="180" stroke="white" strokeWidth="4" />,
        <line key="leg2" x1="140" y1="150" x2="170" y2="180" stroke="white" strokeWidth="4" />,
    ];

    return (
        <svg height="250" width="200" className="mx-auto my-3">
            <line x1="20" y1="230" x2="100" y2="230" stroke="white" strokeWidth="4" />
            <line x1="60" y1="230" x2="60" y2="50" stroke="white" strokeWidth="4" />
            <line x1="60" y1="50" x2="140" y2="50" stroke="white" strokeWidth="4" />
            <line x1="140" y1="50" x2="140" y2="70" stroke="white" strokeWidth="2" />
            {bodyParts.slice(0, mistakes)}
        </svg>
    );
};

const Keyboard = ({ guessedLetters, onGuess }) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    return (
        <div className="d-flex flex-wrap justify-content-center gap-2 mt-4" style={{ maxWidth: '600px' }}>
            {alphabet.map(letter => (
                <button
                    key={letter}
                    className="btn btn-lg btn-light"
                    style={{ width: '50px' }}
                    onClick={() => onGuess(letter)}
                    disabled={guessedLetters.includes(letter)}
                >
                    {letter}
                </button>
            ))}
        </div>
    );
};

const HangmanGame = ({ gameState, username, onSetWord, onGuessLetter }) => {
    const [wordToSet, setWordToSet] = useState('');

    if (!gameState) {
        return <div className="d-flex justify-content-center align-items-center h-100"><h3>Se încarcă jocul...</h3></div>;
    }

    const isHost = username === gameState.hostUsername;
    const isGuesser = username === gameState.guesserUsername;

    const renderGameStatus = () => {
        switch (gameState.status) {
            case 'waiting_for_word':
                if (isHost) {
                    return (
                        <div>
                            <h4>Setează cuvântul secret pentru {gameState.guesserUsername}:</h4>
                            <div className="input-group my-3" style={{ maxWidth: '400px', margin: 'auto' }}>
                                <input
                                    type="password"
                                    className="form-control"
                                    placeholder="Scrie cuvântul..."
                                    value={wordToSet}
                                    onChange={(e) => setWordToSet(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && onSetWord(wordToSet)}
                                />
                                <button className="btn btn-primary" onClick={() => onSetWord(wordToSet)}>Setează</button>
                            </div>
                        </div>
                    );
                }
                return <h4>Așteaptă ca {gameState.hostUsername} să aleagă un cuvânt...</h4>;

            case 'in_progress':
                if (isGuesser) {
                    return <h4>Este rândul tău. Alege o literă!</h4>;
                }
                return <h4 className="text-muted">Așteaptă ca {gameState.guesserUsername} să ghicească...</h4>;

            case 'won':
                return <h2 className="text-success fw-bold">Felicitări, ai câștigat!</h2>;
            
            case 'lost':
                return <h2 className="text-danger fw-bold">Ai pierdut! Cuvântul corect era...</h2>;
        }
    };

    return (
        <div className="container-fluid text-center p-3 bg-dark text-white d-flex flex-column align-items-center h-100">
            <h1>Joc Hangman: {gameState.gameId}</h1>
            
            <HangmanDrawing mistakes={gameState.mistakes} />

            <div className="mb-4">
                {renderGameStatus()}
                <h2 className="display-4 text-warning mt-2" style={{ letterSpacing: '0.5rem' }}>
                    {gameState.maskedWord || "..."}
                </h2>
            </div>
            
            {isGuesser && gameState.status === 'in_progress' && (
                <Keyboard 
                    guessedLetters={gameState.guessedLetters} 
                    onGuess={onGuessLetter} 
                />
            )}
        </div>
    );
};

export default HangmanGame;