const socket = io();

// Elementos Lobby & Histórico
const lobbyScreen = document.getElementById('lobbyScreen');
const playerNameInput = document.getElementById('playerNameInput');
const btnFindMatch = document.getElementById('btnFindMatch');
const statusText = document.getElementById('statusText');
const historyList = document.getElementById('historyList');
const scoreboardText = document.getElementById('scoreboardText');
const btnClearHistory = document.getElementById('btnClearHistory');

// Elementos Batalha
const battleScreen = document.getElementById('battleScreen');
const roomDisplay = document.getElementById('roomDisplay');
const turnDisplay = document.getElementById('turnDisplay');
const btnLeaveMatch = document.getElementById('btnLeaveMatch');
const myNameDisplay = document.getElementById('myNameDisplay');
const enemyNameDisplay = document.getElementById('enemyNameDisplay');
const mySquaresRow = document.getElementById('mySquaresRow');
const enemySquaresRow = document.getElementById('enemySquaresRow');
const instructionText = document.getElementById('instructionText');
const movesContainer = document.getElementById('movesContainer');
const logDiv = document.getElementById('log');

let currentBattle = null;
let currentEnemyName = 'Desconhecido';
let selectedAttackerIndex = null;
let selectedMoveIndex = null;
let isWaitingTurn = false;
let isMatchOver = false;

// =========================================================================
// GERENCIAMENTO DO HISTÓRICO DE BATALHAS (localStorage)
// =========================================================================
function getBattleHistory() {
    try {
        return JSON.parse(localStorage.getItem('square_showdown_history')) || [];
    } catch {
        return [];
    }
}

function saveBattleResult(opponentName, isVictory, reason) {
    const history = getBattleHistory();
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    history.unshift({
        opponent: opponentName,
        result: isVictory ? 'Vitória' : 'Derrota',
        isVictory: isVictory,
        reason: reason,
        time: timeStr
    });

    // Mantém as últimas 30 partidas
    if (history.length > 30) history.pop();

    localStorage.setItem('square_showdown_history', JSON.stringify(history));
    renderBattleHistory();
}

