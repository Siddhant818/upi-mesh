# UPI Mesh — Offline Payment Network

> Offline UPI payments routed through a Bluetooth-style mesh network.  
> Python + FastAPI backend · Vanilla HTML/CSS/JS frontend · SQLite · Railway + Vercel deployment.

---

## What It Does

You're in a basement with zero connectivity. You send ₹500 to your friend.  
Your phone **encrypts the payment packet** and **broadcasts it to nearby phones**.  
The packet hops device-to-device until some phone walks outside, gets 4G,  
and **silently uploads it** to this backend. The backend decrypts, deduplicates, and settles.

```
[Sender Phone] → encrypt → [Mesh of untrusted relay phones] → [Bridge gets 4G] → POST /api/bridge/ingest → [Backend settles]
```

---

## Security Model

| Threat | Defence |
|---|---|
| Relay reads the payment | RSA-2048 + AES-256-GCM — only backend can decrypt |
| Relay tampers with amount | GCM authentication tag — any byte change = INVALID |
| Same packet delivered by 3 bridges | SHA-256 hash idempotency cache — settles exactly once |
| Old packet replayed hours later | `createdAt` freshness check — rejects packets > 5 min old |
| Arbitrary model injection | RSA key pair generated server-side — clients can't forge |

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Database | SQLite (built-in, zero setup) |
| Encryption | `cryptography` library — RSA-2048 + AES-256-GCM |
| Frontend | HTML5 + CSS3 + Vanilla JS |
| Backend deployment | Railway |
| Frontend deployment | Vercel |

---

## Project Structure

```
upi-mesh/
├── backend/
│   ├── app.py          ← FastAPI routes
│   ├── ingestion.py    ← Settlement logic (the core)
│   ├── crypto.py       ← RSA + AES-GCM encrypt/decrypt
│   ├── simulator.py    ← Mesh hop simulator
│   ├── database.py     ← SQLite setup + queries
│   ├── requirements.txt
│   ├── Procfile        ← Railway start command
│   └── railway.toml    ← Railway config
└── frontend/
    ├── index.html      ← Dashboard UI
    ├── style.css       ← Dark cyber theme
    ├── app.js          ← All frontend logic
    └── vercel.json     ← Vercel config
```

---

## Run Locally

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn app:app --reload --port 8000
```

Backend runs at: http://localhost:8000  
Auto-generated API docs: http://localhost:8000/docs

### Frontend

```bash
cd frontend

# Just open in browser — no build step needed
open index.html

# Or serve with Python
python -m http.server 3000
# Open http://localhost:3000
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/api/public-key` | RSA public key (PEM) |
| POST | `/api/bridge/ingest` | Raw packet ingestion from bridge node |
| POST | `/api/simulate` | Full end-to-end simulation |
| POST | `/api/simulate/multi` | Multi-bridge duplicate test |
| GET | `/api/accounts` | All account balances |
| GET | `/api/transactions` | Recent transactions (default 20) |
| GET | `/api/stats` | Aggregate stats |
| POST | `/api/accounts/reset` | Reset to demo defaults |

### POST /api/simulate

```json
{
  "senderUpi":   "alice@upi",
  "receiverUpi": "bob@upi",
  "amount":       500,
  "numHops":      4
}
```

Response:
```json
{
  "outcome":       "SETTLED",
  "packetHash":    "a3f8c9...",
  "transactionId": 1,
  "senderUpi":     "alice@upi",
  "receiverUpi":   "bob@upi",
  "amount":        500.0,
  "hops":          [...],
  "bridgeNode":    "phone-ananya-galaxy",
  "hopCount":      4
}
```

### POST /api/bridge/ingest

```
Headers:
  X-Bridge-Node-Id: phone-bridge-42
  X-Hop-Count: 3

Body:
{
  "packetId":  "550e8400-...",
  "ttl":        5,
  "createdAt":  1730000000000,
  "ciphertext": "base64-encoded-blob"
}
```

---

## Deploy to Railway (Backend)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select the repo → set **Root Directory** to `backend`
4. Railway auto-detects Python and uses `Procfile`
5. Copy the generated URL (e.g. `https://upi-mesh.railway.app`)

---

## Deploy to Vercel (Frontend)

1. Go to [vercel.com](https://vercel.com) → New Project → Import Git repo
2. Set **Root Directory** to `frontend`
3. Framework Preset: **Other** (no build command needed)
4. Deploy

**After deployment — update `API_BASE` in `frontend/app.js`:**

```js
const API_BASE = 'https://your-app.railway.app';  // ← your Railway URL
```

Then redeploy the frontend.

---

## Demo Accounts

| UPI ID | Name | Starting Balance |
|---|---|---|
| alice@upi | Alice | ₹2,000 |
| bob@upi | Bob | ₹1,500 |
| charlie@upi | Charlie | ₹3,000 |
| diana@upi | Diana | ₹500 |

---

## Known Limitations (By Design)

These are **not bugs** — they are inherent to any offline payment system:

1. **Double spending**: A sender with ₹500 can broadcast to two receivers offline. First packet to reach the backend wins; second is REJECTED. Real UPI Lite solves this with a pre-funded hardware wallet.

2. **Receiver can't verify funds offline**: The receiver sees "₹500 sent" — this is an IOU until the backend settles. If the sender's account is empty when the packet arrives, it's REJECTED.

---

## Author

Built as a demonstration of offline payment mesh networking concepts.  
Original Java/Spring Boot concept by [@perryvegehan](https://github.com/perryvegehan) — rebuilt in Python/FastAPI.
