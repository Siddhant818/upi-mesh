// ══════════════════════════════════════════════════════════
//  UPI Mesh — app.js
//  Handles: API communication, mesh canvas animation,
//           hop-chain visualiser, live feed, accounts panel
// ══════════════════════════════════════════════════════════

// ── CONFIG ─────────────────────────────────────────────────
// Change this to your Render URL after deployment
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'https://upi-mesh.onrender.com';

// ── STATE ──────────────────────────────────────────────────
let isLoading = false;

// ── ELEMENTS ───────────────────────────────────────────────
const sendBtn      = document.getElementById('sendBtn');
const multiBtn     = document.getElementById('multiBtn');
const resetBtn     = document.getElementById('resetBtn');
const senderSel    = document.getElementById('senderSelect');
const receiverSel  = document.getElementById('receiverSelect');
const amountInput  = document.getElementById('amountInput');
const hopsInput    = document.getElementById('hopsInput');
const hopChain     = document.getElementById('hopChain');
const meshIdle     = document.getElementById('meshIdle');
const resultBox    = document.getElementById('resultBox');
const rbOutcome    = document.getElementById('rbOutcome');
const rbDetails    = document.getElementById('rbDetails');
const feed         = document.getElementById('feed');
const multiCard    = document.getElementById('multiCard');
const multiResults = document.getElementById('multiResults');
const nsLabel      = document.getElementById('nsLabel');
const netStatus    = document.getElementById('netStatus');

// ══════════════════════════════════════════════════════════
//  CANVAS MESH BACKGROUND
// ══════════════════════════════════════════════════════════
const canvas = document.getElementById('meshCanvas');
const ctx    = canvas.getContext('2d');

const nodes = [];
const NUM_NODES  = 28;
const CONN_DIST  = 160;

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initNodes() {
  nodes.length = 0;
  for (let i = 0; i < NUM_NODES; i++) {
    nodes.push({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r:  Math.random() * 2 + 1.5,
    });
  }
}

function drawMesh() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Move nodes
  nodes.forEach(n => {
    n.x += n.vx; n.y += n.vy;
    if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
    if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
  });

  // Draw connections
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx   = nodes[i].x - nodes[j].x;
      const dy   = nodes[i].y - nodes[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < CONN_DIST) {
        const alpha = (1 - dist / CONN_DIST) * 0.35;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.strokeStyle = `rgba(0,229,160,${alpha})`;
        ctx.lineWidth   = 0.7;
        ctx.stroke();
      }
    }
  }

  // Draw nodes
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,229,160,0.5)';
    ctx.fill();
  });

  requestAnimationFrame(drawMesh);
}

resizeCanvas(); initNodes(); drawMesh();
window.addEventListener('resize', () => { resizeCanvas(); initNodes(); });

// ══════════════════════════════════════════════════════════
//  API HELPERS
// ══════════════════════════════════════════════════════════
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════
//  NETWORK STATUS + POLLING
// ══════════════════════════════════════════════════════════
async function checkStatus() {
  try {
    await api('/');
    nsLabel.textContent = 'Backend Online';
    netStatus.querySelector('.ns-dot').style.background = 'var(--green)';
    return true;
  } catch {
    nsLabel.textContent = 'Backend Offline';
    netStatus.querySelector('.ns-dot').style.background = 'var(--red)';
    return false;
  }
}

async function refreshAll() {
  await Promise.all([refreshAccounts(), refreshStats(), refreshFeed()]);
}

async function refreshAccounts() {
  try {
    const data = await api('/api/accounts');
    renderAccounts(data.accounts);
  } catch { /* silent */ }
}

async function refreshStats() {
  try {
    const s = await api('/api/stats');
    document.getElementById('stSettled').textContent = s.settled;
    document.getElementById('stDupe').textContent    = s.duplicate_dropped;
    document.getElementById('stInvalid').textContent = s.invalid;
    document.getElementById('stVol').textContent     = `₹${s.total_volume.toLocaleString('en-IN')}`;
    document.getElementById('hTotalVol').textContent = `₹${s.total_volume.toLocaleString('en-IN')}`;
    document.getElementById('hTotalTx').textContent  = s.settled;
  } catch { /* silent */ }
}

async function refreshFeed() {
  try {
    const data = await api('/api/transactions?limit=30');
    renderFeed(data.transactions);
  } catch { /* silent */ }
}

// ══════════════════════════════════════════════════════════
//  RENDER ACCOUNTS
// ══════════════════════════════════════════════════════════
let prevBalances = {};

