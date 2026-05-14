"""
ingestion.py — BridgeIngestionService

Receives an encrypted packet, decrypts it, validates it, deduplicates
it, and settles (or rejects) it against the accounts table.

Outcomes:
  SETTLED           — payment processed, balances updated
  DUPLICATE_DROPPED — same packet seen before (idempotency cache hit)
  INVALID           — bad crypto, stale TTL, unknown UPI, or insufficient funds
"""

import hashlib
import time

import sqlite3
from database import get_conn
from crypto import decrypt_packet

# Packets older than this are rejected (milliseconds)
MAX_AGE_MS = 5 * 60 * 1000   # 5 minutes


def ingest(
    ciphertext:  str,
    packet_id:   str,
    ttl:         int,
    created_at:  int,    # epoch ms from sender
    bridge_node: str,
    hop_count:   int,
) -> dict:
    """
    Main ingestion entry point. Returns a result dict with keys:
      outcome, packetHash, transactionId (if SETTLED), reason (if INVALID)
    """

    # 1. Hash the raw ciphertext for idempotency
    packet_hash = hashlib.sha256(ciphertext.encode()).hexdigest()

    # 2. TTL check
    if ttl <= 0:
        return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                               "TTL exhausted")

    # 3. Freshness check (replay guard)
    age_ms = int(time.time() * 1000) - created_at
    if age_ms > MAX_AGE_MS:
        return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                               f"Packet too old ({age_ms // 1000}s)")

    # 4. Idempotency cache — same hash = duplicate delivery
    with get_conn() as conn:
        hit = conn.execute(
            "SELECT 1 FROM idempotency_cache WHERE packet_hash=?", (packet_hash,)
        ).fetchone()

    if hit:
        _save_transaction(
            packet_id, packet_hash, "", "", 0,
            "DUPLICATE_DROPPED", None, bridge_node, hop_count,
        )
        return {"outcome": "DUPLICATE_DROPPED", "packetHash": packet_hash,
                "transactionId": None, "reason": None}

    # 5. Decrypt
    try:
        payload = decrypt_packet(ciphertext)
    except ValueError as e:
        return _record_invalid(packet_id, packet_hash, bridge_node, hop_count, str(e))

    sender_upi   = payload.get("senderUpi")
    receiver_upi = payload.get("receiverUpi")
    amount       = payload.get("amount")

    if not all([sender_upi, receiver_upi, amount]):
        return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                               "Missing fields in payload")

    try:
        amount = float(amount)
        if amount <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                               "Invalid amount")

    # 6. Settle atomically
    with get_conn() as conn:
        sender = conn.execute(
            "SELECT balance FROM accounts WHERE upi_id=?", (sender_upi,)
        ).fetchone()
        receiver = conn.execute(
            "SELECT balance FROM accounts WHERE upi_id=?", (receiver_upi,)
        ).fetchone()

        if not sender:
            return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                                   f"Sender not found: {sender_upi}")
        if not receiver:
            return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                                   f"Receiver not found: {receiver_upi}")

        if sender["balance"] < amount:
            return _record_invalid(packet_id, packet_hash, bridge_node, hop_count,
                                   f"Insufficient funds (has ₹{sender['balance']:.2f}, needs ₹{amount:.2f})")

        # Debit sender, credit receiver
        conn.execute(
            "UPDATE accounts SET balance = balance - ? WHERE upi_id=?",
            (amount, sender_upi),
        )
        conn.execute(
            "UPDATE accounts SET balance = balance + ? WHERE upi_id=?",
            (amount, receiver_upi),
        )

        # Mark as seen
        conn.execute(
            "INSERT OR IGNORE INTO idempotency_cache (packet_hash) VALUES (?)",
            (packet_hash,),
        )

        tx_id = _save_transaction(
            packet_id, packet_hash, sender_upi, receiver_upi, amount,
            "SETTLED", None, bridge_node, hop_count, conn=conn,
        )

    return {
        "outcome":       "SETTLED",
        "packetHash":    packet_hash,
        "transactionId": tx_id,
        "reason":        None,
        "senderUpi":     sender_upi,
        "receiverUpi":   receiver_upi,
        "amount":        amount,
    }


# ── Helpers ─────────────────────────────────────────────────

def _record_invalid(packet_id, packet_hash, bridge_node, hop_count, reason):
    _save_transaction(
        packet_id, packet_hash, "", "", 0,
        "INVALID", reason, bridge_node, hop_count,
    )
    return {"outcome": "INVALID", "packetHash": packet_hash,
            "transactionId": None, "reason": reason}


def _save_transaction(
    packet_id, packet_hash, sender_upi, receiver_upi, amount,
    outcome, reason, bridge_node, hop_count, conn=None,
):
    def _insert(c):
        cur = c.execute(
            """INSERT OR IGNORE INTO transactions
               (packet_id, packet_hash, sender_upi, receiver_upi,
                amount, outcome, reason, bridge_node, hop_count)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (packet_id, packet_hash, sender_upi, receiver_upi,
             amount, outcome, reason, bridge_node, hop_count),
        )
        return cur.lastrowid

    if conn:
        return _insert(conn)
    with get_conn() as c:
        return _insert(c)
