import "./App.css";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import WelcomePage from "./components/WelcomePage";
import Login from "./components/Login";
import Register from "./components/Register";
import Header from "./components/Header";
import GlobalChat from "./components/chat/GlobalChat";
import PrivateChat from './components/chat/PrivateChat';
import RoomChat from "./components/chat/RoomChat";
import PokerLobby from "./components/poker/PokerLobby";
import PokerTable from "./components/poker/PokerTable";
import HangmanLobby from "./components/hangman/HangmanLobby";
import HangmanGame from "./components/hangman/HangmanGame";

// --- Wrappere ---
const PrivateChatWrapper = ({ messages, users, username, sendMessage, connectionStatus, onChatPartnerChange }) => {
  const { chatPartner } = useParams();
  
  useEffect(() => {
    if (chatPartner) {
      localStorage.setItem('lastPrivateChatPartner', chatPartner);
      if (onChatPartnerChange) {
        onChatPartnerChange(chatPartner);
      }
    }
  }, [chatPartner, onChatPartnerChange]);

  const filteredMessages = messages.filter(msg => 
    msg.type === 'private_message' && 
    ((msg.sender === username && msg.to === chatPartner) || (msg.sender === chatPartner && msg.to === username))
  );
  
  return (
    <PrivateChat 
      messages={filteredMessages}
      users={users}
      username={username}
      sendMessage={sendMessage}
      connectionStatus={connectionStatus}
    />
  );
};

const RoomChatWrapper = ({ 
  messages, 
  username, 
  connectionStatus, 
  sendMessage, 
  availableRooms, 
  joinedRooms, 
  usersInRooms, 
  onJoinRoom, 
  onCreateRoom, 
  onLeaveRoom,
  onRoomChange 
}) => {
  const { roomName } = useParams();
  
  useEffect(() => {
    if (roomName) {
      localStorage.setItem('lastRoomChat', roomName);
      if (onRoomChange) {
        onRoomChange(roomName);
      }
    }
  }, [roomName, onRoomChange]);

  return (
    <RoomChat 
      messages={messages}
      username={username}
      connectionStatus={connectionStatus}
      sendMessage={sendMessage}
      availableRooms={availableRooms}
      joinedRooms={joinedRooms}
      usersInRooms={usersInRooms}
      onJoinRoom={onJoinRoom}
      onCreateRoom={onCreateRoom}
      onLeaveRoom={onLeaveRoom}
    />
  );
};

// --- Utilitare ---
const getTokenFromCookie = () => {
  const match = document.cookie.match(/token=([^;]+)/);
  const token = match ? match[1] : null;
  console.log('[Cookie] Token check:', token ? 'Present ✅' : 'Missing ❌');
  return token;
};

const getUsernameFromToken = (token) => {
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.username;
    } catch (e) {
        console.error('[Token] Failed to decode:', e);
        return null;
    }
}

