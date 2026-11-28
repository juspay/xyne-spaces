"""What this agent job should be recording, as decided by the backend.

Room metadata (`activeRecording`) only tells the agent *when* to ask: LiveKit could
forge it. The answer comes from POST /api/transcriptionAgent/:callId/recording-session,
which only the job that claimed the dispatch's call session can use, and which returns
the recording's chunk key sealed to this job's X25519 key. The key lives only in this
process's memory. Never log it.
"""
import asyncio
import base64
import re
from dataclasses import dataclass
from typing import Optional

import aiohttp
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from config.logging import get_logger
from infra.recording_crypto import KEY_LENGTH, completion_proof

logger = get_logger(__name__)

# Must match AGENT_RECORDING_SEAL_INFO in the backend's transcriptionAgentController.
_SEAL_INFO = b"xyne-agent-recording-key:v1"
# The backend's object layout for one recording; anything else is refused.
_PREFIX_PATTERN = re.compile(r"^recordings/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/$")


class RecordingSessionError(Exception):
    """The backend could not be asked, or its answer was unusable."""


@dataclass(frozen=True)
class ActiveRecording:
    recording_id: str
    # AUDIO_ONLY, or AUDIO_SCREEN / AUDIO_VIDEO (also record a composed video stream)
    recording_type: str
    # Recording start on the backend's clock (epoch ms): track offsets are measured from it.
    started_at_ms: int
    # Where this recording's objects go, e.g. "recordings/<call>/<recording>/".
    chunk_prefix: str
    chunk_key: bytes

    def __repr__(self) -> str:  # keep the key out of any accidental log line
        return f"ActiveRecording(recording_id={self.recording_id})"


def _unseal(private_key: X25519PrivateKey, sealed: dict, aad: bytes) -> bytes:
    peer = X25519PublicKey.from_public_bytes(base64.b64decode(sealed["ephemeralPublicKey"]))
    wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_SEAL_INFO).derive(private_key.exchange(peer))
    return AESGCM(wrap_key).decrypt(base64.b64decode(sealed["nonce"]), base64.b64decode(sealed["ciphertext"]), aad)


class RecordingSessionClient:
    """The agent's two recording calls to the backend, authenticated as this job."""

    def __init__(
        self,
        backend_url: str,
        api_key: str,
        call_id: str,
        dispatch_id: str,
        public_key_b64: str,
        private_key: X25519PrivateKey,
    ):
        self._base = f"{backend_url}/api/transcriptionAgent/{call_id}"
        self._headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        self._call_id = call_id
        self._identity = {"dispatchId": dispatch_id, "publicKey": public_key_b64}
        self._private_key = private_key

    async def fetch(self) -> Optional[ActiveRecording]:
        """The recording to make now, or None. Raises RecordingSessionError if unsure:
        the caller must then keep doing what it was doing, never guess."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self._base}/recording-session",
                    headers=self._headers,
                    json=self._identity,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    if response.status != 200:
                        raise RecordingSessionError(f"status={response.status}")
                    data = await response.json()
        except (asyncio.TimeoutError, aiohttp.ClientError) as e:
            raise RecordingSessionError(type(e).__name__) from None

        if not data.get("active"):
            return None
        try:
            recording_id = str(data["recordingId"])
            prefix = str(data["chunkPrefix"])
            if not _PREFIX_PATTERN.match(prefix) or f"/{recording_id}/" not in prefix:
                raise ValueError("unexpected chunk prefix")
            chunk_key = _unseal(
                self._private_key,
                data["sealedKey"],
                f"{self._call_id}|{recording_id}".encode("utf-8"),
            )
            if len(chunk_key) != KEY_LENGTH:
                raise ValueError("chunk key has the wrong length")
            return ActiveRecording(
                recording_id=recording_id,
                recording_type=str(data.get("recordingType") or "AUDIO_ONLY"),
                started_at_ms=int(data["startedAtMs"]),
                chunk_prefix=prefix,
                chunk_key=chunk_key,
            )
        except Exception as e:  # malformed answer or unseal failure
            raise RecordingSessionError(f"invalid recording session: {type(e).__name__}") from None

    async def complete(self, recording: ActiveRecording, session_id: str, attempts: int = 5) -> bool:
        """Report that every chunk of `session_id` is uploaded, so the backend stitches now
        rather than after its fallback delay. Best effort: the fallback still runs."""
        proof = base64.b64encode(completion_proof(recording.chunk_key, recording.recording_id, session_id)).decode("ascii")
        body = {**self._identity, "session": session_id, "proof": proof}
        url = f"{self._base}/recordings/{recording.recording_id}/complete"
        for attempt in range(attempts):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        url, headers=self._headers, json=body, timeout=aiohttp.ClientTimeout(total=10)
                    ) as response:
                        if response.status == 200:
                            return True
                        if 400 <= response.status < 500:
                            logger.warning(f"recording_complete_refused | status={response.status}")
                            return False
            except (asyncio.TimeoutError, aiohttp.ClientError):
                pass
            if attempt < attempts - 1:
                await asyncio.sleep(min(2 ** attempt, 8))
        logger.warning("recording_complete_unreachable | fallback_stitch_will_run")
        return False
