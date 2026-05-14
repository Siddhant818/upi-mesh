// ══════════════════════════════════════════════════════════════
//  UPI Mesh — app.js  (complete rewrite)
//
//  Animation pipeline per payment:
//    1. Encryption terminal  (faux RSA/AES lines typing out)
//    2. Packet seal          (ciphertext collapses into glowing PKT orb)
//    3. Broadcast fan-out    (PKT fires to ALL relay phones simultaneously)
//    4. Relay hop chain      (packet hops node→node toward bridge)
//    5. Bridge upload        (bridge glows green, sends to Bank node)
//    6. Bank settlement      (bank node appears, glows purple)
//    7. Outcome overlay      (result shown in canvas + hop log in left panel)
//
//  Multi-bridge test:
//    Same steps 1-3, then three independent relay chains race to server.
//    First = green SETTLED, rest = amber DUPLICATE_DROPPED.
// ══════════════════════════════════════════════════════════════

const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://upi-mesh.onrender.com';

// ══════════════════════════════════════════════════════════════
//  BG MESH  (full-page ambient canvas)
// ══════════════════════════════════════════════════════════════
;(function () {
  const cv  = document.getElementById('bgCanvas');
  const ctx = cv.getContext('2d');
  const N = 32, D = 160;
  let ns = [];

  function init () {
    cv.width  = window.innerWidth;
    cv.height = window.innerHeight;
    ns = Array.from({ length: N }, () => ({
      x: Math.random() * cv.width,  y: Math.random() * cv.height,
      vx: (Math.random()-.5)*.32,   vy: (Math.random()-.5)*.32,
    }));
  }

  function draw () {
    ctx.clearRect(0, 0, cv.width, cv.height);
    ns.forEach(n => {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > cv.width)  n.vx *= -1;
      if (n.y < 0 || n.y > cv.height) n.vy *= -1;
    });
    for (let i = 0; i < ns.length; i++) {
      for (let j = i+1; j < ns.length; j++) {
        const d = Math.hypot(ns[i].x-ns[j].x, ns[i].y-ns[j].y);
        if (d < D) {
          const a = (1 - d/D) * .25;
          ctx.beginPath();
          ctx.moveTo(ns[i].x, ns[i].y);
          ctx.lineTo(ns[j].x, ns[j].y);
          ctx.strokeStyle = `rgba(0,230,160,${a})`;
          ctx.lineWidth   = .6;
          ctx.stroke();
        }
      }
    }
    ns.forEach(n => {
      ctx.beginPath(); ctx.arc(n.x, n.y, 1.5, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(0,230,160,.4)'; ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  init(); draw();
  window.addEventListener('resize', init);
})();

// ══════════════════════════════════════════════════════════════
//  SIM CANVAS ENGINE
// ══════════════════════════════════════════════════════════════
const simCv  = document.getElementById('simCanvas');
const sctx   = simCv.getContext('2d');

// ── Node colours ─────────────────────────────────────────────
const NCOL = {
  sender:   { stroke:'#4c9eff', fill:'rgba(76,158,255,.12)',  glow:'rgba(76,158,255,.35)',  label:'#4c9eff' },
  relay:    { stroke:'#3d4560', fill:'rgba(61,69,96,.18)',    glow:'rgba(100,110,160,.15)', label:'#5a6280' },
  bridge:   { stroke:'#00e6a0', fill:'rgba(0,230,160,.12)',   glow:'rgba(0,230,160,.35)',   label:'#00e6a0' },
  bank:     { stroke:'#9b6dff', fill:'rgba(155,109,255,.12)', glow:'rgba(155,109,255,.35)', label:'#9b6dff' },
};

// ── Packet colours ────────────────────────────────────────────
const PCOL = {
  broadcast: '#4c9eff',
  relay:     '#f5b942',
  bridge:    '#00e6a0',
  settled:   '#00e6a0',
  duplicate: '#f5b942',
  invalid:   '#ff4060',
  bank:      '#9b6dff',
};

let simNodes  = [];
let simEdges  = [];
let packets   = [];
let simRaf    = null;
let simT      = 0;

// ── Fixed layout positions (fractions of canvas w/h) ─────────
//   Sender always far-left, Bank always far-right.
//   Relays + bridge scattered in between.
const LAYOUT = [
  { fx:.10, fy:.50 },  // 0 = sender
  { fx:.92, fy:.50 },  // 1 = bank/server
  { fx:.35, fy:.18 },  // 2
  { fx:.62, fy:.18 },  // 3
  { fx:.48, fy:.40 },  // 4
  { fx:.35, fy:.72 },  // 5
  { fx:.62, fy:.72 },  // 6
  { fx:.22, fy:.35 },  // 7
  { fx:.75, fy:.35 },  // 8
  { fx:.22, fy:.65 },  // 9
  { fx:.75, fy:.65 },  // 10
];

const PHONE_NAMES = ['Ananya','Rohan','Priya','Arjun','Meera','Kartik','Sneha','Varun'];

function buildNodes (w, h, senderUpi, hopIds, bridgeId) {
  simNodes = [];
  simEdges = [];

  // Always: [0]=sender, [1]=bank, then relays+bridge
  const allIds = ['SENDER', 'BANK', ...hopIds];
  const roles  = ['sender','bank', ...hopIds.map(id => id === bridgeId ? 'bridge' : 'relay')];
  const labels = [
    senderUpi.split('@')[0],
    '🏦 Bank',
    ...hopIds.map((id,i) => PHONE_NAMES[i % PHONE_NAMES.length]),
  ];

  allIds.slice(0, LAYOUT.length).forEach((id, i) => {
    simNodes.push({
      id,
      role:    roles[i] || 'relay',
      label:   labels[i] || id,
      x:       LAYOUT[i].fx * w,
      y:       LAYOUT[i].fy * h,
      r:       (i === 0 || i === 1) ? 13 : 9,
      glowAmt: 0,
      pulseT:  Math.random() * Math.PI * 2,
      visible: i !== 1,  // bank starts hidden — appears at settlement
    });
  });

  // Edges between nearby nodes (exclude bank for now)
  for (let i = 0; i < simNodes.length; i++) {
    if (i === 1) continue;   // bank not connected to mesh
    for (let j = i+1; j < simNodes.length; j++) {
      if (j === 1) continue;
      const d = Math.hypot(simNodes[i].x-simNodes[j].x, simNodes[i].y-simNodes[j].y);
      if (d < w * .42) simEdges.push({ a:i, b:j });
    }
  }
}

function ni (id) { return simNodes.findIndex(n => n.id === id); }

// ── Draw loop ─────────────────────────────────────────────────
function drawSim () {
  const w = simCv.width, h = simCv.height;
  sctx.clearRect(0, 0, w, h);
  simT += .016;

  // Edges
  simEdges.forEach(e => {
    const a = simNodes[e.a], b = simNodes[e.b];
    if (!a.visible || !b.visible) return;
    sctx.beginPath();
    sctx.moveTo(a.x, a.y); sctx.lineTo(b.x, b.y);
    sctx.strokeStyle = 'rgba(255,255,255,.042)';
    sctx.lineWidth   = 1;
    sctx.stroke();
  });

  // Nodes
  simNodes.forEach(n => {
    if (!n.visible) return;
    n.pulseT += .03;
    const pulse = 1 + Math.sin(n.pulseT) * .08;
    const c = NCOL[n.role] || NCOL.relay;

    // Glow halo
    if (n.glowAmt > 0) {
      const gr = sctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r*3.5);
      gr.addColorStop(0, c.glow.replace(/[\d.]+\)$/, v => String(parseFloat(v)*n.glowAmt)+')'));
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.beginPath(); sctx.arc(n.x, n.y, n.r*3.5, 0, Math.PI*2);
      sctx.fillStyle = gr; sctx.fill();
      n.glowAmt = Math.max(0, n.glowAmt - .016);
    }

    // Fill
    sctx.beginPath(); sctx.arc(n.x, n.y, n.r*pulse, 0, Math.PI*2);
    sctx.fillStyle   = c.fill; sctx.fill();
    sctx.strokeStyle = c.stroke;
    sctx.lineWidth   = n.role==='sender'||n.role==='bank'||n.role==='bridge' ? 2 : 1.4;
    sctx.stroke();

    // Label below
    sctx.fillStyle    = c.label;
    sctx.font         = `500 9px 'JetBrains Mono'`;
    sctx.textAlign    = 'center';
    sctx.textBaseline = 'top';
    sctx.fillText(n.label, n.x, n.y + n.r + 5);

    // Role tag
    if (n.role !== 'relay') {
      sctx.font      = '500 7px JetBrains Mono';
      sctx.fillStyle = c.label + '88';
      sctx.fillText(n.role.toUpperCase(), n.x, n.y + n.r + 16);
    }
  });

  // Packets
  packets = packets.filter(p => !p.done);
  packets.forEach(drawPacket);

  simRaf = requestAnimationFrame(drawSim);
}

// ── Packet ────────────────────────────────────────────────────
function drawPacket (p) {
  p.t += p.speed;
  if (p.t >= 1) { p.t = 1; p.done = true; p.onArrive?.(); }

  const t  = ease(p.t);
  const x  = lerp(p.x0, p.x1, t);
  const y  = lerp(p.y0, p.y1, t);

  // Trail
  sctx.beginPath();
  sctx.moveTo(p.x0, p.y0); sctx.lineTo(x, y);
  sctx.strokeStyle = p.col + '55';
  sctx.lineWidth   = 1.4;
  sctx.stroke();

  // Glow
  const gr = sctx.createRadialGradient(x,y,0,x,y,10);
  gr.addColorStop(0, p.col+'bb');
  gr.addColorStop(1, p.col+'00');
  sctx.beginPath(); sctx.arc(x,y,10,0,Math.PI*2);
  sctx.fillStyle = gr; sctx.fill();

  // Dot
  sctx.beginPath(); sctx.arc(x,y,3.5,0,Math.PI*2);
  sctx.fillStyle  = p.col;
  sctx.shadowColor = p.col; sctx.shadowBlur = 8;
  sctx.fill();
  sctx.shadowBlur  = 0;
}

function ease (t) { return t<.5 ? 2*t*t : -1+(4-2*t)*t; }
function lerp (a,b,t) { return a + (b-a)*t; }

function spawnPacket (fromIdx, toIdx, col, speed=.015, onArrive) {
  const f = simNodes[fromIdx], t = simNodes[toIdx];
  if (!f || !t) return;
  packets.push({ x0:f.x, y0:f.y, x1:t.x, y1:t.y, t:0, col, speed, done:false, onArrive });
}

function glow (idx, amt=1.2) {
  if (simNodes[idx]) simNodes[idx].glowAmt = amt;
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)); }

