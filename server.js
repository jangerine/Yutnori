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
  const weights = [4, 6, 4, 1, 1]; // 정통 확률
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
  // 1. 대기 구역(0)에서 처음 출발할 때 (도:1, 개:2, 걸:3, 윷:4, 모:5)
  if (currentPos === 0) {
    return steps;
  }

  let pos = currentPos;

  // 2. 모서리 출발 분기점 처리 (윷판 지름길 진입)
  if (pos === 5) {
    // 우상단 모서리(5) 출발 -> 대각선 1 진입 (21번부터 시작)
    pos = 20 + steps; 
    if (pos > 25) pos = 15 + (pos - 25);
    return pos;
  }
  
  if (pos === 10) {
    // 좌상단 모서리(10) 출발 -> 대각선 2 진입 (26번부터 시작)
    pos = 25 + steps;
    if (pos > 29) pos = 20;
    return pos;
  }

  if (pos === 23) {
    // 중앙 방아깨비(23) 출발 시 지름길 처리
    return 28 + steps;
  }

  // 3. 일반 직진 및 외곽 코스 순환
  for (let i = 0; i < steps; i++) {
    if (pos === 20) { pos = 15; continue; } // 외곽 한 바퀴 도는 연결
    if (pos === 25) { pos = 15; continue; } // 대각선 1 종료 후 15번 연결
    if (pos === 29) { pos = 20; continue; } // 대각선 2 종료 후 20번(출구) 연결
    
    pos++;
  }

  if (pos > 29) return 30; // 30: 완주
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
    room.tokens[socket.id] = [0, 0, 0, 0]; // 4개 말 보유 (0: 대기 구역)

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
    
    // 윷이나 모가 나오면 보너스 찬스
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

    // 정확한 이동 위치 계산 (첫 출발 보정 포함)
    let newPos = getNextPosition(currentPos, steps);

    myTokens[tokenIndex] = newPos;

    let caughtOpponent = false;

    // 상대방 말 잡기 검사 (대기 0 및 완주 30 제외)
    if (newPos > 0 && newPos < 30) {
      Object.keys(room.tokens).forEach(otherPlayerId => {
        if (otherPlayerId !== socket.id) {
          room.tokens[otherPlayerId].forEach((otherPos, oIdx) => {
            if (otherPos === newPos) {
              room.tokens[otherPlayerId][oIdx] = 0; // 잡힌 말은 대기소(0)로 복귀
              caughtOpponent = true;
            }
          });
        }
      });
    }

    // 모/윷을 던졌거나 상대 말을 잡았으면 한 번 더 던짐
    const grantExtraTurn = isYutOrMo || caughtOpponent || room.extraThrow;

    if (grantExtraTurn) {
      room.extraThrow = false;
    } else {
      // 다음 사람에게 턴 넘김
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
