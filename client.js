const roleInfo = {
    herbalist: ['🌿', 'Herbalist', 'Herb'], miner: ['💎', 'Miner', 'Crystal'], channeler: ['🔮', 'Channeler', 'Mana'], merchant: ['🪙', 'Merchant', 'Coin'],
    alchemist: ['⚗️', 'Alchemist', 'Potions'], seer: ['👁️', 'Seer', 'Peek'], ritualist: ['🕯️', 'Ritualist', 'Rituals'], thief: ['🗝️', 'Thief', 'Steal']
};
const roleOrder = Object.keys(roleInfo);
let state = null;
let priv = { round: 0, selected: [], resolved: [], locked: false, intent: null };
let localSelection = new Set();
let lastPhase = '';
let seerText = '';
const $ = (id) => document.getElementById(id);
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1500); }
function me() { return state?.players?.[parti.playerId]; }
function isMyResponse() { return state?.phase === 'responseQueue' && state.responseOrder?.[state.responseIndex] === parti.playerId; }
function roleCard(id) { const info = roleInfo[id]; const b = document.createElement('button'); b.className = 'role-card'; b.dataset.role = id; b.innerHTML = `<span class="icon">${info[0]}</span><b>${info[1]}</b><small>${info[2]}</small>`; b.onclick = () => onCard(id); return b; }
function mountHand() { const hand = $('hand'); hand.replaceChildren(...roleOrder.map(roleCard)); }
function onCard(id) { if (!state)
    return; if (state.phase === 'selectRoles' && !priv.locked) {
    if (localSelection.has(id))
        localSelection.delete(id);
    else if (localSelection.size < 4)
        localSelection.add(id);
    else
        toast('Choose exactly four');
    renderHand();
    renderControls();
    return;
} if (state.phase === 'startRole' && state.leadPlayerId === parti.playerId && priv.selected.includes(id) && !priv.resolved.includes(id)) {
    localSelection = new Set([id]);
    renderHand();
    renderControls();
} }
function renderPlayers() { const root = $('players'); const ids = state?.seatOrder || []; const existing = new Map(Array.from(root.children).map((el) => [el.dataset.id, el])); for (const id of ids) {
    let el = existing.get(id);
    if (!el) {
        el = document.createElement('div');
        el.className = 'seat';
        el.dataset.id = id;
        el.innerHTML = '<div class="avatar"></div><div><div class="seat-name"></div><div class="tokens"></div></div>';
        root.appendChild(el);
    }
    const p = state.players[id];
    el.classList.toggle('me', id === parti.playerId);
    el.style.opacity = p.connected ? '1' : '.48';
    el.querySelector('.avatar').textContent = (p.name || '?').slice(0, 1).toUpperCase();
    el.querySelector('.seat-name').textContent = p.name + (id === state.leadPlayerId ? ' ✦' : '');
    el.querySelector('.tokens').textContent = `🌿${p.resources.herb} 🔮${p.resources.mana} 💎${p.resources.crystal} 🪙${p.resources.coin} · ${p.vp}VP`;
    existing.delete(id);
} for (const el of existing.values())
    el.remove(); }
