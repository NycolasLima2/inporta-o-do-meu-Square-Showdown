const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let matchmakingQueue = [];
const activeBattles = {};

// Tabela de vantagem de cores (Rubi > Esmeralda > Safira > Rubi)
function getTypeMultiplier(attackerType, defenderType) {
    if (attackerType === 'red' && defenderType === 'green') return 1.5;
    if (attackerType === 'green' && defenderType === 'blue') return 1.5;
    if (attackerType === 'blue' && defenderType === 'red') return 1.5;
    
    if (attackerType === 'green' && defenderType === 'red') return 0.75;
    if (attackerType === 'blue' && defenderType === 'green') return 0.75;
    if (attackerType === 'red' && defenderType === 'blue') return 0.75;
    
    return 1.0;
}

function generateBalancedStats() {
    const statKeys = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'spd'];
    const shuffled = [...statKeys].sort(() => Math.random() - 0.5);
    
    const maxStat = shuffled[0];
    const minStat = shuffled[1];
    const midStats = shuffled.slice(2);

    let remainingBudget = 240;
    const midValues = [];

    for (let i = 0; i < midStats.length; i++) {
        if (i === midStats.length - 1) {
            midValues.push(remainingBudget);
        } else {
            const slotsLeft = midStats.length - 1 - i;
            const minAllowed = Math.max(40, remainingBudget - (slotsLeft * 80));
            const maxAllowed = Math.min(80, remainingBudget - (slotsLeft * 40));
            
            const stepMin = Math.ceil(minAllowed / 5);
            const stepMax = Math.floor(maxAllowed / 5);
            const chosen = (Math.floor(Math.random() * (stepMax - stepMin + 1)) + stepMin) * 5;

            midValues.push(chosen);
            remainingBudget -= chosen;
        }
    }

    const stats = {};
    stats[maxStat] = 120;
    stats[minStat] = 10;
    midStats.forEach((key, idx) => {
        stats[key] = midValues[idx];
    });

    return stats;
}

function createDefaultTeam() {
    const templates = [
        {
            id: 1, name: 'Quadrado Rubi', color: '#f38ba8', type: 'red',
            moves: [
                { name: 'Impacto Rubi', power: 40, type: 'red', category: 'physical' },
                { name: 'Chama Oculta', power: 40, type: 'red', category: 'special' }
            ]
        },
        {
            id: 2, name: 'Quadrado Safira', color: '#89b4fa', type: 'blue',
            moves: [
                { name: 'Investida Azul', power: 40, type: 'blue', category: 'physical' },
                { name: 'Feixe Safira', power: 40, type: 'blue', category: 'special' }
            ]
        },
        {
            id: 3, name: 'Quadrado Esmeralda', color: '#a6e3a1', type: 'green',
            moves: [
                { name: 'Esmagamento', power: 40, type: 'green', category: 'physical' },
                { name: 'Pulso Vital', power: 40, type: 'green', category: 'special' }
            ]
        }
    ];

    return templates.map(tpl => {
        const stats = generateBalancedStats();
        return {
            ...tpl,
            hp: stats.hp,
            maxHp: stats.hp,
            atk: stats.atk,
            def: stats.def,
            spAtk: stats.spAtk,
            spDef: stats.spDef,
            spd: stats.spd,
            isFainted: false
        };
    });
}

