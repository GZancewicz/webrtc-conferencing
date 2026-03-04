require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const app = express();

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : '*';

const corsConfig = {
  origin: allowedOrigins === '*' ? '*' : (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST']
};

const server = http.createServer(app);
const io = new Server(server, { cors: corsConfig });

const PORT = process.env.PORT || 3000;

// Initialize OpenAI (only if API key is provided)
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log('OpenAI API initialized');
} else {
  console.log('OpenAI API key not found - AI features disabled');
}

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Store rooms and participants
// Each room: { participants: Map, password: string|null }
const rooms = new Map();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Store conversation history per room for context
const roomConversations = new Map();

// AI Chat endpoint
app.post('/api/ai/chat', async (req, res) => {
  if (!openai) {
    return res.status(503).json({ error: 'AI features not available' });
  }

  const { message, roomId } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Get or create conversation history for this room
    if (!roomConversations.has(roomId)) {
      roomConversations.set(roomId, []);
    }
    const history = roomConversations.get(roomId);

    // Add user message to history
    history.push({ role: 'user', content: message });

    // Keep only last 20 messages for context
    const recentHistory = history.slice(-20);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant participating in a video conference. Keep responses concise and conversational (2-3 sentences max unless asked for more detail). Be friendly and engaging.'
        },
        ...recentHistory
      ],
      max_tokens: 200
    });

    const aiResponse = completion.choices[0].message.content;

    // Add AI response to history
    history.push({ role: 'assistant', content: aiResponse });

    res.json({ response: aiResponse });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Failed to get AI response' });
  }
});

// AI Text-to-Speech endpoint
app.post('/api/ai/tts', async (req, res) => {
  if (!openai) {
    return res.status(503).json({ error: 'AI features not available' });
  }

  const { text, voice = 'nova' } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      input: text
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });
    res.send(buffer);
  } catch (error) {
    console.error('OpenAI TTS error:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// Check if AI is available
app.get('/api/ai/status', (req, res) => {
  res.json({ available: !!openai });
});

// Server info endpoint (exposes server IP for topology diagram)
const os = require('os');
app.get('/api/server-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        addresses.push(addr.address);
      }
    }
  }
  res.json({ ip: addresses[0] || null });
});

// ICE servers endpoint (serves TURN credentials without exposing them in client JS)
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  if (process.env.TURNS_URL) {
    iceServers.push({
      urls: process.env.TURNS_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', ({ roomId, username, password }) => {
    const room = rooms.get(roomId);

    // Validate password if room exists and is password-protected
    if (room && room.password) {
      if (!password || hashPassword(password) !== room.password) {
        socket.emit('join-error', { message: 'Incorrect room password' });
        return;
      }
    }

    // Create room if it doesn't exist
    if (!room) {
      rooms.set(roomId, {
        participants: new Map(),
        password: password ? hashPassword(password) : null
      });
    }

    socket.join(roomId);

    const currentRoom = rooms.get(roomId);
    currentRoom.participants.set(socket.id, { username, id: socket.id });

    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username
    });

    // Send list of existing users to the new user
    const existingUsers = [];
    currentRoom.participants.forEach((user, id) => {
      if (id !== socket.id) {
        existingUsers.push(user);
      }
    });
    socket.emit('existing-users', existingUsers);

    // Store room info on socket
    socket.roomId = roomId;
    socket.username = username;

    console.log(`${username} joined room ${roomId}`);
  });

  // WebRTC signaling
  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', {
      from: socket.id,
      username: socket.username,
      offer
    });
  });

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Chat message
  socket.on('chat-message', ({ roomId, message }) => {
    io.to(roomId).emit('chat-message', {
      userId: socket.id,
      username: socket.username,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // Media state changes
  socket.on('toggle-audio', ({ roomId, enabled }) => {
    socket.to(roomId).emit('user-toggle-audio', {
      userId: socket.id,
      enabled
    });
  });

  socket.on('toggle-video', ({ roomId, enabled }) => {
    socket.to(roomId).emit('user-toggle-video', {
      userId: socket.id,
      enabled
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.participants.delete(socket.id);
        if (room.participants.size === 0) {
          rooms.delete(socket.roomId);
          // Clean up conversation history when room is empty
          roomConversations.delete(socket.roomId);
        }
      }

      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        username: socket.username
      });

      console.log(`${socket.username} left room ${socket.roomId}`);
    }
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
