"""Encryption of call recordings the agent makes on end-to-end encrypted calls.

The key is the recording's storage key, which the backend gets from the encryption
service and hands over sealed to this job's X25519 key (see recording_session.py). Every
object the agent uploads is encrypted with it before it leaves memory, and carries the
key's wrapped form in its `enc-wdek` metadata, like any encrypted storage object.

Formats must match the backend (apps/backend/src/services/agentRecordingCrypto.ts):

    live object = version(1) | nonce(12) | AES-256-GCM ciphertext | tag(16)

with associated data that pins each object to its recording, agent session, track and
position, so the stitch worker rejects anything swapped, reordered or replayed.
"""
import hashlib
import hmac
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_LIVE_FORMAT_VERSION = 1
_NONCE_LENGTH = 12
KEY_LENGTH = 32


def chunk_aad(recording_id: str, session: str, track_index: int, seq: int) -> bytes:
    return f"xyne-rec-chunk:v1|{recording_id}|{session}|{track_index}|{seq}".encode("utf-8")


def video_chunk_aad(recording_id: str, session: str, track_index: int, seq: int) -> bytes:
    """A separate label from audio chunks: neither kind can be passed off as the other."""
    return f"xyne-rec-vchunk:v1|{recording_id}|{session}|{track_index}|{seq}".encode("utf-8")


def manifest_aad(recording_id: str, session: str) -> bytes:
    return f"xyne-rec-manifest:v1|{recording_id}|{session}".encode("utf-8")


def completion_proof(key: bytes, recording_id: str, session: str) -> bytes:
    """HMAC the backend checks before accepting "recording complete" from this job."""
    message = f"xyne-rec-complete:v1|{recording_id}|{session}".encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).digest()


def encrypt_live_object(key: bytes, aad: bytes, plaintext: bytes, nonce: bytes | None = None) -> bytes:
    """Encrypt one chunk or manifest. `nonce` is for test vectors only; leave it None."""
    if len(key) != KEY_LENGTH:
        raise ValueError("key must be 32 bytes")
    nonce = nonce if nonce is not None else os.urandom(_NONCE_LENGTH)
    if len(nonce) != _NONCE_LENGTH:
        raise ValueError("nonce must be 12 bytes")
    return bytes([_LIVE_FORMAT_VERSION]) + nonce + AESGCM(key).encrypt(nonce, plaintext, aad)


def decrypt_live_object(key: bytes, aad: bytes, blob: bytes) -> bytes:
    """Inverse of encrypt_live_object (tests and tooling; the agent never reads back)."""
    if len(blob) < 1 + _NONCE_LENGTH + 16 or blob[0] != _LIVE_FORMAT_VERSION:
        raise ValueError("not a live recording object")
    return AESGCM(key).decrypt(blob[1 : 1 + _NONCE_LENGTH], blob[1 + _NONCE_LENGTH :], aad)