// --- App Component ---
function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(!!getTokenFromCookie());
  const [username, setUsername] = useState(() => getUsernameFromToken(getTokenFromCookie()));
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  
  const [availableRooms, setAvailableRooms] = useState([]); 
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [usersInRooms, setUsersInRooms] = useState(new Map()); 
  
  const [pokerGames, setPokerGames] = useState([]);
  const [currentPokerGame, setCurrentPokerGame] = useState(null);
  const [myPokerHand, setMyPokerHand] = useState([]);

  const [hangmanGames, setHangmanGames] = useState([])
  const [currentHangmanGame, setCurrentHangmanGame] = useState(null)
  
  const [lastPrivateChatPartner, setLastPrivateChatPartner] = useState(() => 
    localStorage.getItem('lastPrivateChatPartner')
  );
  const [lastRoomChat, setLastRoomChat] = useState(() => 
    localStorage.getItem('lastRoomChat')
  );

  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const navigate = useNavigate();

  // --- API Communication ---
  const sendActionViaAPI = useCallback(async (url, body, method = 'POST') => {
      try {
          const response = await fetch(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
              const errorMsg = data.error || data.errors?.[0] || 'Eroare necunoscută la server.';
              console.error(`Eroare la apelul ${url}:`, errorMsg);
              throw new Error(errorMsg);
          }
          return data;
      } catch (error) {
          console.error(`Eroare de comunicare la ${url}:`, error);
          alert(`Eroare: ${error.message}`);
          return { success: false, error: error.message };
      }
  }, []);

  // --- SSE CONNECTION (FIXED WITH TOKEN POLLING) ---
  const connectSSE = useCallback(() => {
    console.log('[SSE] Attempting to connect...');
    
    // Cleanup old connection
    if (eventSourceRef.current) {
      console.log('[SSE] Closing existing connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Poll pentru token cu retry logic
    const attemptConnection = (retries = 5) => {
      const token = getTokenFromCookie();
      
      if (!token) {
        if (retries > 0) {
          console.log(`[SSE] No token found, retrying... (${retries} attempts left)`);
          setTimeout(() => attemptConnection(retries - 1), 200);
          return;
        } else {
          console.log('[SSE] No token found after all retries, skipping connection');
          setConnectionStatus("disconnected");
          return;
        }
      }

      // Token găsit, conectează SSE
      console.log('[SSE] Token found, establishing connection');
      setConnectionStatus("connecting");

      const sseUrl = `/api/events`;
      console.log('[SSE] Creating EventSource:', sseUrl);
      
      try {
        const es = new EventSource(sseUrl, { withCredentials: true });
        eventSourceRef.current = es;

        // Connection established
        es.onopen = () => {
          console.log('[SSE] ✅ Connection opened');
          setConnectionStatus("connected");
          
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };

        // Error handling
        es.onerror = (error) => {
          console.error('[SSE] ❌ Connection error:', error);
          setConnectionStatus("disconnected");
          
          if (es.readyState === EventSource.CLOSED) {
            console.log('[SSE] Connection closed by server');
          }
          
          es.close();
          eventSourceRef.current = null;
          
          // Retry după 3 secunde dacă avem token
          if (getTokenFromCookie()) {
            console.log('[SSE] Scheduling reconnect in 3s...');
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log('[SSE] Retrying connection...');
              connectSSE();
            }, 3000);
          }
        };

        // --- Event Listeners ---
        
        // Global Chat
        es.addEventListener('globalChatMessage', (event) => {
          console.log('[SSE] Global chat message received');
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, {
            type: 'broadcast', 
            content: data.message, 
            username: data.sender, 
            timestamp: data.timestamp
          }]);
        });
        
        // Room Chat
        es.addEventListener('roomChatMessage', (event) => {
          console.log('[SSE] Room chat message received');
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, {
            type: 'room_message', 
            room: data.room, 
            sender: data.sender, 
            text: data.message, 
            timestamp: data.timestamp
          }]);
        });

        // Private Chat
        es.addEventListener('privateChatMessage', (event) => {
          console.log('[SSE] Private chat message received');
          const data = JSON.parse(event.data);
          setMessages(prev => [...prev, {
            type: 'private_message', 
            sender: data.sender, 
            to: data.to, 
            text: data.message, 
            timestamp: data.timestamp
          }]);
        });
        
        // Users Online Update
        es.addEventListener('usersOnlineUpdate', (event) => {
          console.log('[SSE] Users online update received');
          const usersList = JSON.parse(event.data);
          setUsers(usersList);
        });

        // ✅ FIX PROBLEMA 1 - Ascultăm actualizări pentru camere
        es.addEventListener('roomsUpdate', (event) => {
          console.log('[SSE] Rooms update received');
          const data = JSON.parse(event.data);
          if (data.availableRooms) {
            setAvailableRooms(data.availableRooms);
            console.log('[SSE] Available rooms updated:', data.availableRooms);
          }
        });

        // Room Member Update
        es.addEventListener('roomMemberUpdate', (event) => {
          console.log('[SSE] Room member update received');
          const data = JSON.parse(event.data);
          if (data.roomName && data.memberCount !== undefined) {
            setUsersInRooms(prev => {
              const newMap = new Map(prev);
              newMap.set(data.roomName, data.memberCount);
              return newMap;
            });
          }
        });

        // Game State Update
        es.addEventListener('gameStateUpdate', (event) => {
          console.log('[SSE] Game state update received');
          const gameState = JSON.parse(event.data);
          
          // Poker update
          if (gameState.pot !== undefined && Array.isArray(gameState.players)) {
            setCurrentPokerGame(gameState);
            const myPlayer = gameState.players.find(p => p.username === username);
            if (myPlayer) setMyPokerHand(myPlayer.hand || []);

            if (gameState.round === 'finished' && !gameState.inProgress) {
              setCurrentPokerGame(null);
              setMyPokerHand([]);
              navigate('/home/poker');
            }
          } 
          // Hangman update
          else if (gameState.status && gameState.maskedWord !== undefined) {
            setCurrentHangmanGame(gameState);
          }
        });

      } catch (err) {
        console.error('[SSE] Failed to create EventSource:', err);
        setConnectionStatus("disconnected");
      }
    };
    
    // Start connection attempt
    attemptConnection();
  }, [username, navigate]);

  const disconnectSSE = useCallback(() => {
    console.log('[SSE] Disconnecting...');
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setConnectionStatus("disconnected");
  }, []);

  // --- Effects ---
  
  useEffect(() => {
    if (isLoggedIn && username) {
      console.log('[App] User logged in, connecting SSE');
      connectSSE();
      fetchPokerGames();
      fetchHangmanGames();
      fetchRooms(); // ✅ IMPORTANT: Încarcă camerele la login
    } else {
      console.log('[App] User not logged in, disconnecting SSE');
      disconnectSSE();
      localStorage.removeItem('lastPrivateChatPartner');
      localStorage.removeItem('lastRoomChat');
      setLastPrivateChatPartner(null);
      setLastRoomChat(null);
    }
    
    return () => {
      disconnectSSE();
    };
  }, [isLoggedIn, username, connectSSE, disconnectSSE]);

  // --- Message Sending ---
  const sendMessage = (message) => {
    if (typeof message === 'string') {
        sendActionViaAPI('/api/chat/global', { message });
    } 
    else if (message.type === 'private_message') {
        sendActionViaAPI('/api/chat/private', { to: message.to, message: message.text });
    } 
    else if (message.type === 'sendRoomMessage') {
        sendActionViaAPI(`/api/chat/room/${message.room}`, { message: message.text });
    }
  };

  // --- Login/Logout ---
  
