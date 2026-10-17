"""
STT evaluation - a second ("shadow") STT run in parallel with the one people see, and
both transcripts sent to NeuroLink so the two can be compared.

When a call's room metadata carries `sttShadowModel`, every speaking participant is also
transcribed by that STT on the same audio. Its text is never published to the room; it is
collected next to the visible STT's transcript and posted to the NeuroLink eval endpoint.

Data: each segment carries the transcript text, the participant's identity and display name,
and timings. It goes to the NeuroLink deployment that transcribes the call audio when NeuroLink
is the STT (NEUROLINK_STT_URL, or a flag URL whose host is in NEUROLINK_STT_ALLOWED_HOSTS).

Endpoint: POST {NeuroLink base URL}{NEUROLINK_STT_EVAL_PATH}, bearer NEUROLINK_STT_TOKEN.

    {
      "call_id": str,
      "room": str,
      "batch": int,                 # 1, 2, ... per send attempt; a failed batch's segments are
                                    # resent in a later one, so a gap means a retry, not a loss
      "final": bool,                # true on the call's last batch, sent once at room cleanup
      "models": {"primary": str, "shadow": str},
      "segments": [{
        "id": str,                  # unique per segment; a resent segment keeps its id
        "source": "primary" | "shadow",
        "model": str,
        "participant_identity": str,
        "participant_name": str,
        "text": str,
        "language": str | null,
        "start_time": float | null, # epoch seconds, when the STT reports timings
        "end_time": float | null,
        "received_at": float        # epoch seconds the agent received the final text
      }]
    }

Segments are sent every EVAL_FLUSH_SECONDS while the call runs (backing off after a failure)
and once more, with `final: true`, when room cleanup drains the transcriber.
"""
import asyncio
import os
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Callable, List, Optional

import aiohttp

from livekit import rtc
from livekit.agents import stt, utils
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

from config import get_logger

logger = get_logger(__name__)

DEFAULT_EVAL_PATH = "/v1/evals/stt"
EVAL_FLUSH_SECONDS = 60.0
EVAL_MAX_BACKOFF_SECONDS = 600.0  # longest wait between periodic sends while they keep failing
EVAL_REQUEST_TIMEOUT = 15.0
MAX_PENDING_SEGMENTS = 5000  # the endpoint's per-batch limit; oldest dropped beyond it


@dataclass
class EvalSegment:
    id: str
    source: str
    model: str
    participant_identity: str
    participant_name: str
    text: str
    language: Optional[str]
    start_time: Optional[float]
    end_time: Optional[float]
    received_at: float


