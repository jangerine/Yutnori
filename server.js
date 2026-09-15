const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// 윷 던지기 확률 계산
function rollYut() {
  const results = ['도', '개', '걸', '윷', '모'];
  const weights = [4, 6, 4, 1, 1];
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.floor(Math.random() * total);

  for (let i = 0; i < results.length; i++) {
    if (rand < weights[i]) return results[i];
    rand -= weights[i];
  }
  return '도';
}

// --- 정밀 경로 이동 계산 함수 (지름길 및 첫 출발 완전 보정) ---
function getNextPosition(currentPos, steps) {
  // 1. 대기 구역(0) 출발 보정: 도(1) -> 1번, 개(2) -> 2번, 걸(3) -> 3번...
  if (currentPos === 0) {
    return steps;
  }

  let pos = currentPos;

  // 2. 특수 지름길 코스 진입 연산
  // [우상단 모서리 (5번 칸) 출발] -> 대각선 1 진입 (21, 22, 23(중앙), 24, 25)
  if (pos === 5) {
    const diagPath1 = [21, 22, 23, 24, 25, 15, 16, 17, 18, 19, 20];
    const targetIdx = steps - 1;
    return targetIdx < diagPath1.length ? diagPath1[targetIdx] : 30;
  }

  // [좌상단 모서리 (10번 칸) 출발] -> 대각선 2 진입 (26, 27, 23(중앙), 28, 29)
  if (pos === 10) {
    const diagPath2 = [26, 27, 23, 28, 29, 20];
    const targetIdx = steps - 1;
    return targetIdx < diagPath2.length ? diagPath2[targetIdx] : 30;
  }

  // [중앙 방아깨비 (23번 칸) 출발] -> 우하단 지름길 코스 (28, 29, 20)
  if (pos === 23) {
    const centerPath = [28, 29, 20];
    const targetIdx = steps - 1;
    return targetIdx < centerPath.length ? centerPath[targetIdx] : 30;
  }

  // 3. 일반 경로 및 기타 대각선 코스 진행
  for (let i = 0; i < steps; i++) {
    if (pos === 20) return 30; // 20번 칸 지나면 완주(30)
    if (pos === 25) { pos = 15; continue; }
    if (pos === 29) { pos = 20; continue; }
    
    pos++;
  }

  if (pos > 29 && pos !== 30) return 30;
  return pos;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurnIndex: 0,
        gameStarted: false,
        tokens: {},
        extraThrow: false
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 4) {
      return socket.emit('errorMsg', '방이 가득 찼습니다.');
    }

    const playerNumber = room.players.length + 1;
    const player = { id: socket.id, nickname, number: playerNumber };
    room.players.push(player);
    room.tokens[socket.id] = [0, 0, 0, 0];

    io.to(roomId).emit('roomState', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      gameStarted: room.gameStarted,
      tokens: room.tokens
    });
  });

  socket.on('startGame', () => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    if (room.players.length < 2) return;

    room.gameStarted = true;
    room.currentTurnIndex = 0;
    room.extraThrow = false;

    io.to(roomId).emit('gameStarted', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      tokens: room.tokens
    });
  });

  socket.on('throwYut', () => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    const currentTurnPlayer = room.players[room.currentTurnIndex];
    if (currentTurnPlayer.id !== socket.id) return;

    const result = rollYut();
    
    if (result === '윷' || result === '모') {
      room.extraThrow = true;
    }

    io.to(roomId).emit('yutResult', {
      player: currentTurnPlayer,
      result,
      extraThrow: room.extraThrow
    });
  });

  socket.on('moveToken', ({ tokenIndex, steps, isYutOrMo }) => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    const currentTurnPlayer = room.players[room.currentTurnIndex];
    if (currentTurnPlayer.id !== socket.id) return;

    const myTokens = room.tokens[socket.id];
    let currentPos = myTokens[tokenIndex];

    let newPos = getNextPosition(currentPos, steps);
    myTokens[tokenIndex] = newPos;

    let caughtOpponent = false;

    if (newPos > 0 && newPos < 30) {
      Object.keys(room.tokens).forEach(otherPlayerId => {
        if (otherPlayerId !== socket.id) {
          room.tokens[otherPlayerId].forEach((otherPos, oIdx) => {
            if (otherPos === newPos) {
              room.tokens[otherPlayerId][oIdx] = 0;
              caughtOpponent = true;
            }
          });
        }
      });
    }

    const grantExtraTurn = isYutOrMo || caughtOpponent || room.extraThrow;

    if (grantExtraTurn) {
      room.extraThrow = false;
    } else {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    }

    io.to(roomId).emit('tokenMoved', {
      tokens: room.tokens,
      nextTurn: room.players[room.currentTurnIndex],
      caughtOpponent,
      hasExtraTurn: grantExtraTurn
    });
  });
});

server.listen(3000, () => console.log('서버 실행 중: http://localhost:3000'));
