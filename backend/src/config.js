// src/config.js
module.exports = {
    port: process.env.PORT || 3001,
    secretKey: "564798ty9GJHB%^&*(KJNLK_your_very_secret_key",
    cookieOptions: {
        httpOnly: true, // Mai sigur, cookie-ul nu poate fi accesat de JavaScript-ul clientului
        secure: false,  // În producție, setează pe 'true' dacă folosești HTTPS
        sameSite: "lax",
        path: "/"
    },
    // Nu mai avem nevoie de căi către fișierele statice aici
};