function waitPacket (fromIdx, toIdx, col, speed=.015) {
  return new Promise(res => spawnPacket(fromIdx, toIdx, col, speed, res));
}

function resizeSim () {
  const w = document.getElementById('meshWrap');
  simCv.width  = w.clientWidth;
  simCv.height = w.clientHeight;
}

function startLoop () {
  if (simRaf) cancelAnimationFrame(simRaf);
  simRaf = requestAnimationFrame(drawSim);
}

// ══════════════════════════════════════════════════════════════
//  ENCRYPTION TERMINAL ANIMATION
// ══════════════════════════════════════════════════════════════
function fakeHex (len) {
  return Array.from({length:len}, ()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('');
}

async function runEncryptionScreen (senderUpi, receiverUpi, amount) {
  const overlay = document.getElementById('encOverlay');
  const lines   = document.getElementById('encLines');
  const seal    = document.getElementById('encSeal');

  overlay.style.display = 'flex';
  lines.innerHTML = '';
  seal.style.display = 'none';

  const steps = [
    { cls:'dim', text:`> Building payment payload…` },
    { cls:'dim', text:`  { from: "${senderUpi}", to: "${receiverUpi}", amount: ₹${amount} }` },
    { cls:'dim', text:`` },
    { cls:'key', text:`> Generating RSA-2048 session key…` },
    { cls:'key', text:`  enc_key: ${fakeHex(16)}…${fakeHex(8)}` },
    { cls:'aes', text:`> AES-256-GCM encrypting payload…` },
    { cls:'aes', text:`  nonce:   ${fakeHex(12)}` },
    { cls:'ct',  text:`  cipher:  ${fakeHex(24)}…` },
    { cls:'ct',  text:`           ${fakeHex(24)}…` },
    { cls:'ok',  text:`> Packet sealed ✓  [${fakeHex(4).toUpperCase()}]` },
  ];

  for (let i = 0; i < steps.length; i++) {
    await sleep(i === 0 ? 80 : 120);
    const el = document.createElement('div');
    el.className = `el ${steps[i].cls}`;
    el.textContent = steps[i].text;
    el.style.animationDelay = '0ms';
    lines.appendChild(el);
    lines.scrollTop = lines.scrollHeight;
  }

  await sleep(200);
  seal.style.display = 'flex';
  await sleep(900);

  // Fade overlay out
  overlay.style.transition = 'opacity .4s';
  overlay.style.opacity = '0';
  await sleep(420);
  overlay.style.display = 'none';
  overlay.style.opacity = '1';
  overlay.style.transition = '';
}

// ══════════════════════════════════════════════════════════════
//  MAIN PAYMENT ANIMATION
// ══════════════════════════════════════════════════════════════
async function animatePayment (data, outcome) {
  // Reset UI
  document.getElementById('meshIdle').style.display    = 'none';
  document.getElementById('outcomeBar').style.display  = 'none';
  document.getElementById('hopRouteWrap').style.display = 'none';
  document.getElementById('routeChain').innerHTML      = '';
  packets = [];

  resizeSim();
  const hops     = data.hops || [];
  const relayIds = hops.filter(h => !h.isBridge).map((h,i) => h.nodeId || `relay${i}`);
  const bridgeId = hops.find(h => h.isBridge)?.nodeId || 'bridge0';
  const allHopIds = [...relayIds, bridgeId];

  buildNodes(simCv.width, simCv.height, data.senderUpi, allHopIds, bridgeId);
  startLoop();

  const sIdx  = ni('SENDER');
  const bankI = ni('BANK');
  const bIdx  = ni(bridgeId);

  // ── Phase 1: Encryption terminal ──────────────────────────
  await runEncryptionScreen(data.senderUpi, data.receiverUpi, data.amount);

  // ── Phase 2: Broadcast fan-out — sender → ALL relays ──────
  //   This is the key visual: sender fires to EVERY mesh node at once
  glow(sIdx, 1.3);
  await sleep(160);

  const allRelayIdxs = allHopIds.map(id => ni(id)).filter(i => i >= 0 && i !== sIdx && i !== bankI);

  // Stagger slightly so rays look organic, not robotic
  allRelayIdxs.forEach((ri, i) => {
    setTimeout(() => spawnPacket(sIdx, ri, PCOL.broadcast, .02), i * 40);
  });
  await sleep(900);
  allRelayIdxs.forEach(ri => glow(ri, .7));

  await sleep(200);

  // ── Phase 3: Relay chain → bridge ─────────────────────────
  //   Packet hops: sender → relay1 → relay2 → … → bridge
  const chain = [sIdx, ...relayIds.map(id => ni(id)).filter(i=>i>=0), bIdx];
  for (let i = 0; i < chain.length - 1; i++) {
    glow(chain[i], .8);
    await waitPacket(chain[i], chain[i+1], PCOL.relay, .022);
    glow(chain[i+1], 1.0);
    await sleep(60);
  }

  await sleep(180);

  // ── Phase 4: Bridge → Bank (server upload) ────────────────
  simNodes[bankI].visible = true;  // reveal bank node
  glow(bIdx, 1.2);
  await sleep(120);

  // Draw dashed "internet" line from bridge to bank
  const finalCol = outcome === 'SETTLED' ? PCOL.settled
                 : outcome === 'DUPLICATE_DROPPED' ? PCOL.duplicate
                 : PCOL.invalid;

  await waitPacket(bIdx, bankI, finalCol, .018);
  glow(bankI, 1.4);

  await sleep(300);

  // ── Phase 5: Outcome overlay ──────────────────────────────
  const emo = { SETTLED:'✅', DUPLICATE_DROPPED:'♻️', INVALID:'❌' };
  const cls = outcome === 'SETTLED' ? 'settled' : outcome === 'DUPLICATE_DROPPED' ? 'duplicate' : 'invalid';
  const bar = document.getElementById('outcomeBar');
  bar.className = `outcome-bar ${cls}`;

  if (outcome === 'SETTLED') {
    document.getElementById('outcomeText').innerHTML =
      `${emo[outcome]} SETTLED &nbsp;·&nbsp; ${data.senderUpi} → ${data.receiverUpi} &nbsp;·&nbsp; ₹${data.amount} &nbsp;·&nbsp; ${data.hopCount} hops via ${data.bridgeNode}`;
  } else {
    document.getElementById('outcomeText').innerHTML =
      `${emo[outcome] || '❌'} ${outcome} &nbsp;·&nbsp; ${data.reason || 'see feed'}`;
  }
  bar.style.display = 'block';

  // ── Phase 6: Hop route badges in left panel ───────────────
  const routeChain = document.getElementById('routeChain');
  document.getElementById('hopRouteWrap').style.display = 'block';

  const routeNodes = [
    { label: data.senderUpi,  cls: 's' },
    ...hops.map(h => ({ label: h.nodeId, cls: h.isBridge ? 'b' : 'r' })),
    { label: '🏦 Bank',       cls: 'bk' },
  ];

  for (let i = 0; i < routeNodes.length; i++) {
    await sleep(i === 0 ? 0 : 100);
    const span = document.createElement('span');
    span.className = `rc-node ${routeNodes[i].cls}`;
    span.textContent = routeNodes[i].label;
    routeChain.appendChild(span);
    if (i < routeNodes.length - 1) {
      const arr = document.createElement('span');
      arr.className = 'rc-arr'; arr.textContent = '→';
      routeChain.appendChild(arr);
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  MULTI-BRIDGE ANIMATION
//  Same encrypt + fan-out, then THREE simultaneous chains race
//  to the bank — first wins, rest are DUPLICATE_DROPPED
// ══════════════════════════════════════════════════════════════
async function animateMultiBridge (data) {
  document.getElementById('meshIdle').style.display   = 'none';
  document.getElementById('outcomeBar').style.display = 'none';
  packets = [];

  resizeSim();
  const results    = data.results || [];
  const bridgeIds  = results.map(r => r.bridgeNode);
  const allHopIds  = bridgeIds;

  buildNodes(simCv.width, simCv.height, 'sender', allHopIds, bridgeIds[0]);
  // Mark all as bridge
  bridgeIds.forEach(id => { const n = simNodes.find(n=>n.id===id); if(n) n.role='bridge'; });
  startLoop();

  const sIdx  = ni('SENDER');
  const bankI = ni('BANK');

  // Encryption screen
  await runEncryptionScreen('sender', 'receiver', data.results[0]?.amount || '?');

  // Broadcast
  glow(sIdx, 1.3);
  const bIdxs = bridgeIds.map(id => ni(id)).filter(i=>i>=0);
  bIdxs.forEach((bi,i) => setTimeout(() => spawnPacket(sIdx, bi, PCOL.broadcast, .02), i*60));
  await sleep(1000);
  bIdxs.forEach(bi => glow(bi, .9));
  await sleep(200);

  // Three simultaneous chains → bank
  simNodes[bankI].visible = true;
  bIdxs.forEach((bi, i) => {
    const outcome = results[i]?.outcome || 'INVALID';
    const col = outcome==='SETTLED' ? PCOL.settled : outcome==='DUPLICATE_DROPPED' ? PCOL.duplicate : PCOL.invalid;
    setTimeout(() => {
      glow(bi, 1.0);
      spawnPacket(bi, bankI, col, .013 - i*.001, () => glow(bankI, 1 - i*.2));
    }, i * 220);
  });

  await sleep(1400);
}

// ══════════════════════════════════════════════════════════════
//  API
// ══════════════════════════════════════════════════════════════
async function api (path, opts={}) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...opts
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
function toast (msg, type='') {
  const tw = document.getElementById('toastWrap');
  const t  = document.createElement('div');
  t.className = `toast${type ? ' '+type : ''}`;
  t.textContent = msg;
  tw.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='.3s'; setTimeout(()=>t.remove(),320); }, 2500);
}

let prevBal  = {};
let knownTx  = new Set();
let volHist  = [];

function renderAccounts (list) {
  const el = document.getElementById('accountsList');
  el.innerHTML = '';
  list.forEach(acc => {
    const prev  = prevBal[acc.upi_id];
    const delta = prev !== undefined ? acc.balance - prev : 0;
    prevBal[acc.upi_id] = acc.balance;
    const row = document.createElement('div');
    row.className = 'acc-row';
    if (delta > 0) { row.classList.add('up');   setTimeout(()=>row.classList.remove('up'),  1000); }
    if (delta < 0) { row.classList.add('down'); setTimeout(()=>row.classList.remove('down'),1000); }
    row.innerHTML = `
      <div class="acc-l">
        <div class="acc-av">${acc.name[0]}</div>
        <div>
          <div class="acc-upi">${acc.upi_id}</div>
          <div class="acc-name">${acc.name}</div>
        </div>
      </div>
      <div class="acc-bal${delta<0?' red':''}"
        >₹${acc.balance.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
    `;
    el.appendChild(row);
  });
}

function renderStats (s) {
  document.getElementById('stSettled').textContent  = s.settled;
  document.getElementById('stDupe').textContent     = s.duplicate_dropped;
  document.getElementById('stInvalid').textContent  = s.invalid;
  document.getElementById('stVol').textContent      = `₹${s.total_volume.toLocaleString('en-IN')}`;
  document.getElementById('hKpis0').textContent     = `₹${s.total_volume.toLocaleString('en-IN')}`;
  document.getElementById('hKpis1').textContent     = s.settled;
  document.getElementById('hKpis2').textContent     = s.duplicate_dropped;
  document.getElementById('hKpis3').textContent     = s.invalid;
  const tot = s.total || 1;
  document.getElementById('barSettled').style.width = (s.settled/tot*100)+'%';
  document.getElementById('barDupe').style.width    = (s.duplicate_dropped/tot*100)+'%';
  document.getElementById('barInvalid').style.width = (s.invalid/tot*100)+'%';
  const upd = document.getElementById('updBadge');
  upd.classList.add('show');
  setTimeout(()=>upd.classList.remove('show'), 1800);
}

function renderFeed (txns) {
  const feed = document.getElementById('feed');
  if (!txns.length) { if (!knownTx.size) feed.innerHTML='<div class="feed-empty">No transactions yet</div>'; return; }
  const fresh = txns.filter(t=>!knownTx.has(t.id));
  if (!fresh.length && feed.querySelector('.feed-item')) return;
  if (feed.querySelector('.feed-empty')) feed.innerHTML='';
  fresh.forEach(tx => {
    knownTx.add(tx.id);
    const cls   = tx.outcome==='SETTLED'?'settled':tx.outcome==='DUPLICATE_DROPPED'?'duplicate':'invalid';
    const label = tx.outcome==='DUPLICATE_DROPPED'?'DUPLICATE':tx.outcome;
    const body  = tx.outcome==='SETTLED'
      ? `${tx.sender_upi} → ${tx.receiver_upi}  ·  ₹${tx.amount}`
      : tx.outcome==='DUPLICATE_DROPPED' ? `Dropped via ${tx.bridge_node||'bridge'}` : tx.reason||'Rejected';
    const time  = tx.settled_at
      ? new Date(tx.settled_at+' UTC').toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
      : '';
    const item = document.createElement('div');
    item.className = `feed-item ${cls}`;
    item.innerHTML = `<div class="fi">
      <div class="fi-top"><span class="fi-oc ${cls}">${label}</span><span class="fi-time">${time}</span></div>
      <div class="fi-body">${body}</div>
      ${tx.packet_hash?`<div class="fi-hash">${tx.packet_hash.slice(0,34)}…</div>`:''}
    </div>`;
    feed.insertBefore(item, feed.firstChild);
  });
  while(feed.children.length>40) feed.removeChild(feed.lastChild);
}

async function refreshAll () {
  try {
    const [a,t,s] = await Promise.all([api('/api/accounts'), api('/api/transactions?limit=40'), api('/api/stats')]);
    renderAccounts(a.accounts);
    renderFeed(t.transactions);
    renderStats(s);
  } catch { /* silent */ }
}

// ══════════════════════════════════════════════════════════════
//  CONTROLS
// ══════════════════════════════════════════════════════════════
const sendBtn  = document.getElementById('sendBtn');
const multiBtn = document.getElementById('multiBtn');
const resetBtn = document.getElementById('resetBtn');

function setBusy (on) {
  sendBtn.disabled  = on;
  multiBtn.disabled = on;
  sendBtn.innerHTML = on
    ? '<span style="opacity:.5">Encrypting…</span>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Broadcast via Mesh';
}

sendBtn.addEventListener('click', async () => {
  const sender   = document.getElementById('senderSel').value;
  const receiver = document.getElementById('receiverSel').value;
  const amount   = parseFloat(document.getElementById('amtInput').value);
  const hops     = document.getElementById('hopsInput').value ? parseInt(document.getElementById('hopsInput').value) : null;

  if (sender === receiver) { toast('Sender and receiver must differ', 'err'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'err'); return; }

  setBusy(true);
  document.getElementById('multiCard').style.display = 'none';

  try {
    const data = await api('/api/simulate', {
      method:'POST',
      body: JSON.stringify({ senderUpi:sender, receiverUpi:receiver, amount, numHops:hops }),
    });
    await animatePayment(data, data.outcome);
    await refreshAll();
    toast(
      data.outcome==='SETTLED' ? `✅ Settled ₹${data.amount} → ${data.receiverUpi}` :
      data.outcome==='DUPLICATE_DROPPED' ? '♻️ Duplicate dropped' : `❌ ${data.reason}`,
      data.outcome==='SETTLED'?'ok':data.outcome==='INVALID'?'err':''
    );
  } catch (e) {
    toast(`Error: ${e.message} — is the backend running?`, 'err');
    document.getElementById('meshIdle').style.display='flex';
  } finally { setBusy(false); }
});

multiBtn.addEventListener('click', async () => {
  const sender   = document.getElementById('senderSel').value;
  const receiver = document.getElementById('receiverSel').value;
  const amount   = parseFloat(document.getElementById('amtInput').value);

  if (sender === receiver) { toast('Sender and receiver must differ','err'); return; }

  setBusy(true);
  document.getElementById('multiCard').style.display = 'none';

  try {
    const data = await api('/api/simulate/multi', {
      method:'POST',
      body: JSON.stringify({ senderUpi:sender, receiverUpi:receiver, amount, numBridges:3 }),
    });
    await animateMultiBridge(data);
    const mc = document.getElementById('multiCard');
    const mb = document.getElementById('multiBody');
    mc.style.display = 'flex';
    const s = data.summary;
    mb.innerHTML = data.results.map(r=>`
      <div class="mrow"><span style="color:var(--t2)">${r.bridgeNode}</span><span class="mo ${r.outcome}">${r.outcome}</span></div>
    `).join('')+`
      <div class="msum">
        <span style="color:var(--green)">✅ ${s.settled} settled</span>
        <span style="color:var(--amber)">♻️ ${s.duplicate_dropped} dropped</span>
        <span style="color:var(--red)">❌ ${s.invalid} invalid</span>
      </div>`;
    await refreshAll();
    toast('Multi-bridge dedup test complete');
  } catch(e) { toast(`Error: ${e.message}`,'err'); }
  finally { setBusy(false); }
});

resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset all balances and clear transactions?')) return;
  try {
    await api('/api/accounts/reset', {method:'POST'});
    knownTx.clear(); prevBal={}; volHist=[];
    document.getElementById('feed').innerHTML='<div class="feed-empty">Reset complete</div>';
    document.getElementById('meshIdle').style.display='flex';
    document.getElementById('outcomeBar').style.display='none';
    document.getElementById('hopRouteWrap').style.display='none';
    document.getElementById('multiCard').style.display='none';
    packets=[];
    await refreshAll();
    toast('Reset complete','ok');
  } catch(e){ toast(`Error: ${e.message}`,'err'); }
});

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════
(async()=>{
  resizeSim();
  window.addEventListener('resize', ()=>{ resizeSim(); });
  startLoop();

  // Backend status
  try {
    await api('/');
    document.getElementById('backendDot').className='chip-dot ok';
    document.getElementById('backendLabel').textContent='Backend online';
  } catch {
    document.getElementById('backendDot').className='chip-dot err';
    document.getElementById('backendLabel').textContent='Backend offline';
  }

  await refreshAll();
  setInterval(refreshAll, 4000);
})();