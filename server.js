const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// 윷 던지기 확률 계산 함수
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

// --- 윷놀이 정밀 경로 이동 계산 함수 (한 칸 당겨진 좌표 기준) ---
function getNextPosition(currentPos, steps) {
  // 1. 대기 구역(0)에서 처음 출발할 때
  if (currentPos === 0) {
    return steps; // 도(1) -> 1번, 개(2) -> 2번, 걸(3) -> 3번...
  }

  let pos = currentPos;

  // 2. 5번 (우상단 모서리) 진입 지름길
  if (pos === 5) {
    // 5번 다음 칸은 대각선 20번 칸
    pos = 19 + steps;
    if (pos > 24) {
      // 대각선1 분기점(22:중앙) 지나고 나면 14번(좌하단) 방향 연계
      pos = 14 + (pos - 24);
    }
    return pos;
  }
  
  // 3. 10번 (좌상단 모서리) 진입 지름길
  if (pos === 10) {
    // 10번 다음 칸은 대각선 25번 칸
    pos = 24 + steps;
    if (pos > 28) {
      // 대각선2 끝(28) 지나면 19번(출구) 방향 연계
      pos = 19 + (pos - 28);
    }
    return pos;
  }

  // 4. 22번 (중앙 방아깨비) 진입 지름길
  if (pos === 22) {
    // 중앙(22)에서 우하단(출구) 방향 대각선 진입
    pos = 26 + steps;
    if (pos > 28) {
      pos = 19 + (pos - 28);
    }
    return pos;
  }

  // 5. 일반 직진 및 연결선 이동 (1칸씩 정확히 전진)
  for (let i = 0; i < steps; i++) {
    if (pos === 19) { pos = 14; continue; } // 외곽 바퀴 회전 연결
    if (pos === 24) { pos = 14; continue; } // 대각선 1 종료 후 14번 연결
    if (pos === 28) { pos = 19; continue; } // 대각선 2 종료 후 19번(출구) 연결
    
    pos++;
  }

  if (pos > 28) return 30; // 30: 완주 (판 밖으로 나감)
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

    // 정확한 이동 위치 계산
    let newPos = getNextPosition(currentPos, steps);

    myTokens[tokenIndex] = newPos;

    let caughtOpponent = false;

    // 상대방 말 잡기 검사 (대기 0 및 완주 30 제외)
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
