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
  if (currentPos === 0) {
    return steps; // 출발
  }

  let pos = currentPos;

  // 1. 모서리 출발 분기점 처리 (윷판 코스 지름길)
  if (pos === 5) {
    // 오른쪽 위 모서리 (대각선 1 시작)
    pos = 20 + steps; // 21번 칸부터 대각선 진입
    if (pos > 25) pos = 15 + (pos - 25); // 대각선 빠져나와 왼쪽 아래로
    return pos;
  }
  
  if (pos === 10) {
    // 왼쪽 위 모서리 (대각선 2 시작)
    pos = 25 + steps; // 26번 칸부터 대각선 진입
    if (pos > 29) pos = 20; // 중앙 지나 우하단으로
    return pos;
  }

  if (pos === 23) {
    // 방아깨비(중앙) 출발 시 지름길 처리
    return 28 + steps;
  }

  // 2. 일반 직진 이동 처리
  for (let i = 0; i < steps; i++) {
    if (pos === 20) { pos = 15; continue; } // 외곽 한 바퀴 코스 연결
    if (pos === 25) { pos = 15; continue; } // 대각선1 종료 후 15번 연결
    if (pos === 29) { pos = 20; continue; } // 대각선2 종료 후 20번(출구) 연결
    
    pos++;
    
    // 외곽 완주(20번 넘어가면 종료)
    if (pos > 20 && pos < 21) pos = 30; 
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
    
    // 윷이나 모가 나오면 찬스 부여
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

    // 지름길 반영된 정확한 위치 계산
    let newPos = getNextPosition(currentPos, steps);

    myTokens[tokenIndex] = newPos;

    let caughtOpponent = false;

    // 상대방 말 잡기 검사 (대기 0 및 완주 30 제외)
    if (newPos > 0 && newPos < 30) {
      Object.keys(room.tokens).forEach(otherPlayerId => {
        if (otherPlayerId !== socket.id) {
          room.tokens[otherPlayerId].forEach((otherPos, oIdx) => {
            if (otherPos === newPos) {
              room.tokens[otherPlayerId][oIdx] = 0; // 잡힌 말은 대기소(0)로 격하
              caughtOpponent = true;
            }
          });
        }
      });
    }

    // 모/윷을 쳤거나 상대 말을 잡았으면 한 번 더 던짐
    const grantExtraTurn = isYutOrMo || caughtOpponent || room.extraThrow;

    if (grantExtraTurn) {
      room.extraThrow = false; // 보너스 기회 소비
    } else {
      // 다음 사람 턴 넘김
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
