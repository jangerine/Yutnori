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

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurnIndex: 0,
        gameStarted: false,
        tokens: {},
        extraThrow: false // 한 번 더 던질 기회 여부 플래그
      };
    }

    const room = rooms[roomId];
    if (room.players.length >= 4) {
      return socket.emit('errorMsg', '방이 가득 찼습니다.');
    }

    const playerNumber = room.players.length + 1;
    const player = { id: socket.id, nickname, number: playerNumber };
    room.players.push(player);
    room.tokens[socket.id] = [0, 0, 0, 0]; // 각 말의 위치 (0: 대기 구역)

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
    
    // 모나 윷이 나오면 한 번 더 던질 기회 보여줌
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

    // 단순 이동 위치 계산
    let newPos = (currentPos === 0) ? steps : currentPos + steps;
    if (newPos > 29) newPos = 30; // 완주 처리

    myTokens[tokenIndex] = newPos;

    let caughtOpponent = false;

    // 상대방 말 잡기 검사 (완주 칸 30이나 대기 칸 0이 아닌 경우)
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

    // 모, 윷을 던졌거나 상대 말을 잡았으면 한 번 더 기회!
    const grantExtraTurn = isYutOrMo || caughtOpponent || room.extraThrow;

    if (grantExtraTurn) {
      room.extraThrow = false; // 보너스 기회 사용 처리
    } else {
      // 보너스 기회가 없으면 다음 사람에게 턴 넘김
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
