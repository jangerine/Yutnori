const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

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

  socket.on('joinRoom', ({ roomId, nickname }) => {
    if (!roomId) return;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        turnIndex: 0,
        gameStarted: false,
        // 각 플레이어별 4개의 말 위치 (0: 대기중, 1~29: 판 위 위치, 30: 완주)
        tokens: {} 
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
    // 각 플레이어당 말 4개 초기화 (위치 0)
    room.tokens[socket.id] = [0, 0, 0, 0];

    socket.join(roomId);
    currentRoom = roomId;

    io.to(roomId).emit('roomState', {
      players: room.players,
      currentTurn: room.players[room.turnIndex],
      gameStarted: room.gameStarted,
      tokens: room.tokens
    });
  });

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
      currentTurn: room.players[room.turnIndex],
      tokens: room.tokens
    });
  });

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
    const isBonusTurn = result === '윷' || result === '모';

    io.to(currentRoom).emit('yutResult', {
      player: currentPlayer,
      result: result,
      isBonusTurn: isBonusTurn
    });
  });

  // 말 이동 이벤트
  socket.on('moveToken', ({ tokenIndex, steps }) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];

    if (room.players[room.turnIndex].id !== socket.id) return;

    const playerTokens = room.tokens[socket.id];
    let currentPos = playerTokens[tokenIndex];

    // 말 위치 계산 (최대 29번 칸까지, 그 이상은 완주 30)
    if (currentPos < 30) {
      currentPos += steps;
      if (currentPos >= 30) currentPos = 30; // 완주
      playerTokens[tokenIndex] = currentPos;
    }

    // 다음 턴으로 교체
    room.turnIndex = (room.turnIndex + 1) % room.players.length;

    io.to(currentRoom).emit('tokenMoved', {
      tokens: room.tokens,
      nextTurn: room.players[room.turnIndex]
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const room = rooms[currentRoom];
      room.players = room.players.filter(p => p.id !== socket.id);
      delete room.tokens[socket.id];

      if (room.players.length === 0) {
        delete rooms[currentRoom];
      } else {
        if (room.turnIndex >= room.players.length) room.turnIndex = 0;
        io.to(currentRoom).emit('roomState', {
          players: room.players,
          currentTurn: room.players[room.turnIndex],
          gameStarted: room.gameStarted,
          tokens: room.tokens
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
