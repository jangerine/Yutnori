const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 방 상태 저장 객체
const rooms = {};

const YUT_TYPES = ['도', '개', '걸', '윷', '모'];
const YUT_WEIGHTS = [1, 3, 3, 1, 1];

function getRandomYut() {
  const list = [];
  YUT_TYPES.forEach((type, idx) => {
    for (let i = 0; i < YUT_WEIGHTS[idx]; i++) list.push(type);
  });
  return list[Math.floor(Math.random() * list.length)];
}

io.on('connection', (socket) => {
  let currentRoom = null;

  // 방 참가/생성
  socket.on('joinRoom', ({ roomId, nickname }) => {
    if (!roomId) return;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        turnIndex: 0,
        gameStarted: false,
      };
    }

    const room = rooms[roomId];

    if (room.players.length >= 4) {
      socket.emit('errorMsg', '방이 가득 찼습니다. (최대 4인)');
      return;
    }

    if (room.gameStarted) {
      socket.emit('errorMsg', '이미 게임이 시작되었습니다.');
      return;
    }

    const playerNumber = room.players.length + 1;
    const player = {
      id: socket.id,
      nickname: nickname || `플레이어 ${playerNumber}`,
      number: playerNumber
    };

    room.players.push(player);
    socket.join(roomId);
    currentRoom = roomId;

    io.to(roomId).emit('roomState', {
      players: room.players,
      currentTurn: room.players[room.turnIndex],
      gameStarted: room.gameStarted
    });
  });

  // 게임 시작 (2인 이상시 방장이 시작)
  socket.on('startGame', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    if (room.players[0].id !== socket.id) {
      socket.emit('errorMsg', '방장만 게임을 시작할 수 있습니다.');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('errorMsg', '최소 2명이 참여해야 시작할 수 있습니다.');
      return;
    }

    room.gameStarted = true;
    room.turnIndex = 0;

    io.to(currentRoom).emit('gameStarted', {
      players: room.players,
      currentTurn: room.players[room.turnIndex]
    });
  });

  // 윷 던지기
  socket.on('throwYut', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    if (!room.gameStarted) return;
    const currentPlayer = room.players[room.turnIndex];

    if (currentPlayer.id !== socket.id) {
      socket.emit('errorMsg', '당신의 순서가 아닙니다!');
      return;
    }

    const result = getRandomYut();

    // '윷'이나 '모'가 나오면 한 번 더 턴 유지, 그 외에는 다음 사람 턴
    const isBonusTurn = result === '윷' || result === '모';
    if (!isBonusTurn) {
      room.turnIndex = (room.turnIndex + 1) % room.players.length;
    }

    io.to(currentRoom).emit('yutResult', {
      player: currentPlayer,
      result: result,
      nextTurn: room.players[room.turnIndex],
      isBonusTurn: isBonusTurn
    });
  });

  // 연결 해제
  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[currentRoom];
      } else {
        if (room.turnIndex >= room.players.length) {
          room.turnIndex = 0;
        }
        io.to(currentRoom).emit('roomState', {
          players: room.players,
          currentTurn: room.players[room.turnIndex],
          gameStarted: room.gameStarted
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
