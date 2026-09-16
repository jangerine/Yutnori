const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

// 전체 윷놀이 경로를 배열 기반으로 명확히 정의하여 이동 계산
function calculateTargetPos(currentPos, steps) {
  // 1. 빽도(-1) 처리
  if (steps === -1) {
    if (currentPos === 0) return 0;
    if (currentPos === 1) return 20;
    if (currentPos === 21) return 5;
    if (currentPos === 26) return 10;
    if (currentPos === 23) return 22;
    if (currentPos === 30) return 30; // 완주한 말은 빽도 불가
    return currentPos - 1;
  }

  // 2. 시작 전 상태
  if (currentPos === 0) return steps;

  // 3. 각위치별 전체 출구까지의 고정 경로 정의 (30: 완주)
  let route = [];

  if (currentPos === 5) {
    route = [20, 21, 22, 23, 24, 19, 14, 13, 12, 11, 10, 30];
  } else if (currentPos === 10) {
    route = [25, 26, 22, 23, 24, 19, 14, 13, 12, 11, 30];
  } else if (currentPos === 22) {
    route = [23, 24, 19, 14, 13, 12, 11, 10, 30];
  } else if (currentPos === 23) {
    route = [24, 19, 14, 13, 12, 11, 10, 30];
  } else if (currentPos === 24) {
    route = [19, 14, 13, 12, 11, 10, 30];
  } else if (currentPos === 28) {
    route = [19, 14, 13, 12, 11, 10, 30];
  } else if (currentPos >= 20 && currentPos <= 21) {
    route = [];
    for (let p = currentPos + 1; p <= 22; p++) route.push(p);
    route.push(23, 24, 19, 14, 13, 12, 11, 10, 30);
  } else if (currentPos >= 25 && currentPos <= 26) {
    route = [];
    for (let p = currentPos + 1; p <= 26; p++) route.push(p);
    route.push(22, 23, 24, 19, 14, 13, 12, 11, 30);
  } else if (currentPos >= 1 && currentPos <= 19) {
    // 외곽 이동 경로
    route = [];
    let p = currentPos;
    while (p !== 20) {
      p++;
      if (p === 20) break;
      route.push(p);
    }
    route.push(30); // 20번(출구 모서리) 다음은 완주(30)
  }

  if (steps > route.length) return -1; // 완주 칸 수 초과 시 이동 불가
  return route[steps - 1];
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
    room.tokens[socket.id] = [0, 0, 0, 0];

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

    if (targetPos === -1) {
      socket.emit('invalidMove', { message: '완주 칸 수를 초과하여 이동할 수 없습니다. 다른 말을 선택하세요.' });
      return;
    }

    // 업기 판정: 출발지점(0)이나 완주지점(30)이 아닌 경우 같이 이동
    if (currentPos > 0 && currentPos < 30) {
      playerTokens.forEach((pos, idx) => {
        if (pos === currentPos) playerTokens[idx] = targetPos;
      });
    } else {
      playerTokens[tokenIndex] = targetPos;
    }

    // 상대방 말 잡기
    let caughtOpponent = false;
    if (targetPos > 0 && targetPos < 30) {
      Object.keys(room.tokens).forEach((pId) => {
        if (pId !== socket.id) {
          room.tokens[pId].forEach((opPos, idx) => {
            if (opPos === targetPos) {
              room.tokens[pId][idx] = 0;
              caughtOpponent = true;
            }
          });
        }
      });
    }

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
