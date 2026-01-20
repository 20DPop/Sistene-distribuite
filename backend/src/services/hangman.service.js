// src/services/hangman.service.js

/**
 * Generează cuvântul mascat pentru a fi afișat jucătorului.
 * Dezvăluie cuvântul complet doar dacă jocul s-a terminat (câștigat/pierdut).
 * @param {object} game Starea jocului
 * @returns {string} Cuvântul mascat sau dezvăluit.
 */
const getMaskedWord = (game) => {
    if (!game.secretWord) return "";
    
    // Dacă jocul s-a terminat, arătăm cuvântul
    if (game.status === 'lost' || game.status === 'won') {
        return game.secretWord.split('').join(' ');
    }

    // Dacă jocul e în curs, mascăm literele negăsite
    return game.secretWord
        .split('')
        .map(letter => {
            if (game.guessedLetters.includes(letter)) {
                return letter;
            }
            return '_';
        })
        .join(' ');
};

/**
 * Returnează doar starea publică a jocului.
 * @param {object} game Obiectul Mongoose complet
 * @returns {object} Starea publică
 */
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
        // Trimitem cuvântul complet doar dacă s-a terminat jocul (pentru a-l afișa la 'lost')
        secretWord: (game.status === 'won' || game.status === 'lost') ? game.secretWord : undefined
    };
};

/**
 * Gestionează setarea cuvântului secret de către gazdă.
 * @param {object} game Starea jocului
 * @param {string} word Cuvântul secret ales
 * @returns {object} Starea jocului actualizată
 */
const handleSetWord = (game, word) => {
    if (game.status !== 'waiting_for_word') {
        throw new Error('Nu este momentul să setezi cuvântul secret.');
    }
    
    const cleanWord = word.trim().toUpperCase();
    
    if (cleanWord.length < 3) {
        throw new Error('Cuvântul secret trebuie să aibă cel puțin 3 litere.');
    }
    
    // Verificare că nu sunt caractere invalide (e.g., cifre sau simboluri)
    if (!/^[A-Z]+$/.test(cleanWord)) {
         throw new Error('Cuvântul secret poate conține doar litere.');
    }

    game.secretWord = cleanWord;
    game.status = 'in_progress';
    game.mistakes = 0;
    game.guessedLetters = [];
    
    return game;
}

/**
 * Gestionează o încercare de literă a ghicitorului.
 * @param {object} game Starea jocului
 * @param {string} letter Litera ghicită
 * @returns {object} Starea jocului actualizată
 */
const handleGuess = (game, letter) => {
    if (game.status !== 'in_progress') {
        throw new Error('Jocul nu este în desfășurare.');
    }
    
    if (!game.secretWord) {
        throw new Error('Cuvântul secret nu a fost setat.');
    }

    const upperLetter = letter.trim().toUpperCase();
    
    if (upperLetter.length !== 1 || !/^[A-Z]$/.test(upperLetter)) {
        throw new Error('Trebuie să ghicești o singură literă validă.');
    }

    if (game.guessedLetters.includes(upperLetter)) {
        throw new Error(`Litera "${upperLetter}" a fost deja încercată.`);
    }

    // Adăugăm litera încercată
    game.guessedLetters.push(upperLetter);

    if (!game.secretWord.includes(upperLetter)) {
        game.mistakes += 1;
    }

    // Verificare Condiții de Final
    const uniqueLettersInWord = [...new Set(game.secretWord.split(''))];
    const isWordGuessed = uniqueLettersInWord.every(l => game.guessedLetters.includes(l));

    if (isWordGuessed) {
        game.status = 'won';
    } else if (game.mistakes >= game.maxGuesses) {
        game.status = 'lost';
    }

    return game;
};

module.exports = { getPublicState, handleGuess, handleSetWord };