class SttEvalCollector:
    """Buffers primary and shadow transcript segments for one call and posts them in batches."""

    def __init__(
        self,
        *,
        base_url: str,
        token: Optional[str],
        call_id: str,
        room_name: str,
        primary_model: str,
        shadow_model: str,
        http_session: Optional[aiohttp.ClientSession] = None,
    ):
        path = os.getenv("NEUROLINK_STT_EVAL_PATH") or DEFAULT_EVAL_PATH
        if base_url.startswith("ws"):
            base_url = "http" + base_url[len("ws"):]
        self._url = base_url.rstrip("/") + "/" + path.lstrip("/")
        self._token = token
        self._call_id = call_id
        self._room_name = room_name
        self._models = {"primary": primary_model, "shadow": shadow_model}
        self._session = http_session
        self._pending: List[EvalSegment] = []
        self._batch = 0
        self._failures = 0
        self._next_send_at = 0.0  # monotonic; periodic sends wait until then after a failure
        self._flush_task: Optional[asyncio.Task] = None
        self._final_sent = False

    @property
    def shadow_model(self) -> str:
        return self._models["shadow"]

    def start(self) -> None:
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._flush_periodically())

    def add(
        self,
        *,
        source: str,
        participant_identity: str,
        participant_name: str,
        text: str,
        language: Optional[str] = None,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
    ) -> None:
        text = (text or "").strip()
        if not text or self._final_sent:
            return
        self._pending.append(EvalSegment(
            id=str(uuid.uuid4()),
            source=source,
            model=self._models[source],
            participant_identity=participant_identity,
            participant_name=participant_name,
            text=text,
            language=language or None,
            start_time=start_time,
            end_time=end_time,
            received_at=time.time(),
        ))
        self._trim()

    def _trim(self) -> None:
        if len(self._pending) > MAX_PENDING_SEGMENTS:
            dropped = len(self._pending) - MAX_PENDING_SEGMENTS
            del self._pending[:dropped]
            logger.warning(f"stt_eval_segments_dropped | count={dropped}")

    async def flush(self, *, final: bool = False, timeout: float = EVAL_REQUEST_TIMEOUT) -> bool:
        """Send the pending segments; `final` marks the call's last batch and is sent once.

        The segments are taken out of the buffer before the request, so concurrent sends never
        overlap and adding is never blocked; a failed send puts them back in front.
        """
        if self._final_sent:
            return False
        if final:
            self._final_sent = True
        elif not self._pending or time.monotonic() < self._next_send_at:
            return False
        segments, self._pending = self._pending, []
        self._batch += 1
        batch = self._batch
        body = {
            "call_id": self._call_id,
            "room": self._room_name,
            "batch": batch,
            "final": final,
            "models": self._models,
            "segments": [asdict(s) for s in segments],
        }
        try:
            await self._post(body, timeout)
        except asyncio.CancelledError:
            self._requeue(segments)
            raise
        except Exception as e:
            self._requeue(segments)
            self._failures += 1
            backoff = min(EVAL_FLUSH_SECONDS * 2 ** (self._failures - 1), EVAL_MAX_BACKOFF_SECONDS)
            self._next_send_at = time.monotonic() + backoff
            logger.warning(
                f"stt_eval_batch_failed | batch={batch}, segments={len(segments)}, final={final}, "
                f"retry_in={backoff:.0f}s, error={e}"
            )
            return False
        self._failures = 0
        self._next_send_at = 0.0
        logger.info(f"stt_eval_batch_sent | batch={batch}, segments={len(segments)}, final={final}")
        return True

    def _requeue(self, segments: List[EvalSegment]) -> None:
        self._pending[:0] = segments
        self._trim()

    async def _post(self, body: dict, timeout: float) -> None:
        if self._session is None:
            # The job's shared HTTP session (closed by livekit-agents when the job ends)
            self._session = utils.http_context.http_session()
        headers = {"Authorization": f"Bearer {self._token}"} if self._token else {}
        async with self._session.post(
            self._url,
            json=body,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status >= 300:
                detail = (await resp.text())[:200]
                raise RuntimeError(f"HTTP {resp.status}: {detail}")

    async def _flush_periodically(self) -> None:
        while True:
            await asyncio.sleep(EVAL_FLUSH_SECONDS)
            await self.flush()

    async def aclose(self, timeout: float = EVAL_REQUEST_TIMEOUT) -> None:
        """Stop the periodic sends and send everything left as the final batch."""
        if self._flush_task is not None:
            await utils.aio.cancel_and_wait(self._flush_task)
            self._flush_task = None
        await self.flush(final=True, timeout=timeout)


class ShadowTranscriber:
    """Runs one STT over a participant's audio track and reports its finals; publishes nothing."""

    def __init__(
        self,
        *,
        stt_instance: stt.STT,
        track: rtc.Track,
        participant_identity: str,
        on_final: Callable[[str, Optional[str], Optional[float], Optional[float]], None],
    ):
        self._stt = stt_instance
        self._track = track
        self._identity = participant_identity
        self._on_final = on_final
        self._stream: Optional[stt.RecognizeStream] = None
        self._audio: Optional[rtc.AudioStream] = None
        self._pump_task: Optional[asyncio.Task] = None
        self._run_task: Optional[asyncio.Task] = None
        self._started_at = 0.0
        self._final_settled = asyncio.Event()  # cleared while the STT owes a final
        self._final_settled.set()

    def start(self) -> None:
        self._started_at = time.time()
        # ResilientSTT forwards conn_options as given, so pass the defaults explicitly
        self._stream = self._stt.stream(conn_options=DEFAULT_API_CONNECT_OPTIONS)
        self._audio = rtc.AudioStream.from_track(track=self._track, sample_rate=16000, num_channels=1)
        self._pump_task = asyncio.create_task(self._pump())
        self._run_task = asyncio.create_task(self._read_events())

    async def _pump(self) -> None:
        try:
            async for event in self._audio:
                self._stream.push_frame(event.frame)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"shadow_stt_audio_error | participant_id={self._identity}, error={e}")

    async def _read_events(self) -> None:
        try:
            async for event in self._stream:
                if not event.alternatives:
                    continue
                alt = event.alternatives[0]
                if event.type == stt.SpeechEventType.INTERIM_TRANSCRIPT and alt.text.strip():
                    self._final_settled.clear()
                if event.type != stt.SpeechEventType.FINAL_TRANSCRIPT:
                    continue
                self._final_settled.set()
                if not alt.text or not alt.text.strip():
                    continue
                # Timings are seconds from the stream start when the STT reports them
                start = self._started_at + alt.start_time if alt.start_time else None
                end = self._started_at + alt.end_time if alt.end_time else None
                self._on_final(alt.text, alt.language or None, start, end)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"shadow_stt_stream_error | participant_id={self._identity}, error={e}")

    async def aclose(self, timeout: float) -> None:
        """Stop feeding audio, wait up to `timeout` seconds for a final the STT still owes, close."""
        if self._pump_task is not None:
            await utils.aio.cancel_and_wait(self._pump_task)
        if self._audio is not None:
            await self._audio.aclose()
        if self._stream is None or self._run_task is None:
            return
        try:
            if timeout > 0 and not self._final_settled.is_set():
                await asyncio.wait_for(self._final_settled.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"shadow_stt_final_wait_timeout | participant_id={self._identity}")
        finally:
            await utils.aio.cancel_and_wait(self._run_task)
            await self._stream.aclose()


def find_microphone_track(participant: rtc.RemoteParticipant) -> Optional[rtc.Track]:
    for pub in participant.track_publications.values():
        if pub.kind == rtc.TrackKind.KIND_AUDIO and pub.source == rtc.TrackSource.SOURCE_MICROPHONE and pub.track:
            return pub.track
    for pub in participant.track_publications.values():
        if pub.kind == rtc.TrackKind.KIND_AUDIO and pub.track:
            return pub.track
    return None