function renderRituals() { const root = $('rituals'); const rituals = state?.rituals || []; root.replaceChildren(...rituals.map((r) => { const d = document.createElement('div'); d.className = 'ritual'; const req = ['herb', 'mana', 'crystal'].filter(k => r.requirements[k]).map(k => `${k === 'herb' ? '🌿' : k === 'mana' ? '🔮' : '💎'} ${r.progress[k] || 0}/${r.requirements[k]}`).join(' · '); d.innerHTML = `<b>🕯️ ${r.name} · ${r.vp}VP</b><span>${req}</span>`; return d; })); }
function renderStage() { const stage = $('roleStage'); if (state?.currentRoleId) {
    const i = roleInfo[state.currentRoleId];
    stage.innerHTML = `<div><div class="active-card"><span class="icon">${i[0]}</span><b>${i[1]}</b><small>Final claim: ${state.claimHolderId ? state.players[state.claimHolderId]?.name : 'none'}</small></div><div class="claim-track">${(state.responseOrder || []).map((id, idx) => `<span class="claim-chip">${idx === state.responseIndex ? '➤ ' : ''}${state.players[id]?.name || '?'}</span>`).join('')}</div></div>`;
}
else {
    stage.innerHTML = '<div class="active-card" style="opacity:.48"><span class="icon">✦</span><b>The circle waits</b><small>Choose roles in secret</small></div>';
} }
function renderHand() { for (const el of Array.from($('hand').children)) {
    const id = el.dataset.role;
    const selected = state?.phase === 'selectRoles' ? localSelection.has(id) : priv.selected.includes(id);
    el.classList.toggle('selected', selected);
    el.classList.toggle('resolved', priv.resolved.includes(id));
    el.classList.toggle('locked', priv.locked);
    const playable = state?.phase === 'selectRoles' || (state?.phase === 'startRole' && state.leadPlayerId === parti.playerId && priv.selected.includes(id) && !priv.resolved.includes(id));
    el.disabled = !playable;
} }
function intentFor(role, mode) { const p = me(); if (!p)
    return {}; if (role === 'seer' || role === 'thief') {
    const target = state.seatOrder.find((id) => id !== parti.playerId && (role !== 'thief' || state.players[id].resources.coin > 0));
    return { targetId: target };
} if (role === 'ritualist') {
    for (const r of state.rituals || []) {
        const resources = [];
        for (const k of ['herb', 'mana', 'crystal']) {
            const need = (r.requirements[k] || 0) - (r.progress[k] || 0);
            for (let i = 0; i < need && resources.length < (mode === 'claim' ? 2 : 1); i++)
                if (p.resources[k] > resources.filter((x) => x === k).length)
                    resources.push(k);
        }
        if (resources.length)
            return { ritualId: r.id, resource: resources[0], resources };
    }
} if (role === 'alchemist') {
    if (mode === 'claim' && p.resources.herb && p.resources.mana && p.resources.crystal)
        return { recipeId: 'advanced' };
    const avail = ['herb', 'mana', 'crystal'].filter(k => p.resources[k] > 0);
    if (mode === 'favor' && avail.length >= 2)
        return { recipeId: `${avail[0]}+${avail[1]}` };
    if (mode === 'claim') {
        const copies = [];
        for (const k of ['herb', 'mana', 'crystal'])
            for (let i = 0; i < p.resources[k]; i++)
                copies.push(k);
        for (let a = 0; a < copies.length; a++)
            for (let b = a + 1; b < copies.length; b++)
                if (copies[a] !== copies[b]) {
                    const used = [a, b];
                    for (let c = 0; c < copies.length; c++)
                        if (!used.includes(c))
                            for (let d = c + 1; d < copies.length; d++)
                                if (!used.includes(d) && copies[c] !== copies[d])
                                    return { recipeId: `double:${copies[a]}+${copies[b]}|${copies[c]}+${copies[d]}` };
                }
    }
} return {}; }
function submitMode(mode) { const role = state.phase === 'startRole' ? [...localSelection][0] : state.currentRoleId; if (!role)
    return; const payload = { mode, ...intentFor(role, mode) }; if (state.phase === 'startRole')
    parti.action('startRole', { roleId: role, ...payload });
else
    parti.action('respondRole', payload); }