const handleLogin = (loggedInUsername) => {
    console.log('[App] Login successful:', loggedInUsername);
    setUsername(loggedInUsername);
    setIsLoggedIn(true);
    
    // Așteaptă puțin ca browser-ul să proceseze cookie-ul
    setTimeout(() => {
        connectSSE();
        fetchPokerGames();
        fetchHangmanGames();
        fetchRooms(); // ✅ IMPORTANT
    }, 300);
    
    const storedPrivateChat = localStorage.getItem('lastPrivateChatPartner');
    const storedRoomChat = localStorage.getItem('lastRoomChat');
    
    if (storedPrivateChat) {
        navigate(`/home/private/${storedPrivateChat}`);
    } else if (storedRoomChat) {
        navigate(`/home/rooms/${storedRoomChat}`);
    } else {
        navigate('/home');
    }
};



  const handleLogout = async () => {
    console.log('[App] Logging out...');
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setIsLoggedIn(false);
      setUsername(null);
      setCurrentPokerGame(null);
      setMyPokerHand([]);
      setPokerGames([]);
      setMessages([]);
      setUsers([]);
      setAvailableRooms([]);
      setJoinedRooms([]);
      disconnectSSE();
      
      localStorage.removeItem('lastPrivateChatPartner');
      localStorage.removeItem('lastRoomChat');
      setLastPrivateChatPartner(null);
      setLastRoomChat(null);
      
      document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      navigate('/login');
    }
  };

  // --- Chat Rooms ---
 const handleCreateRoom = async (roomName) => {
    const trimmedRoom = roomName.trim().toLowerCase();
    
    if (!trimmedRoom) {
        alert('Numele camerei nu poate fi gol');
        return;
    }
    
    console.log('[handleCreateRoom] Attempting to create room:', trimmedRoom);
    
    try {
        const response = await fetch('/api/chat/rooms/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ roomName: trimmedRoom })
        });
        
        console.log('[handleCreateRoom] Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('[handleCreateRoom] Error response:', errorData);
            alert(`Eroare ${response.status}: ${errorData.error || 'Nu s-a putut crea camera'}`);
            return;
        }
        
        const data = await response.json();
        console.log('[handleCreateRoom] Success response:', data);
        
        if (data.success) {
            // Adaugă local pentru feedback imediat
            if (!availableRooms.includes(trimmedRoom)) {
                setAvailableRooms(prev => [...prev, trimmedRoom]);
            }
            if (!joinedRooms.includes(trimmedRoom)) {
                setJoinedRooms(prev => [...prev, trimmedRoom]);
            }
            
            localStorage.setItem('lastRoomChat', trimmedRoom);
            setLastRoomChat(trimmedRoom);
            
            console.log(`[Room Created] ${trimmedRoom}`);
            navigate(`/home/rooms/${trimmedRoom}`);
        } else {
            alert(data.error || 'Nu s-a putut crea camera');
        }
    } catch (error) {
        console.error('[handleCreateRoom] Catch error:', error);
        alert(`Eroare la crearea camerei: ${error.message}`);
    }
};


