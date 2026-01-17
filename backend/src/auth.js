// src/auth.js
const jwt = require("jsonwebtoken");
const config = require("./config");
const User = require("./models/user.model");

const isValidToken = (token) => {
    if (!token) return false;
    try {
        jwt.verify(token, config.secretKey);
        return true;
    } catch (err) {
        return false;
    }
};

const getUsernameFromToken = (token) => {
    if (!token) return null;
    try {
        return jwt.verify(token, config.secretKey).username;
    } catch (err) {
        return null;
    }
};

const createToken = (username) => {
    return jwt.sign({ username }, config.secretKey, { expiresIn: "24h" });
};

const registerUser = async (username, password) => {
    if (!username || username.length < 3) {
        return { errors: { username: "Username-ul trebuie să aibă cel puțin 3 caractere." } };
    }
    if (!password || password.length < 6) {
        return { errors: { password: "Parola trebuie să aibă cel puțin 6 caractere." } };
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return { errors: { username: "Acest username este deja folosit." } };
        }
        const newUser = new User({ username, password });
        await newUser.save();
        return { errors: {} };
    } catch (e) {
        console.error("Error in registerUser:", e);
        return { errors: { server: "Eroare la înregistrare." } };
    }
};

const authenticateUser = async (username, password) => {
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return { errors: { auth: "Username sau parolă invalidă." } };
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return { errors: { auth: "Username sau parolă invalidă." } };
        }
        return { errors: {} };
    } catch (e) {
        console.error("Error in authenticateUser:", e);
        return { errors: { server: "Eroare la autentificare." } };
    }
};

module.exports = {
    isValidToken,
    getUsernameFromToken,
    createToken,
    registerUser,
    authenticateUser
};