function renderControls() { const c = $('controls'); c.replaceChildren(); if (!state)
    return; if (state.phase === 'lobby') {
    const b = document.createElement('button');
    b.className = 'action';
    b.textContent = me()?.ready ? 'Ready ✓' : 'Ready';
    b.disabled = !!me()?.ready;
    b.onclick = () => parti.ready();
    c.appendChild(b);
    return;
} if (state.phase === 'selectRoles') {
    const b = document.createElement('button');
    b.className = 'action';
    b.textContent = priv.locked ? 'Locked ✓' : `Lock ${localSelection.size}/4`;
    b.disabled = priv.locked || localSelection.size !== 4;
    b.onclick = () => { parti.action('selectRoles', { roleIds: [...localSelection] }); parti.action('lockRoles'); };
    c.appendChild(b);
    return;
} if (state.phase === 'startRole' && state.leadPlayerId === parti.playerId && localSelection.size === 1) {
    for (const mode of ['favor', 'claim']) {
        const b = document.createElement('button');
        b.className = 'action ' + (mode === 'favor' ? 'secondary' : '');
        b.textContent = mode === 'favor' ? 'Take Favor' : 'Make Claim';
        b.onclick = () => submitMode(mode);
        c.appendChild(b);
    }
    return;
} if (isMyResponse()) {
    for (const mode of ['favor', 'claim']) {
        const b = document.createElement('button');
        b.className = 'action ' + (mode === 'favor' ? 'secondary' : '');
        b.textContent = mode === 'favor' ? 'Take Favor' : 'Challenge Claim';
        b.onclick = () => submitMode(mode);
        c.appendChild(b);
    }
    return;
} if (state.phase === 'gameEnd') {
    const text = document.createElement('div');
    text.textContent = state.winnerIds.includes(parti.playerId) ? '✦ You share the highest circle ✦' : 'The coven is complete';
    c.appendChild(text);
    if (state.seatOrder[0] === parti.playerId) {
        const b = document.createElement('button');
        b.className = 'action';
        b.textContent = 'Rematch';
        b.onclick = () => parti.action('rematch');
        c.appendChild(b);
    }
    return;
} const w = document.createElement('div'); w.textContent = 'Waiting for the circle…'; c.appendChild(w); }
function patch() { if (!state)
    return; $('phaseLabel').textContent = state.phase; $('roundBadge').textContent = `Round ${state.round} / 5`; $('message').textContent = state.message + (seerText ? ` · ${seerText}` : ''); $('privateHint').textContent = priv.locked ? `Hidden hand locked · ${priv.resolved.length}/4 resolved` : `Your hidden selection · ${localSelection.size}/4`; renderPlayers(); renderRituals(); renderStage(); renderHand(); renderControls(); }
mountHand();
parti.onState((s) => { state = s; if (lastPhase !== s.phase) {
    lastPhase = s.phase;
    if (s.phase === 'selectRoles' && priv.round !== s.round)
        localSelection.clear();
    if (s.phase === 'startRole')
        localSelection.clear();
} patch(); });
parti.onEvent('game:private-state', (p) => { priv = p; if (state?.phase === 'selectRoles' && p.selected.length && !p.locked)
    localSelection = new Set(p.selected); patch(); });
parti.onEvent('game:seer', (p) => { seerText = `Seer saw ${p.roles?.join(', ') || 'nothing'} (${p.count} remaining)`; toast(seerText); patch(); });
$('rulesBtn').onclick = () => $('rulesDialog').showModal();
$('closeRules').onclick = () => $('rulesDialog').close();
parti.exposeToAgent?.((s) => ({ summary: 'Grand Coven: secretly choose 4 roles. Favor is safe; Claim is stronger but can be stolen by later matching players.', phase: s.phase, round: s.round, you: parti.playerId, leadPlayerId: s.leadPlayerId, currentRoleId: s.currentRoleId, publicPlayers: s.players, rituals: s.rituals, privateRoles: priv.selected, privateResolved: priv.resolved, availableActions: s.phase === 'selectRoles' ? ['selectRoles', 'lockRoles'] : s.phase === 'startRole' && s.leadPlayerId === parti.playerId ? ['startRole'] : isMyResponse() ? ['respondRole'] : s.phase === 'gameEnd' ? ['rematch'] : [] }));
parti.ready();
