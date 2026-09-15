const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

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

// --- 윷놀이 정밀 경로 이동 계산 함수 ---
function getNextPosition(currentPos, steps) {
  // 1. 출발 안 한 대기 말
  if (currentPos === 0) {
    return steps; // 도(1)->1, 개(2)->2, 걸(3)->3, 윷(4)->4, 모(5)->5
  }

  let pos = currentPos;

  // 2. 정확히 모서리에 멈춰 서있을 때만 지름길 진입
  if (pos === 5) { // 우상단 모서리
    return 19 + steps; // 20번(대각선 첫번째 점)부터 진입
  }
  if (pos === 10) { // 좌상단 모서리
    return 24 + steps; // 25번(대각선 첫번째 점)부터 진입
  }
  if (pos === 22) { // 방아깨비 (중앙점)
    let nextPos = 26 + steps;
    if (nextPos > 28) nextPos = 19 + (nextPos - 28);
    return nextPos;
  }

  // 3. 모서리가 아닌 곳에서 출발한 말은 무조건 1칸씩 순서대로 직진
  for (let i = 0; i < steps; i++) {
    // 코스 꺾이는 연결점 처리
    if (pos === 19) { pos = 14; continue; } // 외곽 한바퀴 회전
    if (pos === 24) { pos = 14; continue; } // 대각선1 종료 후 좌하단(14번)으로 연결
    if (pos === 28) { pos = 19; continue; } // 대각선2 종료 후 출구(19번)로 연결

    pos++;
  }

  if (pos > 28) return 30; // 완주
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
