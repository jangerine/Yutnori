const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 플레이어 정보 및 상태 관리
let players = []; // { id, name, color, pieces: Array(4) }
let currentTurnIndex = 0;
let gameStarted = false;
let lastRoll = null;

const PLAYER_COLORS = ['#FF4D4D', '#4D79FF', '#4DFF4D', '#FFD700']; // 1~4번 플레이어 색상

io.on('connection', (socket) => {
  console.log(`사용자 접속: ${socket.id}`);

  // 접속 상태 전송
  socket.emit('init-state', {
    players,
    gameStarted,
    currentTurnIndex,
    myId: socket.id
  });

  // 게임 참가 요청
  socket.on('join-game', (name) => {
    if (gameStarted) {
      socket.emit('error-msg', '이미 게임이 진행 중입니다.');
      return;
    }
    if (players.length >= 4) {
      socket.emit('error-msg', '방이 가득 찼습니다. (최대 4인)');
      return;
    }

    const player = {
      id: socket.id,
      name: name || `플레이어 ${players.length + 1}`,
      color: PLAYER_COLORS[players.length],
      // 각 말의 위치 (0: 대기 중, 1~29: 판 위치, 30: 완주)
      pieces: [0, 0, 0, 0] 
    };

    players.push(player);
    io.emit('players-updated', players);
  });

  // 게임 시작 요청 (최소 2인 이상)
  socket.on('start-game', () => {
    if (players.length < 2) {
      socket.emit('error-msg', '최소 2명 이상 참여해야 게임을 시작할 수 있습니다.');
      return;
    }
    gameStarted = true;
    currentTurnIndex = 0;
    io.emit('game-started', { players, currentTurnIndex });
  });

  // 윷 던지기
  socket.on('roll-yut', () => {
    if (!gameStarted) return;
    if (players[currentTurnIndex].id !== socket.id) {
      socket.emit('error-msg', '당신의 순서가 아닙니다!');
      return;
    }

    const outcomes = ['도', '개', '걸', '윷', '모', '빽도'];
    const weights = [3, 6, 4, 1, 1, 1]; // 가중치
    const expanded = [];
    outcomes.forEach((val, idx) => {
      for (let i = 0; i < weights[idx]; i++) expanded.push(val);
    });

    const result = expanded[Math.floor(Math.random() * expanded.length)];
    lastRoll = result;

    io.emit('yut-rolled', {
      playerName: players[currentTurnIndex].name,
      result: result
    });
  });

  // 말 이동 처리 및 턴 넘기기
  socket.on('move-piece', ({ pieceIndex, steps }) => {
    if (!gameStarted) return;
    if (players[currentTurnIndex].id !== socket.id) return;

    const currentPlayer = players[currentTurnIndex];
    let currentPos = currentPlayer.pieces[pieceIndex];

    // 말 위치 단순 이동 계산 (1~29 범위)
    if (currentPos < 30) {
      currentPos += steps;
      if (currentPos >= 30) currentPos = 30; // 완주
      currentPlayer.pieces[pieceIndex] = currentPos;
    }

    // 다음 턴 지정 (윷, 모가 아니면 순서 변경)
    if (lastRoll !== '윷' && lastRoll !== '모') {
      currentTurnIndex = (currentTurnIndex + 1) % players.length;
    }

    io.emit('state-updated', {
      players,
      currentTurnIndex
    });
  });

  // 접속 해제 시 처리
  socket.on('disconnect', () => {
    players = players.filter((p) => p.id !== socket.id);
    if (players.length < 2) {
      gameStarted = false;
    }
    io.emit('players-updated', players);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
