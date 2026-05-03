"""
app.py — FastAPI entry point for UPI Offline Mesh backend.

Endpoints:
  GET  /                        Health check
  GET  /api/public-key          RSA public key (PEM) for clients
  POST /api/bridge/ingest       Raw packet ingestion (from bridge nodes)
  POST /api/simulate            Full end-to-end simulation (demo)
  POST /api/simulate/multi      Multi-bridge duplicate test
  GET  /api/accounts            All account balances
  GET  /api/transactions        Recent transactions
  GET  /api/stats               Aggregate stats
  POST /api/accounts/reset      Reset balances to demo defaults
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
import os

from database import init_db, get_all_accounts, get_recent_transactions, get_stats
from ingestion import ingest
from simulator import simulate_mesh_send, hops_to_dict
from crypto import get_public_key_pem


# ── Lifespan ────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="UPI Offline Mesh",
    description="Offline UPI payments via Bluetooth mesh network simulation",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS — allow the Vercel frontend + localhost ─────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Serve static frontend if present ───────────────────────
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/dashboard", include_in_schema=False)
    def serve_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ── Pydantic models ─────────────────────────────────────────
class IngestRequest(BaseModel):
    packetId:   str
    ttl:        int  = Field(default=5, ge=0)
    createdAt:  int  = Field(description="Epoch ms when packet was created")
    ciphertext: str

class SimulateRequest(BaseModel):
    senderUpi:   str
    receiverUpi: str
    amount:      float = Field(gt=0)
    numHops:     Optional[int] = Field(default=None, ge=1, le=8)

class MultiSimRequest(BaseModel):
    senderUpi:   str
    receiverUpi: str
    amount:      float = Field(gt=0)
    numBridges:  int   = Field(default=3, ge=2, le=6)


# ── Routes ───────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "service": "upi-offline-mesh", "time": int(time.time())}


@app.get("/api/public-key")
def public_key():
    return {"publicKeyPem": get_public_key_pem()}


@app.post("/api/bridge/ingest")
def bridge_ingest(
    body: IngestRequest,
    x_bridge_node_id: str = Header(default="unknown-bridge"),
    x_hop_count:      str = Header(default="0"),
):
    try:
        hop_count = int(x_hop_count)
    except ValueError:
        hop_count = 0

    result = ingest(
        ciphertext  = body.ciphertext,
        packet_id   = body.packetId,
        ttl         = body.ttl,
        created_at  = body.createdAt,
        bridge_node = x_bridge_node_id,
        hop_count   = hop_count,
    )
    return result


@app.post("/api/simulate")
def simulate(body: SimulateRequest):
    """
    Full simulation: encrypt → mesh hops → ingest → return result + hop log.
    """
    sim = simulate_mesh_send(
        sender_upi   = body.senderUpi,
        receiver_upi = body.receiverUpi,
        amount       = body.amount,
        num_hops     = body.numHops,
    )

    result = ingest(
        ciphertext  = sim.ciphertext,
        packet_id   = sim.packet_id,
        ttl         = 5,
        created_at  = int(time.time() * 1000),
        bridge_node = sim.bridge_node,
        hop_count   = sim.hop_count,
    )

    return {
        **result,
        "packetId":   sim.packet_id,
        "hops":       hops_to_dict(sim.hops),
        "bridgeNode": sim.bridge_node,
        "hopCount":   sim.hop_count,
    }


@app.post("/api/simulate/multi")
def simulate_multi(body: MultiSimRequest):
    """
    Simulate the same packet arriving via multiple bridge nodes simultaneously.
    Only the first should SETTLE; the rest should be DUPLICATE_DROPPED.
    """
    # Build the packet once
    sim = simulate_mesh_send(
        sender_upi   = body.senderUpi,
        receiver_upi = body.receiverUpi,
        amount       = body.amount,
        num_hops     = 3,
    )

    results = []
    for i in range(body.numBridges):
        bridge_id = f"bridge-{i+1}-of-{body.numBridges}"
        result = ingest(
            ciphertext  = sim.ciphertext,
            packet_id   = sim.packet_id,
            ttl         = 5,
            created_at  = int(time.time() * 1000),
            bridge_node = bridge_id,
            hop_count   = sim.hop_count,
        )
        results.append({**result, "bridgeNode": bridge_id})

    return {
        "packetId":    sim.packet_id,
        "numBridges":  body.numBridges,
        "results":     results,
        "summary": {
            "settled":          sum(1 for r in results if r["outcome"] == "SETTLED"),
            "duplicateDropped": sum(1 for r in results if r["outcome"] == "DUPLICATE_DROPPED"),
            "invalid":          sum(1 for r in results if r["outcome"] == "INVALID"),
        },
    }


@app.get("/api/accounts")
def accounts():
    return {"accounts": get_all_accounts()}


@app.get("/api/transactions")
def transactions(limit: int = 20):
    return {"transactions": get_recent_transactions(limit)}


@app.get("/api/stats")
def stats():
    return get_stats()


@app.post("/api/accounts/reset")
def reset_accounts():
    """Reset all balances to demo defaults."""
    from database import get_conn
    with get_conn() as conn:
        conn.executescript("""
            UPDATE accounts SET balance = 2000.00 WHERE upi_id = 'alice@upi';
            UPDATE accounts SET balance = 1500.00 WHERE upi_id = 'bob@upi';
            UPDATE accounts SET balance = 3000.00 WHERE upi_id = 'charlie@upi';
            UPDATE accounts SET balance  = 500.00 WHERE upi_id = 'diana@upi';
            DELETE FROM transactions;
            DELETE FROM idempotency_cache;
        """)
    return {"message": "Reset complete"}
