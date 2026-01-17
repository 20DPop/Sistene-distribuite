
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom'; 

const HangmanLobby = ({ availableGames, onCreateGame, onJoinGame, onRefresh }) => {
    const [newGameId, setNewGameId] = useState('');
    useEffect(() => {
        if (onRefresh) {
            onRefresh();
        }
    }, [onRefresh]); 

    const handleCreateClick = () => {
        if (!newGameId.trim()) {
            alert("Te rog introdu un nume pentru joc.");
            return;
        }
        onCreateGame(newGameId.trim());
        setNewGameId(''); 
    };

    return (
        <div className="container-fluid py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="display-6">Lobby Hangman</h1>
                <button className="btn btn-outline-primary" onClick={onRefresh}>
                    <i className="bi bi-arrow-clockwise me-2"></i>
                    Reîmprospătează
                </button>
            </div>

            <div className="card mb-4 shadow-sm">
                <div className="card-body">
                    <h5 className="card-title">Creează un Joc Nou</h5>
                    <div className="input-group">
                        <input
                            type="text"
                            className="form-control"
                            placeholder="Numele jocului..."
                            value={newGameId}
                            onChange={(e) => setNewGameId(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleCreateClick()}
                        />
                        <button className="btn btn-success" onClick={handleCreateClick}>
                            <i className="bi bi-plus-circle me-2"></i>
                            Creează Joc
                        </button>
                    </div>
                </div>
            </div>

            <hr />

            <h2 className="fs-4">Jocuri Disponibile</h2>
            {availableGames && availableGames.length > 0 ? (
                <div className="list-group">
                    {availableGames.map(game => (
                        <div key={game.gameId} className="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <h5 className="mb-1">{game.gameId}</h5>
                                <small className="text-muted">
                                    Gazdă: <strong>{game.hostUsername}</strong>
                                </small>
                                <br />
                                <small className="text-muted">
                                    Status: {game.status === 'waiting_for_guesser' ? "Așteaptă adversar" : "În progres"}
                                </small>
                            </div>
                            
                            {game.status === 'waiting_for_guesser' && (
                                <button 
                                    className="btn btn-primary" 
                                    onClick={() => onJoinGame(game.gameId)}
                                >
                                    Alătură-te ca Ghicitor
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center text-muted mt-5">
                    <p className="fs-5">Nu există niciun joc de Hangman activ.</p>
                    <p>Fii primul care creează unul!</p>
                </div>
            )}
        </div>
    );
};

export default HangmanLobby;