const handleJoinRoom = async (roomName) => {
    const trimmedRoom = roomName.trim().toLowerCase();
    
    try {
        const response = await fetch('/api/chat/rooms/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ roomName: trimmedRoom })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Adaugă în joined rooms
            if (!joinedRooms.includes(trimmedRoom)) {
                setJoinedRooms(prev => [...prev, trimmedRoom]);
            }
            
            localStorage.setItem('lastRoomChat', trimmedRoom);
            setLastRoomChat(trimmedRoom);
            
            console.log(`[Room Joined] ${trimmedRoom}`);
            navigate(`/home/rooms/${trimmedRoom}`);
        } else {
            alert(data.error || 'Nu te poți alătura camerei');
        }
    } catch (error) {
        console.error('Error joining room:', error);
        alert('Eroare la intrarea în cameră. Verifică conexiunea.');
    }
};

  
  const handleLeaveRoom = async (roomName) => {
    try {
        const response = await fetch('/api/chat/rooms/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ roomName })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Șterge din joined rooms
            setJoinedRooms(prev => prev.filter(r => r !== roomName));
            setLastRoomChat(null);
            localStorage.removeItem('lastRoomChat');
            
            console.log(`[Room Left] ${roomName}`);
            navigate('/home/rooms');
        } else {
            console.error('Failed to leave room:', data.error);
        }
    } catch (error) {
        console.error('Error leaving room:', error);
        // Șterge local oricum pentru a nu bloca UI-ul
        setJoinedRooms(prev => prev.filter(r => r !== roomName));
        navigate('/home/rooms');
    }
};

