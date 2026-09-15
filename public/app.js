const socket = io();

let myId = null;
let currentPlayers = [];
let myTurn = false;

socket.on('init-state', (data) => {
  myId = data.myId;
  updateLobby(data.players);
});

socket.on('players-updated', (players) => {
  currentPlayers = players;
  updateLobby(players);
});

socket.on('error-msg', (msg) => {
  alert(msg);
});

socket.on('game-started', ({ players, currentTurnIndex }) => {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-area').classList.remove('hidden');
  updateGameState(players, currentTurnIndex);
});

socket.on('yut-rolled', ({ playerName, result }) => {
  document.getElementById('log').innerText = `${playerName}님이 '${result}'(을)를 던졌습니다!`;
});

socket.on('state-updated', ({ players, currentTurnIndex }) => {
  updateGameState(players, currentTurnIndex);
});

function joinGame() {
  const name = document.getElementById('username').value.trim();
  socket.emit('join-game', name);
}

function startGame() {
  socket.emit('start-game');
}

function rollYut() {
  socket.emit('roll-yut');
}

function updateLobby(players) {
  document.getElementById('player-count').innerText = `현재 참가자: ${players.length} / 4 (최소 2명 필요)`;
  const startBtn = document.getElementById('start-btn');
  
  // 방장(첫 접속자) 및 2인 이상 시 시작 버튼 활성화
  if (players.length >= 2 && players[0].id === myId) {
    startBtn.disabled = false;
  } else {
    startBtn.disabled = true;
  }
}

function updateGameState(players, turnIndex) {
  currentPlayers = players;
  const currentTurnPlayer = players[turnIndex];
  
  const turnInfo = document.getElementById('turn-info');
  turnInfo.innerText = `현재 순서: ${currentTurnPlayer.name}`;
  turnInfo.style.color = currentTurnPlayer.color;

  // 플레이어 목록 표시
  const display = document.getElementById('players-display');
  display.innerHTML = players.map(p => `
    <div class="player-card" style="background-color: ${p.color}">
      ${p.name} ${p.id === myId ? '(나)' : ''}
    </div>
  `).join('');
}
