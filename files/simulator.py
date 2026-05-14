"""
simulator.py — Software mesh-hop simulator.

Simulates a payment packet travelling through N random intermediate
'phone' nodes before a bridge node finally reaches the internet and
POSTs it to the backend.

Used by the /api/simulate endpoint so the demo can be run entirely
on a single machine without any real Bluetooth hardware.
"""

import hashlib
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from crypto import encrypt_packet


# ── Fake phone nodes in the mesh ───────────────────────────
MESH_NODES = [
    "phone-ananya-galaxy",
    "phone-rohan-pixel",
    "phone-priya-iphone",
    "phone-arjun-oneplus",
    "phone-meera-redmi",
    "phone-kartik-realme",
    "phone-sneha-samsung",
    "phone-varun-moto",
]


@dataclass
class HopLog:
    node_id:   str
    hop_index: int
    timestamp: float = field(default_factory=time.time)
    is_bridge: bool  = False


@dataclass
class SimulationResult:
    packet_id:   str
    sender_upi:  str
    receiver_upi: str
    amount:      float
    hops:        list
    bridge_node: str
    hop_count:   int
    ciphertext:  str
    packet_hash: str


def simulate_mesh_send(
    sender_upi: str,
    receiver_upi: str,
    amount: float,
    num_hops: Optional[int] = None,
) -> SimulationResult:
    """
    Build an encrypted payment packet and simulate it hopping through
    the mesh. Returns the SimulationResult which the API layer can
    then pass to the ingestion service.
    """
    if num_hops is None:
        num_hops = random.randint(2, 6)

    packet_id = str(uuid.uuid4())
    signed_at = int(time.time() * 1000)

    payload = {
        "packetId":    packet_id,
        "senderUpi":   sender_upi,
        "receiverUpi": receiver_upi,
        "amount":      amount,
        "nonce":       str(uuid.uuid4()),   # prevents replay even of same amount
        "signedAt":    signed_at,
    }

    ciphertext  = encrypt_packet(payload)
    packet_hash = hashlib.sha256(ciphertext.encode()).hexdigest()

    # Pick random intermediate nodes
    nodes   = random.sample(MESH_NODES, min(num_hops, len(MESH_NODES)))
    bridge  = nodes[-1]

    hops = []
    for i, node in enumerate(nodes):
        is_bridge = (i == len(nodes) - 1)
        hops.append(HopLog(
            node_id   = node,
            hop_index = i + 1,
            timestamp = time.time() + i * random.uniform(0.05, 0.3),
            is_bridge = is_bridge,
        ))

    return SimulationResult(
        packet_id    = packet_id,
        sender_upi   = sender_upi,
        receiver_upi = receiver_upi,
        amount       = amount,
        hops         = hops,
        bridge_node  = bridge,
        hop_count    = len(hops),
        ciphertext   = ciphertext,
        packet_hash  = packet_hash,
    )


def hops_to_dict(hops: list) -> list:
    return [
        {
            "nodeId":   h.node_id,
            "hopIndex": h.hop_index,
            "isBridge": h.is_bridge,
        }
        for h in hops
    ]
