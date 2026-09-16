const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// 대각선 및 외곽 완주 이동 경로 계산
function calculateTargetPos(currentPos, steps) {
  if (steps === -1) {
    if (currentPos === 0) return 0;
    if (currentPos === 1) return 20;
    if (currentPos === 21) return 5;
    if (currentPos === 26) return 10;
    if (currentPos === 23) return 22;
    return currentPos - 1;
  }

  if (currentPos === 0) return steps;

  // 우상 모서리(5) 지름길: 총 11칸 (11번째 이동 시 완주)
  if (currentPos === 5) {
    const path5 = [20, 21, 22, 23, 24, 19, 14, 13, 12, 11, 10];
    if (steps > path5.length) return -1; // 칸 수 초과 시 이동 불가
    return steps === path5.length ? 30 : path5[steps - 1];
  }

  // 좌상 모서리(10) 지름길: 총 10칸
  if (currentPos === 10) {
    const path10 = [25, 26, 22, 23, 24, 19, 14, 13, 12, 11];
    if (steps > path10.length) return -1; // 칸 수 초과 시 이동 불가
    return steps === path10.length ? 30 : path10[steps - 1];
  }

  let pos = currentPos;
  let remainingSteps = steps;

  for (let i = 0; i < steps; i++) {
    if (pos === 22) { pos = 23; remainingSteps--; continue; }
    if (pos === 23) { pos = 24; remainingSteps--; continue; }
    if (pos === 24) { pos = 19; remainingSteps--; continue; }
    if (pos === 19) { pos = 14; remainingSteps--; continue; }
    if (pos === 28) { pos = 19; remainingSteps--; continue; }

    // 완주 직전 칸(14)에서 완주 지점(30) 진입 판단
    if (pos === 14) {
      if (remainingSteps === 1) return 30; // 정확히 남은 1칸으로 골인
      if (remainingSteps > 1) return -1;   // 칸 수 초과로 골인 불가
    }

    pos++;
    remainingSteps--;
  }

  if (pos === 30) return 30;
  if (pos > 30) return -1; // 초과 이동 금지

  return pos;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.roomId = roomId;
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurnIndex: 0,
        gameStarted: false,
        tokens: {}
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 4) {
      socket.emit('errorMsg', '방이 가득 찼습니다.');
      return;
    }

    const playerNumber = room.players.length + 1;
    const player = { id: socket.id, nickname, number: playerNumber };
    room.players.push(player);
    room.tokens[socket.id] = [0, 0, 0, 0]; // 각 플레이어당 말 4개

    io.to(roomId).emit('roomState', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      gameStarted: room.gameStarted,
      tokens: room.tokens
    });
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.players.length < 2) return;
    room.gameStarted = true;

    io.to(socket.roomId).emit('gameStarted', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      tokens: room.tokens
    });
  });

  socket.on('throwYut', ({ style }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.gameStarted) return;

    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.id !== socket.id) return;

    // 윷 던지기 확률 (빽도 포함)
    const yutResults = ['빽도', '도', '개', '걸', '윷', '모'];
    const weights = [1, 3, 6, 4, 1, 1];
    let totalWeight = weights.reduce((a, b) => a + b, 0);
    let rand = Math.floor(Math.random() * totalWeight);

    let result = '도';
    for (let i = 0; i < yutResults.length; i++) {
      if (rand < weights[i]) {
        result = yutResults[i];
        break;
      }
      rand -= weights[i];
    }

    io.to(socket.roomId).emit('yutResult', {
      player: currentPlayer,
      result,
      style
    });
  });

  socket.on('moveToken', ({ tokenIndex, steps, isYutOrMo }) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const playerTokens = room.tokens[socket.id];
    const currentPos = playerTokens[tokenIndex];

    const targetPos = calculateTargetPos(currentPos, steps);

    // 이동 불가(완주 초과)일 경우
    if (targetPos === -1) {
      socket.emit('invalidMove', { message: '완주 칸 수를 초과하여 이동할 수 없습니다.' });
      return;
    }

    // 업기 판정을 위해 기존 같은 위치에 있던 내 말들 함께 이동
    if (currentPos > 0 && currentPos < 30) {
      playerTokens.forEach((pos, idx) => {
        if (pos === currentPos) playerTokens[idx] = targetPos;
      });
    } else {
      playerTokens[tokenIndex] = targetPos;
    }

    // 상대방 말 잡기 검증
    let caughtOpponent = false;
    if (targetPos > 0 && targetPos < 30) {
      Object.keys(room.tokens).forEach((pId) => {
        if (pId !== socket.id) {
          room.tokens[pId].forEach((opPos, idx) => {
            if (opPos === targetPos) {
              room.tokens[pId][idx] = 0; // 시작 지점으로 리셋
              caughtOpponent = true;
            }
          });
        }
      });
    }

    // 윷/모를 던졌거나 상대 말을 잡았으면 턴 유지
    const hasExtraTurn = isYutOrMo || caughtOpponent;
    if (!hasExtraTurn) {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    }

    io.to(socket.roomId).emit('tokenMoved', {
      tokens: room.tokens,
      nextTurn: room.players[room.currentTurnIndex],
      caughtOpponent,
      hasExtraTurn
    });
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (room) {
      room.players = room.players.filter((p) => p.id !== socket.id);
      delete room.tokens[socket.id];
      if (room.players.length === 0) {
        delete rooms[socket.roomId];
      } else {
        room.currentTurnIndex %= room.players.length;
        io.to(socket.roomId).emit('roomState', {
          players: room.players,
          currentTurn: room.players[room.currentTurnIndex],
          gameStarted: room.gameStarted,
          tokens: room.tokens
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