function renderAccounts(accounts) {
  const list = document.getElementById('accountsList');
  list.innerHTML = '';
  accounts.forEach(acc => {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.id = `acc-${acc.upi_id}`;
    const prev = prevBalances[acc.upi_id];
    if (prev !== undefined && prev !== acc.balance) {
      setTimeout(() => { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 900); }, 100);
    }
    prevBalances[acc.upi_id] = acc.balance;
    const initials = acc.name[0].toUpperCase();
    row.innerHTML = `
      <div class="acc-left">
        <div class="acc-avatar">${initials}</div>
        <div>
          <div class="acc-upi">${acc.upi_id}</div>
          <div style="font-size:0.65rem;color:var(--text-3)">${acc.name}</div>
        </div>
      </div>
      <div class="acc-bal">₹${acc.balance.toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
    `;
    list.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════
//  RENDER FEED
// ══════════════════════════════════════════════════════════
let knownTxIds = new Set();

function renderFeed(txns) {
  if (!txns.length) {
    feed.innerHTML = '<div class="feed-empty">No transactions yet.<br/>Send a payment to see the live feed.</div>';
    return;
  }

  // Only prepend new ones
  const newTxns = txns.filter(t => !knownTxIds.has(t.id));
  if (!newTxns.length && feed.children.length > 0) return;

  if (feed.querySelector('.feed-empty')) feed.innerHTML = '';

  newTxns.forEach(tx => {
    knownTxIds.add(tx.id);
    const item = document.createElement('div');
    const cls  = tx.outcome === 'SETTLED' ? 'settled' : tx.outcome === 'DUPLICATE_DROPPED' ? 'duplicate' : 'invalid';
    const ocls = tx.outcome === 'SETTLED' ? 'settled' : tx.outcome === 'DUPLICATE_DROPPED' ? 'duplicate' : 'invalid';
    const label = tx.outcome === 'DUPLICATE_DROPPED' ? 'DUPLICATE' : tx.outcome;
    item.className = `feed-item ${cls}`;

    let body = '';
    if (tx.outcome === 'SETTLED') {
      body = `${tx.sender_upi} → ${tx.receiver_upi}  ₹${tx.amount}`;
    } else if (tx.outcome === 'DUPLICATE_DROPPED') {
      body = `Duplicate via ${tx.bridge_node || 'bridge'}`;
    } else {
      body = tx.reason || 'Unknown error';
    }

    const time = tx.settled_at
      ? new Date(tx.settled_at + ' UTC').toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      : '';

    item.innerHTML = `
      <div class="fi-top">
        <span class="fi-outcome ${ocls}">${label}</span>
        <span class="fi-time">${time}</span>
      </div>
      <div class="fi-body">${body}</div>
      <div class="fi-hash">${tx.packet_hash ? tx.packet_hash.slice(0,32) + '…' : ''}</div>
    `;
    feed.insertBefore(item, feed.firstChild);
  });

  // Cap at 40 items
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

// ══════════════════════════════════════════════════════════
//  MESH HOP VISUALISER
// ══════════════════════════════════════════════════════════
async function animateHops(hops, outcome, details) {
  meshIdle.style.display = 'none';
  hopChain.style.display = 'flex';
  hopChain.innerHTML     = '';
  resultBox.style.display = 'none';

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];

    // Connector
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'hop-connector' + (hop.isBridge ? ' active' : '');
      hopChain.appendChild(conn);
      await sleep(180);
    }

    const row  = document.createElement('div');
    row.className = 'hop-row';
    row.style.animationDelay = '0ms';

    const node = document.createElement('div');
    const isSender = i === 0;
    node.className = `hop-node${hop.isBridge ? ' bridge' : isSender ? ' sender' : ''}`;

    const badgeCls = hop.isBridge ? 'bridge-b' : isSender ? 'sender-b' : 'relay';
    const badgeLabel = hop.isBridge ? '4G BRIDGE' : isSender ? 'SENDER' : `HOP ${hop.hopIndex}`;
    const icon = hop.isBridge ? '📡' : isSender ? '📱' : '📲';

    node.innerHTML = `
      <span class="hop-icon">${icon}</span>
      <span class="hop-label">${hop.nodeId}</span>
      <span class="hop-badge ${badgeCls}">${badgeLabel}</span>
    `;

    row.appendChild(node);
    hopChain.appendChild(row);
    await sleep(300);
  }

  // Show result
  await sleep(400);
  const outcomeMap = { SETTLED: 'settled', DUPLICATE_DROPPED: 'duplicate', INVALID: 'invalid' };
  const colorMap   = { SETTLED: 'var(--green)', DUPLICATE_DROPPED: 'var(--amber)', INVALID: 'var(--red)' };
  const emojiMap   = { SETTLED: '✅', DUPLICATE_DROPPED: '♻️', INVALID: '❌' };

  resultBox.style.display = 'flex';
  resultBox.className     = `result-box ${outcomeMap[outcome] || ''}`;
  rbOutcome.textContent   = `${emojiMap[outcome] || ''} ${outcome}`;
  rbOutcome.style.color   = colorMap[outcome] || 'var(--text)';
  rbDetails.innerHTML     = details;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════
//  SEND PAYMENT
// ══════════════════════════════════════════════════════════
sendBtn.addEventListener('click', async () => {
  if (isLoading) return;

  const sender   = senderSel.value;
  const receiver = receiverSel.value;
  const amount   = parseFloat(amountInput.value);
  const hops     = hopsInput.value ? parseInt(hopsInput.value) : null;

  if (sender === receiver)          { alert('Sender and receiver must be different'); return; }
  if (!amount || amount <= 0)       { alert('Enter a valid amount'); return; }

  isLoading = true;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Broadcasting…';
  multiCard.style.display = 'none';

  try {
    const data = await api('/api/simulate', {
      method: 'POST',
      body: JSON.stringify({ senderUpi: sender, receiverUpi: receiver, amount, numHops: hops }),
    });

    const details = data.outcome === 'SETTLED'
      ? `${data.senderUpi} → ${data.receiverUpi}<br/>Amount: <b>₹${data.amount}</b><br/>TX ID: ${data.transactionId}<br/>Bridge: ${data.bridgeNode}<br/>Hops: ${data.hopCount}`
      : data.outcome === 'DUPLICATE_DROPPED'
      ? `Packet already settled<br/>Hash: ${data.packetHash?.slice(0,20)}…`
      : `Reason: ${data.reason || 'Unknown'}`;

    await animateHops(data.hops || [], data.outcome, details);
    await refreshAll();

  } catch (err) {
    alert(`Error: ${err.message}. Is the backend running?`);
    meshIdle.style.display = 'flex';
    hopChain.style.display = 'none';
  } finally {
    isLoading = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Broadcast via Mesh`;
  }
});

// ══════════════════════════════════════════════════════════
//  MULTI-BRIDGE TEST
// ══════════════════════════════════════════════════════════
multiBtn.addEventListener('click', async () => {
  if (isLoading) return;

  const sender   = senderSel.value;
  const receiver = receiverSel.value;
  const amount   = parseFloat(amountInput.value);

  if (sender === receiver) { alert('Sender and receiver must be different'); return; }

  isLoading = true;
  multiBtn.disabled = true;
  multiBtn.textContent = 'Testing…';

  try {
    const data = await api('/api/simulate/multi', {
      method: 'POST',
      body: JSON.stringify({ senderUpi: sender, receiverUpi: receiver, amount, numBridges: 3 }),
    });

    multiCard.style.display = 'flex';
    const s = data.summary;
    multiResults.innerHTML = `
      <div style="font-family:var(--mono);font-size:0.72rem;color:var(--text-2);margin-bottom:10px;">
        Same packet delivered by <b style="color:var(--text)">${data.numBridges} bridges</b> simultaneously.
        <br/>Expected: 1 SETTLED, ${data.numBridges - 1} DUPLICATE_DROPPED.
      </div>
      <div class="multi-grid">
        ${data.results.map(r => `
          <div class="multi-row">
            <span style="color:var(--text-2)">${r.bridgeNode}</span>
            <span class="multi-outcome ${r.outcome}">${r.outcome}</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:10px;padding:10px;border-radius:7px;background:var(--bg3);border:1px solid var(--border);font-family:var(--mono);font-size:0.72rem;">
        ✅ Settled: <b style="color:var(--green)">${s.settled}</b> &nbsp;
        ♻️ Dropped: <b style="color:var(--amber)">${s.duplicate_dropped}</b> &nbsp;
        ❌ Invalid: <b style="color:var(--red)">${s.invalid}</b>
      </div>
    `;

    await refreshAll();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    isLoading = false;
    multiBtn.disabled = false;
    multiBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Test Duplicate Delivery (3 bridges)`;
  }
});

// ══════════════════════════════════════════════════════════
//  RESET
// ══════════════════════════════════════════════════════════
resetBtn.addEventListener('click', async () => {
  if (!confirm('Reset all balances and clear all transactions?')) return;
  try {
    await api('/api/accounts/reset', { method: 'POST' });
    knownTxIds.clear();
    prevBalances = {};
    feed.innerHTML = '<div class="feed-empty">Reset complete. Send a payment to begin.</div>';
    meshIdle.style.display = 'flex';
    hopChain.style.display = 'none';
    resultBox.style.display = 'none';
    multiCard.style.display = 'none';
    await refreshAll();
  } catch (err) { alert(`Error: ${err.message}`); }
});

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
(async () => {
  const online = await checkStatus();
  if (online) {
    await refreshAll();
    // Poll every 5 seconds
    setInterval(refreshAll, 5000);
  }
})();
