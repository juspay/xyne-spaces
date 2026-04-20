"""
Real-time speaker identification via WeSpeaker embeddings.

For each participant's audio track, runs a parallel VAD loop that:
  1. Buffers frames between START_OF_SPEECH / END_OF_SPEECH.
  2. Converts buffered PCM to a 256-dim WeSpeaker embedding (in a thread).
  3. Cosine-matches the embedding against enrolled voiceprints.
  4. Caches the identified name for the next transcript turn lookup.

Since LiveKit delivers separate per-participant audio tracks, the full
pyannote diarization pipeline (which separates mixed audio) is not needed.
This module only answers "who is this person?" using the already-separated track.
"""
import asyncio
import os
from typing import Dict, List, Optional

import numpy as np
from livekit import rtc
from livekit.agents import vad as agents_vad
from livekit.plugins import silero

from config import get_logger

logger = get_logger(__name__)

# Cosine-similarity threshold for a confident speaker match.
# Both enrollment and identification use L2-normalised unit vectors so
# dot product == cosine similarity.
THRESHOLD = 0.4

# Minimum speech duration (seconds) to attempt embedding.
# Very short turns produce noisy embeddings that cause false matches.
MIN_SPEECH_SECS = 1.0

# How long to wait for same-turn embedding before falling back to cached identity.
# Increase for slow hardware / cold-start scenarios (e.g. SPEAKER_ID_TIMEOUT_SECS=5.0).
IDENTIFICATION_TIMEOUT_SECS = float(os.getenv("SPEAKER_ID_TIMEOUT_SECS", "2.0"))


