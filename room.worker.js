const ROLE_IDS = ['herbalist', 'miner', 'channeler', 'merchant', 'alchemist', 'seer', 'ritualist', 'thief'];

const ROLE_INFO = {
    herbalist: { name: 'Herbalist', icon: '🌿', favor: '+1 herb', claim: '+2 herb' },
    miner: { name: 'Miner', icon: '💎', favor: '+1 crystal', claim: '+2 crystal' },
    channeler: { name: 'Channeler', icon: '🔮', favor: '+1 mana', claim: '+2 mana' },
    merchant: { name: 'Merchant', icon: '🪙', favor: '+1 coin', claim: '+3 coin' },
    alchemist: { name: 'Alchemist', icon: '⚗️', favor: 'Pay 2 different basics → basic potion', claim: 'Triad → advanced potion, or 2 basics' },
    seer: { name: 'Seer', icon: '👁️', favor: 'Peek one random remaining role', claim: 'See all remaining roles' },
    ritualist: { name: 'Ritualist', icon: '🕯️', favor: 'Contribute 1 resource', claim: 'Contribute up to 2 + gain 1 VP' },
    thief: { name: 'Thief', icon: '🗝️', favor: '+1 coin from supply', claim: 'Steal up to 2 coin' },
};
const RITUAL_LIBRARY = [
    { id: 'verdant-moon', name: 'Verdant Moon', vp: 3, requirements: { herb: 2, mana: 1 }, progress: {} },
    { id: 'glass-star', name: 'Glass Star', vp: 4, requirements: { crystal: 2, mana: 1 }, progress: {} },
    { id: 'root-crown', name: 'Root Crown', vp: 4, requirements: { herb: 2, crystal: 1 }, progress: {} },
    { id: 'triple-flame', name: 'Triple Flame', vp: 5, requirements: { herb: 1, mana: 1, crystal: 1 }, progress: {} },
    { id: 'silver-well', name: 'Silver Well', vp: 3, requirements: { mana: 2, crystal: 1 }, progress: {} },
    { id: 'thorn-prism', name: 'Thorn Prism', vp: 5, requirements: { herb: 1, crystal: 2 }, progress: {} },
];

