"""
crypto.py — Hybrid RSA-2048 + AES-256-GCM encryption/decryption.

Flow:
  encrypt_packet(payload_dict) → base64 ciphertext string
  decrypt_packet(base64_str)   → payload_dict  (or raises ValueError)

Wire format (all base64-encoded, JSON-wrapped):
  {
    "enc_key":  base64(RSA-OAEP(aes_key)),      # 256 bytes
    "nonce":    base64(12-byte GCM nonce),
    "tag":      base64(16-byte GCM tag),
    "ct":       base64(AES-GCM ciphertext of JSON payload)
  }
"""

import base64
import json
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend


# ── Generate a demo RSA key-pair on import (in prod you'd load from disk/env) ──
_PRIVATE_KEY = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
    backend=default_backend(),
)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()


def encrypt_packet(payload: dict) -> str:
    """
    Encrypt a payment payload dict → base64 ciphertext string.
    Used by the simulator and the client-side demo tool.
    """
    plaintext = json.dumps(payload).encode()

    # 1. Random 256-bit AES key + 96-bit nonce
    aes_key = os.urandom(32)
    nonce   = os.urandom(12)

    # 2. AES-GCM encrypt
    aesgcm = AESGCM(aes_key)
    ct_with_tag = aesgcm.encrypt(nonce, plaintext, None)
    ct  = ct_with_tag[:-16]
    tag = ct_with_tag[-16:]

    # 3. RSA-OAEP wrap the AES key
    enc_key = _PUBLIC_KEY.encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    blob = {
        "enc_key": base64.b64encode(enc_key).decode(),
        "nonce":   base64.b64encode(nonce).decode(),
        "tag":     base64.b64encode(tag).decode(),
        "ct":      base64.b64encode(ct).decode(),
    }
    return base64.b64encode(json.dumps(blob).encode()).decode()


def decrypt_packet(ciphertext_b64: str) -> dict:
    """
    Decrypt a ciphertext string → payload dict.
    Raises ValueError on any tamper / auth failure.
    """
    try:
        blob = json.loads(base64.b64decode(ciphertext_b64))
        enc_key = base64.b64decode(blob["enc_key"])
        nonce   = base64.b64decode(blob["nonce"])
        tag     = base64.b64decode(blob["tag"])
        ct      = base64.b64decode(blob["ct"])
    except Exception as e:
        raise ValueError(f"Malformed ciphertext: {e}")

    # 1. RSA-OAEP unwrap
    try:
        aes_key = _PRIVATE_KEY.decrypt(
            enc_key,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
    except Exception:
        raise ValueError("RSA decryption failed — key mismatch or tampered enc_key")

    # 2. AES-GCM decrypt + authenticate
    aesgcm = AESGCM(aes_key)
    try:
        plaintext = aesgcm.decrypt(nonce, ct + tag, None)
    except Exception:
        raise ValueError("AES-GCM authentication failed — ciphertext tampered")

    return json.loads(plaintext)


def get_public_key_pem() -> str:
    """Return the public key as PEM string (for the /api/public-key endpoint)."""
    return _PUBLIC_KEY.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
