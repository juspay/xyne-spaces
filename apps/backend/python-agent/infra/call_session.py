"""Call session fetch: the backend's go-ahead and E2EE key for one agent job.

LiveKit hands the agent a job, but the key never travels through LiveKit. Before
joining, the job asks the backend (POST /api/transcriptionAgent/:callId/session)
and only joins once the backend answers. The call key comes back sealed to a
one-time X25519 key generated for this job, and lives only in this process's
memory. Never log it.
"""
import asyncio
import base64
from dataclasses import dataclass
from typing import Optional

import aiohttp
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from livekit import rtc

from config.logging import get_logger

logger = get_logger(__name__)

# Must match AGENT_SEAL_INFO in the backend's callEncryptionService.
_SEAL_INFO = b"xyne-agent-call-key:v1"
_MAX_ATTEMPTS = 4


class CallSessionError(Exception):
    """The backend did not give this job a usable session; the agent must not join."""


@dataclass(frozen=True)
class CallSession:
    # The call key as the clients receive it (base64 text), or None for an unencrypted call.
    call_key: Optional[str]

    def __repr__(self) -> str:  # keep the key out of any accidental log line
        return f"CallSession(encrypted={self.call_key is not None})"

    def encryption_options(self) -> Optional[rtc.E2EEOptions]:
        if self.call_key is None:
            return None
        # Same derivation as the web/mobile clients: the key *string* through PBKDF2
        # with LiveKit's default salt, no ratcheting.
        return rtc.E2EEOptions(
            key_provider_options=rtc.KeyProviderOptions(
                shared_key=self.call_key.encode("utf-8"),
                ratchet_window_size=0,
            )
        )


def _unseal(room_name: str, private_key: X25519PrivateKey, sealed: dict) -> str:
    peer = X25519PublicKey.from_public_bytes(base64.b64decode(sealed["ephemeralPublicKey"]))
    shared = private_key.exchange(peer)
    wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_SEAL_INFO).derive(shared)
    plaintext = AESGCM(wrap_key).decrypt(
        base64.b64decode(sealed["nonce"]),
        base64.b64decode(sealed["ciphertext"]),
        room_name.encode("utf-8"),
    )
    return plaintext.decode("utf-8")


async def fetch_call_session(backend_url: str, api_key: str, room_name: str) -> CallSession:
    """Raises CallSessionError if the backend refuses or can't be reached."""
    if not backend_url or not api_key:
        raise CallSessionError("backend URL or API key not configured")

    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    url = f"{backend_url}/api/transcriptionAgent/{room_name}/session"
    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    body = {"publicKey": base64.b64encode(public_key).decode("ascii")}

    last_error = "no attempt"
    for attempt in range(_MAX_ATTEMPTS):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        if not data.get("encrypted"):
                            return CallSession(call_key=None)
                        return CallSession(call_key=_unseal(room_name, private_key, data["sealedKey"]))
                    last_error = f"status={response.status}"
                    if 400 <= response.status < 500:
                        break  # refused: retrying won't change the answer
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            last_error = type(e).__name__
        except Exception as e:  # malformed response or unseal failure
            raise CallSessionError(f"invalid session response: {type(e).__name__}") from None

        if attempt < _MAX_ATTEMPTS - 1:
            await asyncio.sleep(2 ** attempt)

    raise CallSessionError(last_error)
