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

    // Notify others
    socket.to(room).emit('user-joined', { nickname });

    // Send updated users list to everyone in the room
    const users = getUsersInRoom(room);
    io.to(room).emit('room-users', users);
  });

  socket.on('encrypted-message', (data) => {
    socket.to(data.room).emit('encrypted-message', data);
  });

  socket.on('typing', () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('typing', {
        nickname: socket.data.nickname
      });
    }
  });

  socket.on('stop-typing', () => {
    if (socket.data.room) {
      socket.to(socket.data.room).emit('stop-typing', {
        nickname: socket.data.nickname
      });
    }
  });

  socket.on('disconnect', () => {
    if (socket.data.room) {
      const room = socket.data.room;
      const nickname = socket.data.nickname;

      // Notify others that the user left
      socket.to(room).emit('user-left', { nickname });

      // Send the updated users list
      const users = getUsersInRoom(room);
      io.to(room).emit('room-users', users);
    }
  });
});

// Helper function to get current users in a room
function getUsersInRoom(room) {
  const clients = io.sockets.adapter.rooms.get(room) || new Set();
  const users = [];

  for (const clientId of clients) {
    const clientSocket = io.sockets.sockets.get(clientId);
    if (clientSocket && clientSocket.data.nickname) {
      users.push(clientSocket.data.nickname);
    }
  }

  return users;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});