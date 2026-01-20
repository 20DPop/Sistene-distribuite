// src/config.js - DOCKER COMPATIBLE
module.exports = {
    port: process.env.PORT || 3001,
    secretKey: "564798ty9GJHB%^&*(KJNLK_your_very_secret_key",
    isProduction: process.env.NODE_ENV === 'production',
    
    cookieOptions: {
        httpOnly: false,  // Temporar FALSE pentru debugging
        secure: false,    // FALSE pentru HTTP (nu HTTPS)
        sameSite: 'lax',  // Important pentru cross-origin
        path: "/",
        maxAge: 86400000, // 24 hours
        domain: undefined // NU setăm domain pentru localhost
    }
};