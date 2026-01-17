const getMaskedWord = (game) => {
    if (!game.secretWord) return "";
    return game.secretWord
        .split('')
        .map(letter => {
            if (game.guessedLetters.includes(letter) || game.status === 'lost' || game.status === 'won') {
                return letter;
            }
            return '_';
        })
        .join(' ');
};

const getPublicState = (game) => {
    return {
        gameId: game.gameId,
        hostUsername: game.hostUsername,
        guesserUsername: game.guesserUsername,
        guessedLetters: game.guessedLetters,
        mistakes: game.mistakes,
        maxGuesses: game.maxGuesses,
        maskedWord: getMaskedWord(game),
        status: game.status,
        // Trimitem cuvântul complet doar dacă s-a terminat jocul
        secretWord: (game.status === 'won' || game.status === 'lost') ? game.secretWord : null
    };
};

const handleGuess = (game, letter) => {
    if (game.status !== 'in_progress') throw new Error('Jocul nu este în desfășurare.');

    const upperLetter = letter.toUpperCase();
    if (game.guessedLetters.includes(upperLetter)) throw new Error('Litera a fost deja încercată.');

    game.guessedLetters.push(upperLetter);

    if (!game.secretWord.includes(upperLetter)) {
        game.mistakes += 1;
    }

    const uniqueLettersInWord = [...new Set(game.secretWord.split(''))];
    const isWordGuessed = uniqueLettersInWord.every(l => game.guessedLetters.includes(l));

    if (isWordGuessed) {
        game.status = 'won';
    } else if (game.mistakes >= game.maxGuesses) {
        game.status = 'lost';
    }

    return game;
};

module.exports = { getPublicState, handleGuess };