function createPlayer(id, name) {
    return {
        id, name, connected: true, ready: false,
        resources: { herb: 2, mana: 2, crystal: 2, coin: 2 },
        vp: 0, basicPotions: 0, advancedPotions: 0,
        selectedCount: 0, resolvedCount: 0,
    };
}
function createInitialState() {
    return {
        gameId: 'grand-coven', revision: 0, phase: 'lobby', round: 0,
        leadPlayerId: null, currentRoleId: null, responseOrder: [], responseIndex: 0,
        claimHolderId: null, players: {}, seatOrder: [], rituals: [], eventLog: [], winnerIds: [],
        message: 'Waiting for 3–5 players',
    };
}
function cloneRitual(r) { return { ...r, requirements: { ...r.requirements }, progress: {} }; }
function makeRitualDeck(rng) {
    const a = RITUAL_LIBRARY.map(cloneRitual);
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function validRoleSelection(ids) {
    return Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4 && ids.every(x => typeof x === 'string' && ROLE_IDS.includes(x));
}
function clockwiseAfter(order, id) {
    const i = order.indexOf(id);
    if (i < 0)
        return [];
    return [...order.slice(i + 1), ...order.slice(0, i)];
}
function pickNextLead(order, preferred, hasUnresolved) {
    if (hasUnresolved(preferred))
        return preferred;
    const rotated = [preferred, ...clockwiseAfter(order, preferred)];
    return rotated.find(hasUnresolved) ?? order.find(hasUnresolved) ?? null;
}
function canPayBasicPair(resources) {
    const basics = ['herb', 'mana', 'crystal'];
    return basics.filter(r => (resources[r] || 0) > 0).length >= 2;
}
function payBasicPair(resources, pair) {
    if (!pair)
        return false;
    const parts = pair.split('+');
    if (parts.length !== 2 || parts[0] === parts[1] || !['herb', 'mana', 'crystal'].includes(parts[0]) || !['herb', 'mana', 'crystal'].includes(parts[1]))
        return false;
    if ((resources[parts[0]] || 0) < 1 || (resources[parts[1]] || 0) < 1)
        return false;
    resources[parts[0]]--;
    resources[parts[1]]--;
    return true;
}
function payAdvanced(resources) {
    if (['herb', 'mana', 'crystal'].some(r => (resources[r] || 0) < 1))
        return false;
    resources.herb--;
    resources.mana--;
    resources.crystal--;
    return true;
}
function contributeToRitual(ritual, resource) {
    const need = ritual.requirements[resource] || 0;
    const have = ritual.progress[resource] || 0;
    if (have >= need)
        return false;
    ritual.progress[resource] = have + 1;
    return true;
}
function ritualComplete(ritual) {
    return ['herb', 'mana', 'crystal'].every(r => (ritual.progress[r] || 0) >= (ritual.requirements[r] || 0));
}
function computeWinners(state) {
    let best = -Infinity;
    let tieResource = -Infinity;
    let winners = [];
    for (const id of state.seatOrder) {
        const p = state.players[id];
        if (!p)
            continue;
        const score = p.vp + Math.floor(p.resources.coin / 3);
        const t = p.resources.herb + p.resources.mana + p.resources.crystal;
        if (score > best || (score === best && t > tieResource)) {
            best = score;
            tieResource = t;
            winners = [id];
        }
        else if (score === best && t === tieResource)
            winners.push(id);
    }
    return winners;
}
function advanceRevision(state, type, detail) {
    state.revision++;
    state.eventLog.push({ revision: state.revision, type, detail });
    if (state.eventLog.length > 80)
        state.eventLog.splice(0, state.eventLog.length - 80);
}

import { defineRoom } from '@parti/worker-sdk';
let secrets = { round: new Map(), claimIntent: new Map(), ritualDeck: [] };
function newRoundSecrets(ids) {
    secrets.round = new Map(ids.map(id => [id, { selected: [], resolved: new Set(), locked: false, intent: null }]));
    secrets.claimIntent = new Map();
}
function sendPrivate(ctx, id) {
    const s = secrets.round.get(id);
    if (!s)
        return;
    ctx.send(id, 'game:private-state', { round: ctx.state.round, selected: s.selected, resolved: [...s.resolved], locked: s.locked, intent: s.intent });
}
function sendAllPrivate(ctx) { for (const id of ctx.state.seatOrder)
    sendPrivate(ctx, id); }
function syncCounts(ctx) {
    for (const id of ctx.state.seatOrder) {
        const s = secrets.round.get(id);
        const p = ctx.state.players[id];
        if (s && p) {
            p.selectedCount = s.selected.length;
            p.resolvedCount = s.resolved.size;
        }
    }
}
function startRound(ctx, round) {
    ctx.state.round = round;
    ctx.state.phase = 'selectRoles';
    ctx.state.currentRoleId = null;
    ctx.state.claimHolderId = null;
    ctx.state.responseOrder = [];
    ctx.state.responseIndex = 0;
    newRoundSecrets(ctx.state.seatOrder);
    if (!ctx.state.leadPlayerId)
        ctx.state.leadPlayerId = ctx.state.seatOrder[Math.floor(ctx.random() * ctx.state.seatOrder.length)] || null;
    ctx.state.message = `Round ${round}: choose 4 roles`;
    syncCounts(ctx);
    advanceRevision(ctx.state, 'round:start', { round, leadPlayerId: ctx.state.leadPlayerId });
    sendAllPrivate(ctx);
}
function allLocked(ctx) { return ctx.state.seatOrder.every((id) => secrets.round.get(id)?.locked); }
function allResolved(ctx) { return ctx.state.seatOrder.every((id) => (secrets.round.get(id)?.resolved.size || 0) >= 4); }
function selectedUnresolved(id, role) { const s = secrets.round.get(id); return !!s && s.selected.includes(role) && !s.resolved.has(role); }
function resolveResource(ctx, id, key, n) { ctx.state.players[id].resources[key] += n; }
function refillRitual(ctx, index) { const next = secrets.ritualDeck.shift(); if (next)
    ctx.state.rituals[index] = next;
else
    ctx.state.rituals.splice(index, 1); }
function applyRitual(ctx, actorId, intent, max) {
    const ritualId = intent?.ritualId;
    let idx = ctx.state.rituals.findIndex((r) => r.id === ritualId);
    if (idx < 0)
        return;
    const resources = (Array.isArray(intent?.resources) ? intent.resources : [intent?.resource]).filter((r) => ['herb', 'mana', 'crystal'].includes(r)).slice(0, max);
    let spent = 0;
    for (const r of resources) {
        if (ctx.state.players[actorId].resources[r] > 0 && contributeToRitual(ctx.state.rituals[idx], r)) {
            ctx.state.players[actorId].resources[r]--;
            spent++;
        }
    }
    if (spent === 0)
        return;
    if (ritualComplete(ctx.state.rituals[idx])) {
        const vp = ctx.state.rituals[idx].vp;
        ctx.state.players[actorId].vp += vp;
        advanceRevision(ctx.state, 'ritual:complete', { playerId: actorId, ritualId, vp });
        refillRitual(ctx, idx);
    }
}
function applyRole(ctx, role, actorId, mode, intent) {
    const p = ctx.state.players[actorId];
    if (!p)
        return;
    const n = mode === 'favor' ? 1 : 2;
    if (role === 'herbalist')
        resolveResource(ctx, actorId, 'herb', n);
    if (role === 'miner')
        resolveResource(ctx, actorId, 'crystal', n);
    if (role === 'channeler')
        resolveResource(ctx, actorId, 'mana', n);
    if (role === 'merchant')
        resolveResource(ctx, actorId, 'coin', mode === 'favor' ? 1 : 3);
    if (role === 'thief') {
        if (mode === 'favor')
            resolveResource(ctx, actorId, 'coin', 1);
        else {
            const target = intent?.targetId;
            if (target && target !== actorId && ctx.state.players[target]?.resources.coin > 0) {
                const take = Math.min(2, ctx.state.players[target].resources.coin);
                ctx.state.players[target].resources.coin -= take;
                p.resources.coin += take;
            }
        }
    }
    if (role === 'seer') {
        const target = intent?.targetId;
        if (target && target !== actorId && secrets.round.has(target)) {
            const ts = secrets.round.get(target);
            const rem = ts.selected.filter(r => !ts.resolved.has(r));
            const shown = mode === 'favor' ? (rem.length ? [rem[Math.floor(ctx.random() * rem.length)]] : []) : rem;
            ctx.send(actorId, 'game:seer', { targetId: target, roles: shown, count: rem.length, mode });
        }
    }
    if (role === 'alchemist') {
        const recipe = intent?.recipeId;
        if (mode === 'favor') {
            if (canPayBasicPair(p.resources) && payBasicPair(p.resources, recipe)) {
                p.basicPotions++;
                p.vp += 2;
            }
        }
        else if (recipe === 'advanced') {
            if (payAdvanced(p.resources)) {
                p.advancedPotions++;
                p.vp += 4;
            }
        }
        else if (recipe?.startsWith('double:')) {
            const pairs = recipe.slice(7).split('|');
            const snapshot = { ...p.resources };
            if (pairs.length === 2 && payBasicPair(p.resources, pairs[0]) && payBasicPair(p.resources, pairs[1])) {
                p.basicPotions += 2;
                p.vp += 4;
            }
            else
                p.resources = snapshot;
        }
    }
    if (role === 'ritualist') {
        applyRitual(ctx, actorId, intent, mode === 'favor' ? 1 : 2);
        if (mode === 'claim')
            p.vp += 1;
    }
    advanceRevision(ctx.state, 'role:effect', { role, actorId, mode });
}
function markRoleResolved(ctx, role) {
    for (const id of ctx.state.seatOrder) {
        const s = secrets.round.get(id);
        if (s?.selected.includes(role))
            s.resolved.add(role);
    }
    syncCounts(ctx);
}
function finishRole(ctx) {
    const role = ctx.state.currentRoleId;
    const holder = ctx.state.claimHolderId;
    if (holder)
        applyRole(ctx, role, holder, 'claim', secrets.claimIntent.get(holder));
    markRoleResolved(ctx, role);
    ctx.state.currentRoleId = null;
    ctx.state.responseOrder = [];
    ctx.state.responseIndex = 0;
    ctx.state.claimHolderId = null;
    secrets.claimIntent.clear();
    if (allResolved(ctx)) {
        if (ctx.state.round >= 5) {
            ctx.state.phase = 'gameEnd';
            ctx.state.winnerIds = computeWinners(ctx.state);
            ctx.state.message = 'Coven complete';
            advanceRevision(ctx.state, 'game:end', { winnerIds: ctx.state.winnerIds });
        }
        else {
            const preferred = holder || ctx.state.leadPlayerId;
            ctx.state.leadPlayerId = pickNextLead(ctx.state.seatOrder, preferred, (id) => true);
            startRound(ctx, ctx.state.round + 1);
        }
        return;
    }
    const preferred = holder || ctx.state.leadPlayerId;
    const next = pickNextLead(ctx.state.seatOrder, preferred, (id) => { const s = secrets.round.get(id); return !!s && s.resolved.size < 4; });
    ctx.state.leadPlayerId = next;
    ctx.state.phase = 'startRole';
    ctx.state.message = 'Lead player: choose a remaining role';
    advanceRevision(ctx.state, 'role:next', { leadPlayerId: next });
    sendAllPrivate(ctx);
}
function advanceQueue(ctx) {
    const role = ctx.state.currentRoleId;
    while (ctx.state.responseIndex < ctx.state.responseOrder.length) {
        const id = ctx.state.responseOrder[ctx.state.responseIndex];
        if (selectedUnresolved(id, role)) {
            ctx.state.message = `Waiting for ${ctx.state.players[id]?.name || 'player'}`;
            return;
        }
        ctx.state.responseIndex++;
    }
    finishRole(ctx);
}
function beginRole(ctx, playerId, role, mode, intent) {
    ctx.state.currentRoleId = role;
    ctx.state.phase = 'responseQueue';
    ctx.state.claimHolderId = null;
    ctx.state.responseOrder = clockwiseAfter(ctx.state.seatOrder, playerId);
    ctx.state.responseIndex = 0;
    if (mode === 'favor') {
        applyRole(ctx, role, playerId, 'favor', intent);
        secrets.round.get(playerId).resolved.add(role);
    }
    else {
        ctx.state.claimHolderId = playerId;
        secrets.claimIntent.set(playerId, intent);
    }
    syncCounts(ctx);
    advanceRevision(ctx.state, 'role:start', { playerId, role, mode });
    advanceQueue(ctx);
    sendAllPrivate(ctx);
}
function setIntent(ctx, id, payload) { const s = secrets.round.get(id); if (!s || s.locked === false && ctx.state.phase === 'selectRoles')
    return; s.intent = { ...(s.intent || {}), ...(payload || {}) }; sendPrivate(ctx, id); }
export default defineRoom({
    meta: { name: 'Grand Coven', minPlayers: 3, maxPlayers: 5 },
    initialState() { secrets = { round: new Map(), claimIntent: new Map(), ritualDeck: [] }; return createInitialState(); },
    onCreate(ctx) { secrets.ritualDeck = makeRitualDeck(() => ctx.random()); },
    onRestore(ctx) { secrets.ritualDeck = makeRitualDeck(() => ctx.random()); if (ctx.state.phase !== 'lobby' && ctx.state.phase !== 'gameEnd') {
        ctx.state.leadPlayerId = ctx.state.leadPlayerId || ctx.state.seatOrder[0] || null;
        startRound(ctx, Math.max(1, ctx.state.round || 1));
        ctx.state.message = 'Round reset after host recovery; reselect roles';
        advanceRevision(ctx.state, 'recovery:round-reset');
    } },
    onJoin(ctx, player) { if (player.role === 'spectator')
        return; if (ctx.state.phase !== 'lobby')
        return; if (!ctx.state.players[player.id]) {
        ctx.state.players[player.id] = createPlayer(player.id, player.name);
        ctx.state.seatOrder.push(player.id);
        advanceRevision(ctx.state, 'player:join', { playerId: player.id });
    } },
    onReconnect(ctx, player) { if (ctx.state.players[player.id]) {
        ctx.state.players[player.id].connected = true;
        sendPrivate(ctx, player.id);
        advanceRevision(ctx.state, 'player:reconnect', { playerId: player.id });
    } },
    onLeave(ctx, player) { if (ctx.state.players[player.id]) {
        ctx.state.players[player.id].connected = false;
        advanceRevision(ctx.state, 'player:disconnect', { playerId: player.id });
    } },
    onReady(ctx, player) { const p = ctx.state.players[player.id]; if (p) {
        p.ready = true;
        advanceRevision(ctx.state, 'player:ready', { playerId: player.id });
    } if (ctx.state.phase === 'lobby' && ctx.state.seatOrder.length >= 3 && ctx.state.seatOrder.length <= 5 && ctx.state.seatOrder.every((id) => ctx.state.players[id].ready)) {
        secrets.ritualDeck = makeRitualDeck(() => ctx.random());
        ctx.state.rituals = [secrets.ritualDeck.shift(), secrets.ritualDeck.shift()].filter(Boolean);
        ctx.state.leadPlayerId = ctx.state.seatOrder[Math.floor(ctx.random() * ctx.state.seatOrder.length)];
        startRound(ctx, 1);
    } },
    actions: {
        selectRoles(ctx, { player, payload }) { if (ctx.state.phase !== 'selectRoles' || !validRoleSelection(payload?.roleIds))
            return; const s = secrets.round.get(player.id); if (!s || s.locked)
            return; s.selected = [...payload.roleIds]; syncCounts(ctx); advanceRevision(ctx.state, 'roles:selected', { playerId: player.id }); sendPrivate(ctx, player.id); },
        lockRoles(ctx, { player }) { if (ctx.state.phase !== 'selectRoles')
            return; const s = secrets.round.get(player.id); if (!s || s.locked || s.selected.length !== 4)
            return; s.locked = true; advanceRevision(ctx.state, 'roles:locked', { playerId: player.id }); sendPrivate(ctx, player.id); if (allLocked(ctx)) {
            ctx.state.phase = 'startRole';
            ctx.state.message = 'Lead player: choose a remaining role';
            advanceRevision(ctx.state, 'roles:all-locked', { leadPlayerId: ctx.state.leadPlayerId });
        } },
        chooseRecipe(ctx, { player, payload }) { setIntent(ctx, player.id, { recipeId: payload?.recipeId }); },
        chooseTarget(ctx, { player, payload }) { setIntent(ctx, player.id, { targetId: payload?.playerId, ritualId: payload?.ritualId, resource: payload?.resource, resources: payload?.resources }); },
        startRole(ctx, { player, payload }) { if (ctx.state.phase !== 'startRole' || ctx.state.leadPlayerId !== player.id)
            return; const role = payload?.roleId; const mode = payload?.mode; if (!ROLE_IDS.includes(role) || !['favor', 'claim'].includes(mode) || !selectedUnresolved(player.id, role))
            return; beginRole(ctx, player.id, role, mode, secrets.round.get(player.id)?.intent); },
        respondRole(ctx, { player, payload }) { if (ctx.state.phase !== 'responseQueue')
            return; const expected = ctx.state.responseOrder[ctx.state.responseIndex]; if (expected !== player.id)
            return; const role = ctx.state.currentRoleId; if (!selectedUnresolved(player.id, role))
            return; const mode = payload?.mode; if (!['favor', 'claim'].includes(mode))
            return; const s = secrets.round.get(player.id); const intent = { ...(s.intent || {}), ...(payload || {}) }; if (mode === 'favor') {
            applyRole(ctx, role, player.id, 'favor', intent);
            s.resolved.add(role);
        }
        else {
            ctx.state.claimHolderId = player.id;
            secrets.claimIntent.set(player.id, intent);
        } ctx.state.responseIndex++; syncCounts(ctx); advanceRevision(ctx.state, 'role:response', { playerId: player.id, role, mode }); advanceQueue(ctx); sendAllPrivate(ctx); },
        rematch(ctx, { player }) { if (ctx.state.phase !== 'gameEnd' || player.id !== ctx.state.seatOrder[0])
            return; for (const id of ctx.state.seatOrder) {
            const old = ctx.state.players[id];
            ctx.state.players[id] = createPlayer(id, old.name);
            ctx.state.players[id].ready = true;
        } ctx.state.winnerIds = []; ctx.state.rituals = []; ctx.state.leadPlayerId = ctx.state.seatOrder[Math.floor(ctx.random() * ctx.state.seatOrder.length)]; secrets.ritualDeck = makeRitualDeck(() => ctx.random()); ctx.state.rituals = [secrets.ritualDeck.shift(), secrets.ritualDeck.shift()].filter(Boolean); startRound(ctx, 1); advanceRevision(ctx.state, 'game:rematch'); }
    }
});
