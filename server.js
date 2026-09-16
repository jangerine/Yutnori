const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

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
    room.tokens[socket.id] = [0, 0, 0, 0]; // 0: 대기실, 1~29: 노드, 30: 완주

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

    // 빽도가 나왔을 때 움직일 수 있는 말이 있는지 검사
    const playerTokens = room.tokens[socket.id];
    const canMove = playerTokens.some(pos => pos > 0 && pos < 30);

    // 빽도이고 움직일 수 있는 말이 판 위에 없는 경우 (예: 게임 시작 직후 대기실 상태)
    if (result === '빽도' && !canMove) {
      // 다음 플레이어에게 턴 넘기기
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;

      io.to(socket.roomId).emit('yutResult', {
        player: currentPlayer,
        result,
        style,
        noValidMove: true
      });

      setTimeout(() => {
        io.to(socket.roomId).emit('tokenMoved', {
          tokens: room.tokens,
          nextTurn: room.players[room.currentTurnIndex],
          caughtOpponent: false,
          hasExtraTurn: false,
          skipReason: '빽도가 나왔으나 판 위에 움직일 말이 없어 턴이 넘어갑니다.'
        });
      }, 1500);

      return;
    }

    io.to(socket.roomId).emit('yutResult', {
      player: currentPlayer,
      result,
      style,
      noValidMove: false
    });
  });

  // 플레이어가 드래그해서 놓은 위치로 즉시 이동
  socket.on('moveTokenDirect', ({ tokenIndex, targetPos, isYutOrMo }) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const playerTokens = room.tokens[socket.id];
    const currentPos = playerTokens[tokenIndex];

    // 업은 말 동시 이동 처리
    if (currentPos > 0 && currentPos < 30) {
      playerTokens.forEach((pos, idx) => {
        if (pos === currentPos) playerTokens[idx] = targetPos;
      });
    } else {
      playerTokens[tokenIndex] = targetPos;
    }

    // 상대방 말 잡기 판정
    let caughtOpponent = false;
    if (targetPos > 0 && targetPos < 30) {
      Object.keys(room.tokens).forEach((pId) => {
        if (pId !== socket.id) {
          room.tokens[pId].forEach((opPos, idx) => {
            if (opPos === targetPos) {
              room.tokens[pId][idx] = 0; // 대기실로 리셋
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
