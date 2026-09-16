const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 방별 게임 상태 저장소
const rooms = {};

// 윷 던지기 확률 구현 (실제 윷놀이 확률 반영)
function rollYut() {
  const yuts = [];
  for (let i = 0; i < 4; i++) {
    // 약 60% 확률로 평평한 면(배)이 나옴
    yuts.push(Math.random() < 0.6);
  }
  const flatCount = yuts.filter(isFlat => isFlat).length;

  switch (flatCount) {
    case 1: return '도';
    case 2: return '개';
    case 3: return '걸';
    case 4: return '윷';
    case 0: return '모';
    default: return '도';
  }
}

io.on('connection', (socket) => {
  console.log(`유저 접속: ${socket.id}`);

  // 1. 방 입장
  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentTurnIndex: 0,
        gameStarted: false,
        tokens: {}, // 유저별 말 위치 [0, 0, 0, 0]
        extraThrow: false
      };
    }

    const room = rooms[roomId];

    if (room.players.length >= 4) {
      socket.emit('errorMsg', '방이 가득 찼습니다. (최대 4명)');
      return;
    }

    const playerNumber = room.players.length + 1;
    const player = {
      id: socket.id,
      nickname: nickname || `플레이어 ${playerNumber}`,
      number: playerNumber
    };

    room.players.push(player);
    room.tokens[socket.id] = [0, 0, 0, 0]; // 말 4개 초기화 (0: 대기)

    io.to(roomId).emit('roomState', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      gameStarted: room.gameStarted,
      tokens: room.tokens
    });
  });

  // 2. 게임 시작
  socket.on('startGame', () => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    if (room.players.length < 2) {
      socket.emit('errorMsg', '2명 이상 참가해야 시작할 수 있습니다.');
      return;
    }

    room.gameStarted = true;
    room.currentTurnIndex = 0;

    io.to(roomId).emit('gameStarted', {
      players: room.players,
      currentTurn: room.players[room.currentTurnIndex],
      tokens: room.tokens
    });
  });

  // 3. 윷 던지기 (던지기 스킬 style 수신)
  socket.on('throwYut', ({ style }) => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    const currentTurnPlayer = room.players[room.currentTurnIndex];
    if (currentTurnPlayer.id !== socket.id) return;

    const result = rollYut();
    
    if (result === '윷' || result === '모') {
      room.extraThrow = true;
    }

    // 선택한 style 정보를 포함해 방 전체에 결과 전송
    io.to(roomId).emit('yutResult', {
      player: currentTurnPlayer,
      result,
      style: style || 'normal',
      extraThrow: room.extraThrow
    });
  });

  // 4. 말 이동 처리
  socket.on('moveToken', ({ tokenIndex, steps, isYutOrMo }) => {
    const roomId = Array.from(socket.rooms).find(r => r !== socket.id);
    if (!roomId) return;
    const room = rooms[roomId];

    const currentTurnPlayer = room.players[room.currentTurnIndex];
    if (currentTurnPlayer.id !== socket.id) return;

    const myTokens = room.tokens[socket.id];
    const currentPos = myTokens[tokenIndex];

    // 이동할 타겟 위치 계산
    let targetPos = 0;
    if (currentPos === 0) {
      targetPos = steps;
    } else if (currentPos === 5) {
      targetPos = 19 + steps;
    } else if (currentPos === 10) {
      targetPos = 24 + steps;
    } else if (currentPos === 22) {
      let pos = 26 + steps;
      targetPos = pos > 28 ? 19 + (pos - 28) : pos;
    } else {
      let pos = currentPos;
      for (let i = 0; i < steps; i++) {
        if (pos === 19 || pos === 24) { pos = 14; continue; }
        if (pos === 28) { pos = 19; continue; }
        pos++;
      }
      targetPos = pos > 28 ? 30 : pos; // 30: 완주
    }

    // 업고 있는 말(같은 위치의 내 말) 함께 이동
    if (currentPos > 0) {
      myTokens.forEach((pos, idx) => {
        if (pos === currentPos) {
          myTokens[idx] = targetPos;
        }
      });
    } else {
      myTokens[tokenIndex] = targetPos;
    }

    // 상대방 말 잡기 체크
    let caughtOpponent = false;
    if (targetPos > 0 && targetPos < 30) {
      Object.keys(room.tokens).forEach(pId => {
        if (pId !== socket.id) {
          room.tokens[pId].forEach((opPos, opIdx) => {
            if (opPos === targetPos) {
              room.tokens[pId][opIdx] = 0; // 잡힌 말은 출발지로
              caughtOpponent = true;
            }
          });
        }
      });
    }

    // 승리 조건 체크 (말 4개 모두 완주 = 30 이상)
    const isWinner = myTokens.every(pos => pos >= 30);
    if (isWinner) {
      io.to(roomId).emit('gameOver', { winner: currentTurnPlayer });
      return;
    }

    // 턴 교체 로직 (잡았거나 윷/모인 경우 한 번 더)
    let hasExtraTurn = false;
    if (caughtOpponent || isYutOrMo || room.extraThrow) {
      hasExtraTurn = true;
      room.extraThrow = false; // 보너스 기회 소진
    } else {
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    }

    io.to(roomId).emit('tokenMoved', {
      tokens: room.tokens,
      nextTurn: room.players[room.currentTurnIndex],
      caughtOpponent,
      hasExtraTurn
    });
  });

  // 5. 연결 해제 처리
  socket.on('disconnect', () => {
    console.log(`유저 퇴장: ${socket.id}`);
    
    Object.keys(rooms).forEach(roomId => {
      const room = rooms[roomId];
      const pIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (pIndex !== -1) {
        room.players.splice(pIndex, 1);
        delete room.tokens[socket.id];

        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          if (room.currentTurnIndex >= room.players.length) {
            room.currentTurnIndex = 0;
          }
          io.to(roomId).emit('roomState', {
            players: room.players,
            currentTurn: room.players[room.currentTurnIndex],
            gameStarted: room.gameStarted,
            tokens: room.tokens
          });
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 윷놀이 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