class RealtimeIdentifier:
    """
    Identifies speakers in real-time by matching VAD speech turns against
    enrolled voice signatures (pre-computed WeSpeaker embeddings).

    One ``process_track()`` coroutine is launched per participant when their
    audio track arrives. It runs independently of the AgentSession STT loop,
    updating the identity cache each time a turn is confidently matched.
    """

    def __init__(self, voiceprints: List[dict]):
        """
        Args:
            voiceprints: list of {userId, name, embedding: list[float]}
                         Embeddings should be 256-dim float32 arrays.
        """
        self._voiceprints: List[dict] = []
        for vp in voiceprints:
            # Embeddings arrive as base64-encoded 1024-byte float32 LE buffers
            # (same encoding used in the DB / diarizationService.ts)
            import base64
            raw = base64.b64decode(vp["embeddingB64"])
            raw_arr = np.frombuffer(raw, dtype=np.float32).copy()  # (256,)
            norm = np.linalg.norm(raw_arr)
            emb = raw_arr / norm if norm > 1e-9 else raw_arr
            self._voiceprints.append({
                "userId": vp["userId"],
                "name": vp["name"],
                "embedding": emb,
            })

        # participant_identity → most recently identified real name
        self._identities: Dict[str, str] = {}
        # participant_identity → the running _identify_turn task for the latest turn
        self._pending: Dict[str, asyncio.Task] = {}

        logger.info(
            f"realtime_identifier_initialized | voiceprints={len(self._voiceprints)}"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_speaker(self, participant_identity: str) -> Optional[str]:
        """Return the last identified real name for this participant, or None."""
        return self._identities.get(participant_identity)

    def cancel_participant(self, participant_identity: str) -> None:
        """
        Cancel any in-flight identification task for a participant and remove
        their cached state.  Call this when a participant's track is unsubscribed
        or the participant disconnects to avoid task leaks.
        """
        task = self._pending.pop(participant_identity, None)
        if task is not None and not task.done():
            task.cancel()
        self._identities.pop(participant_identity, None)
        logger.debug(f"realtime_id_participant_cancelled | participant_id={participant_identity}")

    async def wait_for_identification(self, participant_identity: str, timeout: float = IDENTIFICATION_TIMEOUT_SECS) -> Optional[str]:
        """
        Await the latest pending identification task for a participant.
        Returns the identified name (or None if unmatched/timed-out).
        Useful for tying a transcription to the same-turn embedding result.
        """
        task = self._pending.get(participant_identity)
        if task is not None and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        return self._identities.get(participant_identity)

    async def process_track(self, track: rtc.Track, participant_identity: str):
        """
        VAD + embedding loop for a single participant's audio track.

        Runs until the track ends or the coroutine is cancelled.
        Each END_OF_SPEECH event triggers an async identification task so
        the main loop is never blocked by model inference.
        """
        logger.info(
            f"realtime_id_track_started | participant_id={participant_identity}"
        )
        try:
            vad = silero.VAD.load(
                activation_threshold=0.5,
                min_speech_duration=0.1,
                min_silence_duration=0.5,
                prefix_padding_duration=0.3,
            )
            audio_stream = rtc.AudioStream(track)
            vad_stream = vad.stream()

            frames_buffer: List[rtc.AudioFrame] = []
            sample_rate: Optional[int] = None

            async def _feed_vad():
                nonlocal sample_rate
                async for frame_event in audio_stream:
                    frame = frame_event.frame
                    if sample_rate is None:
                        sample_rate = frame.sample_rate
                    frames_buffer.append(frame)
                    vad_stream.push_frame(frame)

            feed_task = asyncio.create_task(_feed_vad())

            async for event in vad_stream:
                if event.type == agents_vad.VADEventType.START_OF_SPEECH:
                    frames_buffer.clear()

                elif event.type == agents_vad.VADEventType.END_OF_SPEECH:
                    if not frames_buffer:
                        continue

                    speech_frames = list(frames_buffer)
                    frames_buffer.clear()

                    rate = sample_rate or 48000
                    total_secs = sum(
                        f.samples_per_channel / rate for f in speech_frames
                    )

                    if total_secs < MIN_SPEECH_SECS:
                        logger.debug(
                            f"realtime_id_turn_too_short | "
                            f"participant_id={participant_identity}, dur={total_secs:.2f}s"
                        )
                        continue

                    # Track the running task so wait_for_identification() can await it
                    task = asyncio.create_task(
                        self._identify_turn(speech_frames, rate, participant_identity)
                    )
                    self._pending[participant_identity] = task

            feed_task.cancel()
            try:
                await feed_task
            except asyncio.CancelledError:
                pass

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(
                f"realtime_id_error | participant_id={participant_identity}, error={e}",
                exc_info=True,
            )
        finally:
            logger.info(
                f"realtime_id_track_ended | participant_id={participant_identity}"
            )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _identify_turn(
        self,
        frames: List[rtc.AudioFrame],
        sample_rate: int,
        participant_identity: str,
    ):
        """Embed one speech turn and update the identity cache if matched."""
        if not self._voiceprints:
            return

        try:
            embedding, n_windows = await asyncio.to_thread(
                self._compute_embedding, frames, sample_rate
            )
        except Exception as e:
            logger.debug(
                f"realtime_id_embed_failed | participant_id={participant_identity}, error={e}"
            )
            return

        # Both stored and computed embeddings are L2-normalised unit vectors.
        # Dot product == cosine similarity — no division needed.
        best_sim = -1.0
        best_name: Optional[str] = None
        for vp in self._voiceprints:
            sim = float(np.dot(embedding, vp["embedding"]))
            if sim > best_sim:
                best_sim = sim
                best_name = vp["name"]

        logger.info(
            f"realtime_id_similarity | participant_id={participant_identity}, "
            f"best_name={best_name}, sim={best_sim:.3f}, threshold={THRESHOLD}"
        )
        if best_sim >= THRESHOLD and best_name:
            prev = self._identities.get(participant_identity)
            self._identities[participant_identity] = best_name
            if prev != best_name:
                logger.info(
                    f"realtime_id_speaker_identified | "
                    f"participant_id={participant_identity}, name={best_name}, "
                    f"sim={best_sim:.3f}, windows={n_windows}"
                )
        else:
            logger.debug(
                f"realtime_id_no_match | participant_id={participant_identity}, "
                f"best_sim={best_sim:.3f}, threshold={THRESHOLD}"
            )

    def _compute_embedding(
        self,
        frames: List[rtc.AudioFrame],
        sample_rate: int,
    ):
        """
        Convert AudioFrames → float32 torch waveform → WeSpeaker embedding.

        Runs inside ``asyncio.to_thread`` so model inference never blocks the
        async event loop.  Resamples from LiveKit's native 48 kHz to 16 kHz
        before handing off to compute_enrollment_embedding.
        """
        import torch
        import numpy as np

        chunks = []
        for frame in frames:
            pcm = np.frombuffer(bytes(frame.data), dtype=np.int16).astype(np.float32)
            # Mix down stereo/multi-channel to mono
            if frame.num_channels > 1:
                pcm = pcm.reshape(-1, frame.num_channels).mean(axis=1)
            chunks.append(pcm)

        audio_np = np.concatenate(chunks) / 32768.0

        if sample_rate != 16000:
            from math import gcd
            from scipy.signal import resample_poly
            g = gcd(16000, sample_rate)
            audio_np = resample_poly(audio_np, 16000 // g, sample_rate // g).astype(np.float32)

        waveform = torch.from_numpy(audio_np).unsqueeze(0)  # shape (1, N)

        from modules.speaker_embedding import compute_enrollment_embedding
        return compute_enrollment_embedding(waveform, 16000)