function renderBattleHistory() {
    const history = getBattleHistory();
    historyList.innerHTML = '';

    let wins = 0;
    let losses = 0;

    history.forEach(item => {
        if (item.isVictory) wins++;
        else losses++;

        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <div>
                <strong>vs ${item.opponent}</strong>
                <span style="color: #6c7086; font-size: 11px; margin-left: 6px;">(${item.reason} • ${item.time})</span>
            </div>
            <span class="${item.isVictory ? 'badge-win' : 'badge-loss'}">
                ${item.result.toUpperCase()}
            </span>
        `;
        historyList.appendChild(li);
    });

    if (history.length === 0) {
        historyList.innerHTML = '<li class="history-item" style="color: #6c7086; justify-content: center;">Nenhuma batalha registrada ainda.</li>';
    }

    scoreboardText.innerHTML = `<span class="wins">${wins}V</span> - <span class="losses">${losses}D</span>`;
}

btnClearHistory.addEventListener('click', () => {
    localStorage.removeItem('square_showdown_history');
    renderBattleHistory();
});

// =========================================================================
// NAVEGAÇÃO ENTRE ARENA E LOBBY
// =========================================================================
function returnToLobby(statusMsg = '') {
    currentBattle = null;
    selectedAttackerIndex = null;
    selectedMoveIndex = null;
    isWaitingTurn = false;
    isMatchOver = false;

    battleScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');

    playerNameInput.disabled = false;
    btnFindMatch.disabled = false;
    statusText.textContent = statusMsg;
    logDiv.innerHTML = '';
    movesContainer.innerHTML = '';

    renderBattleHistory();
}

btnLeaveMatch.addEventListener('click', () => {
    if (!currentBattle) return;

    if (isMatchOver) {
        // A partida já acabou, apenas volta para o Lobby
        returnToLobby();
    } else {
        // Partida em andamento: confirma desistência
        const confirmLeave = confirm('Tem certeza que deseja sair? Isso contará como DERROTA por desistência.');
        if (confirmLeave) {
            socket.emit('forfeit_match', { roomId: currentBattle.roomId });
        }
    }
});

// =========================================================================
// RENDERIZAÇÃO DA ARENA E COMBATE
// =========================================================================
function addLog(msg) {
    const p = document.createElement('div');
    p.textContent = `> ${msg}`;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function formatStat(label, value) {
    let cls = '';
    if (value >= 120) cls = 'stat-max';
    else if (value <= 10) cls = 'stat-min';
    return `<span class="${cls}">${label}:${value}</span>`;
}

function buildStatsHTML(unit) {
    return `
        <div class="stats-grid">
            ${formatStat('ATK', unit.atk)}
            ${formatStat('DEF', unit.def)}
            ${formatStat('SPD', unit.spd)}
            ${formatStat('SPA', unit.spAtk)}
            ${formatStat('SDF', unit.spDef)}
            ${formatStat('HP', unit.maxHp)}
        </div>
    `;
}

function renderArena() {
    if (!currentBattle) return;

    turnDisplay.textContent = currentBattle.turn;
    const playerIds = Object.keys(currentBattle.players);
    const myId = socket.id;
    const enemyId = playerIds.find(id => id !== myId);

    const me = currentBattle.players[myId];
    const enemy = currentBattle.players[enemyId];
    currentEnemyName = enemy.name;

    myNameDisplay.textContent = `${me.name} (Você)`;
    enemyNameDisplay.textContent = enemy.name;

    // Renderiza MEUS quadrados
    mySquaresRow.innerHTML = '';
    me.team.forEach((unit, idx) => {
        const hpPercent = Math.max(0, (unit.hp / unit.maxHp) * 100);
        const div = document.createElement('div');
        div.className = 'unit-wrapper' +
            (unit.isFainted ? ' fainted' : '') +
            (selectedAttackerIndex === idx ? ' selected-attacker' : '');

        div.innerHTML = `
            <div class="color-square" style="background-color: ${unit.color};"></div>
            <div class="unit-info">
                <div class="unit-name">
                    <span>${unit.name}</span>
                    <span style="font-size: 11px; color: #a6adc8;">${unit.hp}/${unit.maxHp} HP</span>
                </div>
                <div class="hp-bar-bg">
                    <div class="hp-bar-fill" style="width: ${hpPercent}%;"></div>
                </div>
                ${buildStatsHTML(unit)}
            </div>
        `;

        if (!unit.isFainted && !isWaitingTurn && !isMatchOver) {
            div.addEventListener('click', () => {
                selectedAttackerIndex = idx;
                selectedMoveIndex = 0;
                renderArena();
                renderMoves(unit);
                instructionText.textContent = `2. Escolha o golpe de ${unit.name} e clique no ALVO inimigo!`;
            });
        }

        mySquaresRow.appendChild(div);
    });

    // Renderiza quadrados INIMIGOS
    enemySquaresRow.innerHTML = '';
    enemy.team.forEach((unit, idx) => {
        const hpPercent = Math.max(0, (unit.hp / unit.maxHp) * 100);
        const div = document.createElement('div');
        const canTarget = !unit.isFainted && !isWaitingTurn && !isMatchOver && selectedAttackerIndex !== null && selectedMoveIndex !== null;

        div.className = 'unit-wrapper' +
            (unit.isFainted ? ' fainted' : '') +
            (canTarget ? ' targetable' : '');

        div.innerHTML = `
            <div class="color-square" style="background-color: ${unit.color};"></div>
            <div class="unit-info">
                <div class="unit-name">
                    <span>${unit.name}</span>
                    <span style="font-size: 11px; color: #a6adc8;">${unit.hp}/${unit.maxHp} HP</span>
                </div>
                <div class="hp-bar-bg">
                    <div class="hp-bar-fill" style="width: ${hpPercent}%;"></div>
                </div>
                ${buildStatsHTML(unit)}
            </div>
        `;

        if (canTarget) {
            div.addEventListener('click', () => {
                socket.emit('submit_action', {
                    roomId: currentBattle.roomId,
                    attackerIndex: selectedAttackerIndex,
                    moveIndex: selectedMoveIndex,
                    targetIndex: idx
                });
            });
        }

        enemySquaresRow.appendChild(div);
    });
}

function renderMoves(unit) {
    movesContainer.innerHTML = '';
    if (!unit || isWaitingTurn || isMatchOver) return;

    unit.moves.forEach((move, idx) => {
        const btn = document.createElement('button');
        const catIcon = move.category === 'physical' ? '⚔️ Físico' : '✨ Especial';
        btn.className = 'move-btn' + (selectedMoveIndex === idx ? ' selected-move' : '');
        btn.textContent = `${move.name} [${catIcon} | Pod: ${move.power}]`;
        btn.addEventListener('click', () => {
            selectedMoveIndex = idx;
            renderMoves(unit);
            renderArena();
        });
        movesContainer.appendChild(btn);
    });
}

// =========================================================================
// EVENTOS DO SOCKET.IO
// =========================================================================
btnFindMatch.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) {
        statusText.textContent = 'Por favor, digite um nome antes de entrar!';
        return;
    }
    localStorage.setItem('square_showdown_username', name);
    socket.emit('find_match', { playerName: name });
    playerNameInput.disabled = true;
    btnFindMatch.disabled = true;
});

socket.on('status_update', (msg) => {
    statusText.textContent = msg;
});

socket.on('match_found', (battleState) => {
    currentBattle = battleState;
    isMatchOver = false;
    isWaitingTurn = false;
    selectedAttackerIndex = null;
    selectedMoveIndex = null;

    btnLeaveMatch.textContent = 'Desistir da Partida';
    btnLeaveMatch.className = 'btn-danger';

    lobbyScreen.classList.add('hidden');
    battleScreen.classList.remove('hidden');
    roomDisplay.textContent = battleState.roomId;
    instructionText.textContent = '1. Clique em um dos seus quadrados para atacar';
    addLog('Batalha iniciada! Analise os atributos (120/10) e escolha seu atacante.');
    renderArena();
});

socket.on('waiting_opponent', () => {
    isWaitingTurn = true;
    movesContainer.innerHTML = '';
    instructionText.textContent = 'Jogada confirmada! Aguardando o oponente...';
    renderArena();
});

socket.on('turn_resolved', (data) => {
    currentBattle = data.battleState;
    isWaitingTurn = false;
    selectedAttackerIndex = null;
    selectedMoveIndex = null;

    data.logs.forEach(line => addLog(line));

    if (data.winnerId) {
        isMatchOver = true;
        const iWon = data.winnerId === socket.id;
        saveBattleResult(currentEnemyName, iWon, data.reason);

        instructionText.textContent = iWon
            ? `🏆 VITÓRIA! Você derrotou ${currentEnemyName}!`
            : `💀 DERROTA! ${data.winnerName} venceu a batalha.`;
        movesContainer.innerHTML = '';

        // Muda o botão de desistir para "Voltar ao Lobby"
        btnLeaveMatch.textContent = 'Voltar ao Lobby';
        btnLeaveMatch.className = 'btn-neutral';
    } else {
        instructionText.textContent = '1. Clique em um dos seus quadrados para atacar';
    }

    renderArena();
});

// Quando alguém clica em "Desistir da Partida" ou fecha a aba no meio do jogo
socket.on('match_forfeited', (data) => {
    if (!currentBattle || isMatchOver) return;

    isMatchOver = true;
    const iWon = data.winnerId === socket.id;
    saveBattleResult(currentEnemyName, iWon, data.reason);

    if (data.quitterId === socket.id) {
        // Fui eu que desisti: volta direto para o Lobby com aviso
        returnToLobby(`Você desistiu da partida contra ${currentEnemyName} (Derrota registrada).`);
    } else {
        // O oponente desistiu: fico na arena vendo a vitória e posso voltar quando quiser
        addLog(`🏳️ ${data.quitterName} abandonou a partida (${data.reason}). Você venceu!`);
        instructionText.textContent = `🏆 VITÓRIA! ${data.quitterName} desistiu da partida.`;
        movesContainer.innerHTML = '';
        btnLeaveMatch.textContent = 'Voltar ao Lobby';
        btnLeaveMatch.className = 'btn-neutral';
        renderArena();
    }
});

// Inicialização ao abrir a página: carrega último nome usado e o histórico
const savedName = localStorage.getItem('square_showdown_username');
if (savedName) playerNameInput.value = savedName;
renderBattleHistory();