function resolveTurn(battle) {
    if (battle.isFinished) return;

    const playerIds = Object.keys(battle.players);
    const p1 = battle.players[playerIds[0]];
    const p2 = battle.players[playerIds[1]];

    const logs = [];
    logs.push(`--- Turno ${battle.turn} ---`);

    const actions = [
        {
            attackerPlayer: p1,
            defenderPlayer: p2,
            attackerUnit: p1.team[p1.pendingAction.attackerIndex],
            targetUnit: p2.team[p1.pendingAction.targetIndex],
            move: p1.pendingAction.move
        },
        {
            attackerPlayer: p2,
            defenderPlayer: p1,
            attackerUnit: p2.team[p2.pendingAction.attackerIndex],
            targetUnit: p1.team[p2.pendingAction.targetIndex],
            move: p2.pendingAction.move
        }
    ];

    actions.sort((a, b) => b.attackerUnit.spd - a.attackerUnit.spd);

    for (const act of actions) {
        if (act.attackerUnit.isFainted) {
            logs.push(`${act.attackerUnit.name} (${act.attackerPlayer.name}) já está fora de combate!`);
            continue;
        }

        let target = act.targetUnit;
        if (target.isFainted) {
            target = act.defenderPlayer.team.find(u => !u.isFainted);
            if (!target) break;
        }

        const isPhysical = act.move.category === 'physical';
        const attackStat = isPhysical ? act.attackerUnit.atk : act.attackerUnit.spAtk;
        const defenseStat = isPhysical ? target.def : target.spDef;
        const categoryLabel = isPhysical ? 'Físico' : 'Especial';

        const multiplier = getTypeMultiplier(act.move.type, target.type);
        const statRatio = attackStat / Math.max(10, defenseStat);
        const baseDamage = (act.move.power * 0.5) * statRatio;
        const finalDamage = Math.max(4, Math.round(baseDamage * multiplier));

        target.hp = Math.max(0, target.hp - finalDamage);

        let effText = '';
        if (multiplier > 1) effText = ' [Super Efetivo!]';
        if (multiplier < 1) effText = ' [Pouco Efetivo...]';

        logs.push(
            `${act.attackerPlayer.name}: ${act.attackerUnit.name} usou ${act.move.name} (${categoryLabel}) em ${target.name} -> ${finalDamage} de dano!${effText}`
        );

        if (target.hp === 0) {
            target.isFainted = true;
            logs.push(`💥 ${target.name} de ${act.defenderPlayer.name} foi derrotado!`);
        }
    }

    p1.pendingAction = null;
    p2.pendingAction = null;
    battle.turn += 1;

    const p1Alive = p1.team.some(u => !u.isFainted);
    const p2Alive = p2.team.some(u => !u.isFainted);

    let winnerId = null;
    let winnerName = null;

    if (!p1Alive) {
        winnerId = p2.id;
        winnerName = p2.name;
    } else if (!p2Alive) {
        winnerId = p1.id;
        winnerName = p1.name;
    }

    if (winnerId) {
        battle.isFinished = true;
        logs.push(`🏆 FIM DE JOGO! ${winnerName} venceu a batalha!`);
    }

    io.to(battle.roomId).emit('turn_resolved', {
        battleState: battle,
        logs: logs,
        winnerId: winnerId,
        winnerName: winnerName,
        reason: 'Nocaute'
    });

    if (battle.isFinished) {
        delete activeBattles[battle.roomId];
    }
}

// Encerra a batalha por desistência ou desconexão
function handleForfeit(roomId, quitterSocketId, reasonText = 'Desistência') {
    const battle = activeBattles[roomId];
    if (!battle || battle.isFinished) return;

    const playerIds = Object.keys(battle.players);
    const quitter = battle.players[quitterSocketId];
    const winnerId = playerIds.find(id => id !== quitterSocketId);
    const winner = battle.players[winnerId];

    if (!quitter || !winner) return;

    battle.isFinished = true;

    io.to(roomId).emit('match_forfeited', {
        quitterId: quitter.id,
        quitterName: quitter.name,
        winnerId: winner.id,
        winnerName: winner.name,
        reason: reasonText
    });

    delete activeBattles[roomId];
}

io.on('connection', (socket) => {
    socket.on('find_match', (data) => {
        const playerName = (data?.playerName || 'Jogador').trim().slice(0, 15);
        if (matchmakingQueue.some(p => p.socket.id === socket.id)) return;

        matchmakingQueue.push({ socket, playerName });
        socket.emit('status_update', `Olá, ${playerName}! Procurando oponente...`);

        if (matchmakingQueue.length >= 2) {
            const p1 = matchmakingQueue.shift();
            const p2 = matchmakingQueue.shift();
            const roomId = `battle_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            p1.socket.join(roomId);
            p2.socket.join(roomId);

            const battleState = {
                roomId: roomId,
                turn: 1,
                isFinished: false,
                players: {
                    [p1.socket.id]: { id: p1.socket.id, name: p1.playerName, team: createDefaultTeam(), pendingAction: null },
                    [p2.socket.id]: { id: p2.socket.id, name: p2.playerName, team: createDefaultTeam(), pendingAction: null }
                }
            };

            activeBattles[roomId] = battleState;
            io.to(roomId).emit('match_found', battleState);
        }
    });

    socket.on('submit_action', (data) => {
        const battle = activeBattles[data.roomId];
        if (!battle || battle.isFinished) return;

        const player = battle.players[socket.id];
        if (!player || player.pendingAction) return;

        const attackerUnit = player.team[data.attackerIndex];
        if (!attackerUnit || attackerUnit.isFainted) return;

        const move = attackerUnit.moves[data.moveIndex];
        if (!move) return;

        player.pendingAction = {
            attackerIndex: data.attackerIndex,
            move: move,
            targetIndex: data.targetIndex
        };

        socket.emit('waiting_opponent');

        const allPlayers = Object.values(battle.players);
        if (allPlayers.every(p => p.pendingAction !== null)) {
            resolveTurn(battle);
        }
    });

    // Evento: Jogador clicou em "Sair / Desistir da Partida"
    socket.on('forfeit_match', (data) => {
        if (data?.roomId) {
            handleForfeit(data.roomId, socket.id, 'Desistência');
            socket.leave(data.roomId);
        }
    });

    socket.on('disconnect', () => {
        matchmakingQueue = matchmakingQueue.filter(p => p.socket.id !== socket.id);

        // Verifica se o jogador desconectado estava em alguma batalha ativa
        for (const roomId of Object.keys(activeBattles)) {
            if (activeBattles[roomId].players[socket.id]) {
                handleForfeit(roomId, socket.id, 'Adversário desconectou');
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));