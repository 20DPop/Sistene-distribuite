import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    console.log('[Login] Attempting login for:', username);

    fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: 'include', // IMPORTANT!
      body: JSON.stringify({ username, password }),
    })
    .then(response => {
      console.log('[Login] Response status:', response.status);
      console.log('[Login] Response headers:', response.headers);
      
      // Check cookies in response
      const setCookieHeader = response.headers.get('set-cookie');
      console.log('[Login] Set-Cookie header:', setCookieHeader);
      
      if (!response.ok) {
        return response.json().then(errorData => {
          throw errorData;
        });
      }
      return response.json();
    })
    .then(data => {
      console.log('[Login] Response data:', data);
      
      if (data.success) {
        // Check if cookie was set
        console.log('[Login] Current cookies:', document.cookie);
        
        // Delay to allow cookie to be set
        setTimeout(() => {
          console.log('[Login] Cookies after delay:', document.cookie);
          onLogin(username);
        }, 100);
      }
    })
    .catch((err) => {
      console.error('[Login] Error:', err);
      const errorMessage = Object.values(err.errors || {}).join(' ') || err.message || "A apărut o eroare neașteptată.";
      setError(errorMessage);
    });
  };

  return (
    <div className="vh-100 d-flex justify-content-center align-items-center bg-light">
      <div className="card shadow p-4" style={{ width: '100%', maxWidth: '400px' }}>
        <div className="card-body">
          <h2 className="card-title text-center mb-4">Autentificare</h2>
          
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label htmlFor="username-login" className="form-label">
                Utilizator
              </label>
              <input
                type="text"
                className="form-control"
                id="username-login"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="mb-3">
              <label htmlFor="password-login" className="form-label">
                Parolă
              </label>
              <input
                type="password"
                className="form-control"
                id="password-login"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="d-grid">
              <button type="submit" className="btn btn-primary">
                Autentificare
              </button>
            </div>
          </form>

          <div className="text-center mt-3">
            <Link to="/register">Nu ai cont? Înregistrează-te</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;