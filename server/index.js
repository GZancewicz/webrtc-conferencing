const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Store rooms and participants
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a room
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);
    room.set(socket.id, { username, id: socket.id });

    // Notify others in the room
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username
    });

    // Send list of existing users to the new user
    const existingUsers = [];
    room.forEach((user, id) => {
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
        room.delete(socket.id);
        if (room.size === 0) {
          rooms.delete(socket.roomId);
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