const fetchRooms = async () => {
    try {
        const response = await fetch('/api/chat/rooms', { 
            credentials: 'include' 
        });
        const data = await response.json();
        
        if (data.success) {
            // data.rooms poate fi array de obiecte { roomName, memberCount }
            const roomNames = data.rooms.map(r => r.roomName || r);
            setAvailableRooms(roomNames);
            
            // Opțional: salvează și numărul de membri
            const counts = new Map();
            data.rooms.forEach(r => {
                if (r.memberCount !== undefined) {
                    counts.set(r.roomName || r, r.memberCount);
                }
            });
            setUsersInRooms(counts);
            
            console.log('[Rooms Fetched]', roomNames);
        }
    } catch (error) {
        console.error('Error fetching rooms:', error);
    }
};

  // --- Poker Functions ---
  const fetchPokerGames = async () => {
    try {
      const response = await fetch('/api/poker/games', { credentials: 'include' });
      const data = await response.json();
      if (data.success) setPokerGames(data.games);
    } catch (error) {
      console.error('Error fetching poker games:', error);
    }
  };

  const createPokerGame = async (gameId, password, smallBlind, bigBlind, maxPlayers, stack) => {
    const data = await sendActionViaAPI('/api/poker/create', { 
        gameId, password, 
        options: { smallBlind, bigBlind, maxPlayers, minPlayers: 2 }
    });
    if (data.success) {
        setCurrentPokerGame(data.gameState);
        navigate(`/home/poker/table/${gameId}`);
    } 
  };

  const joinPokerGame = async (gameId, password, stack) => {
    const data = await sendActionViaAPI('/api/poker/join', { gameId, password });
    if (data.success) {
        setCurrentPokerGame(data.gameState);
        navigate(`/home/poker/table/${gameId}`);
    }
  };

  const sendPokerAction = (action, amount = 0) => {
    if (currentPokerGame) {
      sendActionViaAPI('/api/poker/action', { 
        gameId: currentPokerGame.gameId, 
        action, 
        amount 
      });
    }
  };

  const startPokerGame = () => {
    if (currentPokerGame) {
      sendActionViaAPI('/api/poker/action', { 
        gameId: currentPokerGame.gameId, 
        action: 'start_game' 
      });
    }
  };

  const startNewHand = () => {
    if (currentPokerGame) {
        sendActionViaAPI('/api/poker/action', { 
          gameId: currentPokerGame.gameId, 
          action: 'start_new_hand' 
        });
    }
  };

  const leavePokerGame = async () => {
    if (currentPokerGame) {
        const gameId = currentPokerGame.gameId;
        const data = await sendActionViaAPI('/api/poker/leave', { gameId }, 'DELETE');
        if (data.success) {
            setCurrentPokerGame(null);
            setMyPokerHand([]);
            navigate('/home/poker');
        }
    } else {
      navigate('/home/poker');
    }
  };

  // --- Hangman Functions ---
  const fetchHangmanGames = async () => {
    try {
        const response = await fetch('/api/hangman/games', { credentials: 'include' });
        const data = await response.json();
        if (data.success) setHangmanGames(data.games);
    } catch (error) {
        console.error('Error fetching hangman games:', error);
    }
  };

  const createHangmanGame = async(gameId)=>{
    const data = await sendActionViaAPI('/api/hangman/create', { gameId });
    if(data.success){
      setCurrentHangmanGame(data.gameState);
      navigate(`/home/hangman/game/${gameId}`);
    }
  }

  const joinHangmanGame = async(gameId)=>{
    const data = await sendActionViaAPI('/api/hangman/join', { gameId });
    if(data.success){
      navigate(`/home/hangman/game/${gameId}`);
    }
  }

  const setHangmanWord = async (word)=>{
    if(currentHangmanGame){
      await sendActionViaAPI('/api/hangman/set-word', {
        gameId:currentHangmanGame.gameId,
        word
      });
    }
  }

  const guessHangmanLetter =(letter)=>{
    if(currentHangmanGame){
      sendActionViaAPI('/api/hangman/action', {
        gameId:currentHangmanGame.gameId,
        letter
      });
    }
  }

  // --- Navigation ---
  const handleChatPartnerChange = (chatPartner) => {
    setLastPrivateChatPartner(chatPartner);
  };

  const handleRoomChange = (roomName) => {
    setLastRoomChat(roomName);
  };

  const handlePrivateNavigation = () => {
    if (lastPrivateChatPartner) {
      navigate(`/home/private/${lastPrivateChatPartner}`);
    } else {
      navigate('/home/private');
    }
  };

  const handleRoomNavigation = () => {
    if (lastRoomChat) {
      navigate(`/home/rooms/${lastRoomChat}`);
    } else {
      navigate('/home/rooms');
    }
  };

  const handlePokerNavigation = () => {
    if (currentPokerGame && currentPokerGame.gameId) {
      navigate(`/home/poker/table/${currentPokerGame.gameId}`);
    } else {
      navigate('/home/poker');
    }
  };

  const handleHangmanNavigation = () => {
    navigate('/home/hangman');
  };


  return (
    <Routes>
      <Route path="/" element={!isLoggedIn ? <WelcomePage /> : <Navigate to="/home" />} />
      <Route path="/login" element={!isLoggedIn ? <Login onLogin={handleLogin} /> : <Navigate to="/home" />} />
      <Route path="/register" element={!isLoggedIn ? <Register /> : <Navigate to="/home" />} />
      
      <Route 
        path="/home" 
        element={
          isLoggedIn ? 
          <Header 
            username={username} 
            onLogout={handleLogout} 
            connectionStatus={connectionStatus} 
            users={users} 
            onPrivateNavigation={handlePrivateNavigation} 
            onRoomNavigation={handleRoomNavigation} 
            onPokerNavigation={handlePokerNavigation} 
            onHangmanNavigation={handleHangmanNavigation} 
          /> : 
          <Navigate to="/login" />
        }
      >
        <Route index element={<Navigate to="global" replace />} />
        
        <Route path="global" element={<GlobalChat messages={messages.filter(msg => msg.type === 'broadcast')} sendMessage={sendMessage} username={username} connectionStatus={connectionStatus} />} />
        
        <Route path="rooms" element={<RoomChat messages={messages} username={username} connectionStatus={connectionStatus} sendMessage={sendMessage} availableRooms={availableRooms} joinedRooms={joinedRooms} usersInRooms={usersInRooms} onJoinRoom={handleJoinRoom} onCreateRoom={handleCreateRoom} onLeaveRoom={handleLeaveRoom} />} />
        <Route path="rooms/:roomName" element={<RoomChatWrapper messages={messages} username={username} connectionStatus={connectionStatus} sendMessage={sendMessage} availableRooms={availableRooms} joinedRooms={joinedRooms} usersInRooms={usersInRooms} onJoinRoom={handleJoinRoom} onCreateRoom={handleCreateRoom} onLeaveRoom={handleLeaveRoom} onRoomChange={handleRoomChange} />} />
        
        <Route path="private" element={<PrivateChat messages={messages.filter(msg => msg.type === 'private_message' && (msg.sender === username || msg.to === username))} users={users} username={username} sendMessage={sendMessage} connectionStatus={connectionStatus} />} />
        <Route path="private/:chatPartner" element={<PrivateChatWrapper messages={messages} users={users} username={username} sendMessage={sendMessage} connectionStatus={connectionStatus} onChatPartnerChange={handleChatPartnerChange} />} />
        
        <Route path="poker" element={<PokerLobby availableGames={pokerGames} onCreateGame={createPokerGame} onJoinGame={joinPokerGame} onRefresh={fetchPokerGames} />} />
        <Route
            path="poker/table/:gameId"
            element={
                <PokerTable 
                    pokerState={currentPokerGame}
                    myHand={myPokerHand}
                    username={username}
                    onPokerAction={sendPokerAction}
                    onStartGame={startPokerGame}
                    onNewHand={startNewHand}
                    onLeaveGame={leavePokerGame}
                />
            }
        />
        
        <Route
          path="hangman"
          element={
            <HangmanLobby
              availableGames={hangmanGames}
              onCreateGame={createHangmanGame}
              onJoinGame={joinHangmanGame}
              onRefresh={fetchHangmanGames}
            />
          }
        />
        <Route
          path="hangman/game/:gameId"
          element={
            <HangmanGame
              gameState={currentHangmanGame}
              username={username}
              onSetWord={setHangmanWord}
              onGuessLetter={guessHangmanLetter}
            />
          }
        />
      </Route>      
      
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;
