const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', ({ room, nickname }) => {
    socket.join(room);
    socket.data.nickname = nickname;
    socket.data.room = room;

    socket.to(room).emit('user-joined', { nickname });

    const users = [...io.sockets.adapter.rooms.get(room) || []]
      .map(id => io.sockets.sockets.get(id)?.data.nickname)
      .filter(Boolean);

    io.to(room).emit('room-users', users);
  });

  socket.on('encrypted-message', (data) => {
    socket.to(data.room).emit('encrypted-message', data);
  });

  // ===== NEW: Typing indicators =====
  socket.on('typing', () => {
    socket.to(socket.data.room).emit('typing', {
      nickname: socket.data.nickname
    });
  });

  socket.on('stop-typing', () => {
    socket.to(socket.data.room).emit('stop-typing', {
      nickname: socket.data.nickname
    });
  });
  // ==================================

  socket.on('disconnect', () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('user-left', {
        nickname: socket.data.nickname
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});