"""Audio recording of end-to-end encrypted calls, made by this agent.

LiveKit egress can't record an E2EE call: it never has the key. This agent does (it
decrypts every participant's audio for transcription), so when a recording is started
on such a call, the agent records the audio it already receives.

Nothing it records is ever stored in clear:

  * each participant's audio (one *segment* per subscription, split on long gaps) is
    encoded to an Ogg/Opus stream in memory, off the event loop;
  * every few seconds the bytes produced so far are encrypted with the recording's chunk
    key (recording_crypto.py) and uploaded as the segment's next numbered chunk;
  * an encrypted manifest records where each segment starts on the recording timeline.

After the recording stops, the backend's stitch worker decrypts and mixes the segments
into one encrypted file (apps/backend/src/services/callRecordingService.ts). Object
layout under the recording's prefix (`<session>` is this agent instance):

    <prefix><session>/manifest.bin
    <prefix><session>/t<index:03d>/<seq:08d>.bin

A screen or video recording also gets one composed video stream (call_video.py), cut
into chunks and encrypted the same way:

    <prefix><session>/v000/<seq:08d>.bin

The backend decides what to record (RecordingSessionClient); room metadata only prompts
the agent to ask. Note: when the host turns transcription off, the agent unsubscribes
from all audio, so the recording holds silence for that time.
"""
import asyncio
import concurrent.futures
import contextlib
import json
import secrets
import time
from dataclasses import dataclass
from fractions import Fraction
from typing import Dict, List, Optional, Set, Tuple

import av
import numpy as np
from livekit import rtc

from config import get_logger
from infra.recording_crypto import chunk_aad, encrypt_live_object, manifest_aad, video_chunk_aad
from infra.recording_session import ActiveRecording, RecordingSessionClient, RecordingSessionError
from infra.storage_base import StorageBucket
from modules.call_video import VideoCompositor, is_recorded_video, layout_for

logger = get_logger(__name__)

SAMPLE_RATE = 48000
OPUS_FRAME_SAMPLES = 960  # 20 ms
OPUS_BITRATE = 32000  # speech, mono
# PCM is handed to the encoder in ~1 s batches so encoding never runs per frame on the loop.
ENCODE_BATCH_SAMPLES = SAMPLE_RATE
# Encrypted chunks are cut this often (also bounds what a crash can lose).
FLUSH_INTERVAL_S = 5.0
# Shorter silences (a mute) are filled in; a longer one starts a new segment instead.
GAP_FILL_MIN_MS = 300
SEGMENT_SPLIT_GAP_MS = 60_000
# How often to re-check with the backend (metadata changes trigger an immediate check).
POLL_ACTIVE_S = 10.0
POLL_IDLE_S = 30.0
# Uploads waiting on a slow or failing bucket. Past this the recording stops capturing
# rather than grow without bound.
MAX_PENDING_UPLOAD_BYTES = 64 * 1024 * 1024
UPLOAD_RETRY_MAX_S = 30.0
# Finishing a recording: when it was stopped, and when the agent is leaving the call
# (cleanup has a 30 s budget in total).
FINISH_TIMEOUT_S = 120.0
FINISH_ON_LEAVE_TIMEOUT_S = 20.0
CONTENT_TYPE = "application/octet-stream"

_RECORDED_SOURCES = {rtc.TrackSource.SOURCE_MICROPHONE, rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO}

# libopus is fast, but a big room still shouldn't share the event loop with it.
_encode_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="rec-opus")


class _MemorySink:
    """Write-only file object for PyAV: collects the Ogg bytes the muxer produces."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def write(self, data) -> int:
        self._buf += data
        return len(data)

    def flush(self) -> None:
        pass

    def take(self) -> bytes:
        out = bytes(self._buf)
        self._buf.clear()
        return out


class OggOpusEncoder:
    """Mono 48 kHz int16 PCM in, one continuous Ogg/Opus byte stream out. Not thread-safe:
    every call must be serialised (each segment does, under its lock)."""

    def __init__(self) -> None:
        self._sink = _MemorySink()
        self._container = av.open(self._sink, mode="w", format="ogg")
        self._stream = self._container.add_stream("libopus", rate=SAMPLE_RATE)
        cc = self._stream.codec_context
        cc.layout = "mono"
        cc.format = "s16"
        cc.bit_rate = OPUS_BITRATE
        self._carry = np.zeros(0, dtype=np.int16)
        self._pts = 0
        self.closed = False

    def _encode_frame(self, samples: np.ndarray) -> None:
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = SAMPLE_RATE
        frame.pts = self._pts
        frame.time_base = Fraction(1, SAMPLE_RATE)
        self._pts += samples.shape[0]
        for packet in self._stream.encode(frame):
            self._container.mux(packet)

    def encode(self, pcm: np.ndarray) -> None:
        buf = np.concatenate([self._carry, pcm]) if self._carry.size else pcm
        whole = (buf.size // OPUS_FRAME_SAMPLES) * OPUS_FRAME_SAMPLES
        for start in range(0, whole, OPUS_FRAME_SAMPLES):
            self._encode_frame(buf[start : start + OPUS_FRAME_SAMPLES])
        self._carry = buf[whole:].copy()

    def take(self) -> bytes:
        """Ogg bytes produced since the last take (may be empty while the muxer buffers)."""
        return self._sink.take()

    def close(self) -> bytes:
        """Flush the encoder and end the stream; returns the remaining bytes."""
        if self.closed:
            return b""
        self.closed = True
        if self._carry.size:
            padded = np.zeros(OPUS_FRAME_SAMPLES, dtype=np.int16)
            padded[: self._carry.size] = self._carry
            self._encode_frame(padded)
        for packet in self._stream.encode(None):
            self._container.mux(packet)
        self._container.close()
        return self._sink.take()


class _Segment:
    """One participant audio track, from subscription until it ends or goes quiet for long.

    Its Ogg stream is cut into chunks in order: everything that touches the encoder or
    numbers a chunk runs under `_lock`, so chunk N+1 always holds the bytes after chunk N.
    """

    def __init__(self, run: "_RecordingRun", index: int, identity: str, source: int):
        self.run = run
        self.index = index
        self.identity = identity
        self.source = source
        self.offset_ms: Optional[int] = None  # set by the first frame
        self.capturing = True
        self._written_samples = 0  # handed to the encoder, silence fill included
        self._pending: List[np.ndarray] = []
        self._pending_samples = 0
        self._encoder: Optional[OggOpusEncoder] = None
        self._seq = 0
        self._lock = asyncio.Lock()
        self._task: Optional[asyncio.Task] = None

    def start(self, track: rtc.Track) -> None:
        self._task = asyncio.create_task(self._consume(track))

    async def _consume(self, track: rtc.Track) -> None:
        stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1)
        try:
            async for event in stream:
                if not self.capturing or not self.run.capturing:
                    break
                if not self._on_frame(event.frame):
                    # A long gap: this segment ends here and a new one carries on.
                    self.capturing = False
                    self.run.continue_in_new_segment(self, track, event.frame)
                    break
                if self._pending_samples >= ENCODE_BATCH_SAMPLES:
                    await self._encode(final=False)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error(f"recording_segment_stream_failed | segment={self.index}", exc_info=True)
        finally:
            with contextlib.suppress(Exception):
                await stream.aclose()
            self.run.segment_ended(self)

    def _on_frame(self, frame: rtc.AudioFrame) -> bool:
        """Buffer one frame (filling short silences). False if the gap before it is too long."""
        pcm = np.frombuffer(frame.data, dtype=np.int16).copy()
        frame_ms = pcm.size * 1000 / SAMPLE_RATE
        now_ms = time.time() * 1000 - self.run.recording.started_at_ms
        if self.offset_ms is None:
            self.offset_ms = max(0, int(now_ms - frame_ms))
        else:
            # Where this frame would start had audio been continuous, vs where it does.
            buffered_ms = (self._written_samples + self._pending_samples) * 1000 / SAMPLE_RATE
            gap_ms = (now_ms - frame_ms) - (self.offset_ms + buffered_ms)
            if gap_ms > SEGMENT_SPLIT_GAP_MS:
                return False
            if gap_ms > GAP_FILL_MIN_MS:
                self._append(np.zeros(int(gap_ms * SAMPLE_RATE / 1000), dtype=np.int16))
        self._append(pcm)
        return True

    def _append(self, pcm: np.ndarray) -> None:
        self._pending.append(pcm)
        self._pending_samples += pcm.size

    async def _encode(self, final: bool) -> Optional[bytes]:
        """Encode the buffered PCM; with `final`, also end the stream. Returns new Ogg bytes."""
        loop = asyncio.get_running_loop()
        async with self._lock:
            if self._encoder is not None and self._encoder.closed:
                return None
            if self._pending:
                pcm = np.concatenate(self._pending)
                self._pending, self._pending_samples = [], 0
                if self._encoder is None:
                    self._encoder = await loop.run_in_executor(_encode_executor, OggOpusEncoder)
                await loop.run_in_executor(_encode_executor, self._encoder.encode, pcm)
                self._written_samples += pcm.size
            if self._encoder is None:
                return None
            data = await loop.run_in_executor(_encode_executor, self._encoder.close if final else self._encoder.take)
            if data:
                # Numbered and queued under the lock: chunks can't overtake each other.
                self.run.queue_chunk(self, self._seq, data)
                self._seq += 1
            return data

    async def flush(self) -> None:
        await self._encode(final=False)

    async def stop(self) -> None:
        """Stop capturing and write out the end of the stream."""
        self.capturing = False
        task = self._task
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
        await self._encode(final=True)


@dataclass
class _Upload:
    name: str
    blob: bytes


class _RecordingRun:
    """This agent instance's part of one recording."""

    def __init__(self, recording: ActiveRecording, bucket: StorageBucket, room: rtc.Room):
        self.recording = recording
        self.bucket = bucket
        self.room = room
        self.session_id = secrets.token_hex(8)
        self.capturing = True
        self._segments: Dict[Tuple[str, int], _Segment] = {}
        self._retired: Set[_Segment] = set()
        self._stopping: Set[asyncio.Task] = set()
        self._offsets: Dict[int, int] = {}
        self._manifest_dirty = False
        self._next_index = 0
        self._uploads: "asyncio.Queue[Optional[_Upload]]" = asyncio.Queue()
        self._pending_bytes = 0
        self._uploader: Optional[asyncio.Task] = None
        self._flusher: Optional[asyncio.Task] = None
        layout = layout_for(recording.recording_type)
        self.video: Optional[VideoCompositor] = VideoCompositor(layout, self._queue_video_chunk) if layout else None
        self._video_offset: Optional[int] = None
        # Video publications this run subscribed to (the agent joins audio-only); released at the end.
        self._subscribed_video: List[rtc.RemoteTrackPublication] = []

    @property
    def _base(self) -> str:
        return f"{self.recording.chunk_prefix}{self.session_id}/"

    def start(self) -> None:
        self._uploader = asyncio.create_task(self._upload_loop())
        self._flusher = asyncio.create_task(self._flush_loop())
        if self.video is not None:
            self.video.start(self.recording.started_at_ms)
        for participant in self.room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.track is not None:
                    self.on_track(publication.track, publication, participant)
                else:
                    self.on_published(publication, participant)
        logger.info(
            f"recording_started | recording_id={self.recording.recording_id}, session={self.session_id}, "
            f"video_layout={self.video.layout if self.video else None}"
        )

    # ── tracks ────────────────────────────────────────────────────────────────

    def on_published(self, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant) -> None:
        """A video this recording needs but the agent isn't subscribed to: subscribe."""
        if self.video is None or not self.capturing or _is_agent(participant) or not is_recorded_video(publication):
            return
        try:
            publication.set_subscribed(True)  # type: ignore[attr-defined]
            self._subscribed_video.append(publication)  # type: ignore[arg-type]
        except Exception as e:
            logger.warning(f"recording_video_subscribe_failed | participant_id={participant.identity}, error={e}")

    def _release_video(self) -> None:
        for publication in self._subscribed_video:
            with contextlib.suppress(Exception):
                publication.set_subscribed(False)
        self._subscribed_video.clear()

    def on_track(self, track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant) -> None:
        if not self.capturing:
            return
        if track.kind == rtc.TrackKind.KIND_VIDEO:
            if self.video is not None and is_recorded_video(publication) and not _is_agent(participant):
                self.video.add_track(
                    f"{participant.identity}:{int(publication.source)}",
                    track,
                    is_screen=publication.source == rtc.TrackSource.SOURCE_SCREENSHARE,
                )
            return
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        if publication.source not in _RECORDED_SOURCES or _is_agent(participant):
            return
        key = (participant.identity, int(publication.source))
        if key not in self._segments:
            self._open_segment(key).start(track)

    def _open_segment(self, key: Tuple[str, int]) -> _Segment:
        segment = _Segment(self, self._next_index, key[0], key[1])
        self._next_index += 1
        self._segments[key] = segment
        return segment

    def on_track_gone(self, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant) -> None:
        if publication.kind == rtc.TrackKind.KIND_VIDEO:
            if self.video is not None:
                self.video.remove_track(f"{participant.identity}:{int(publication.source)}")
            return
        segment = self._segments.get((participant.identity, int(publication.source)))
        if segment is not None:
            self._retire(segment)

    def continue_in_new_segment(self, segment: _Segment, track: rtc.Track, frame: rtc.AudioFrame) -> None:
        """Called from `segment`'s own stream after a long gap; it retires itself on exit."""
        key = (segment.identity, segment.source)
        if self._segments.get(key) is segment:
            del self._segments[key]
        if self.capturing:
            successor = self._open_segment(key)
            successor._on_frame(frame)
            successor.start(track)

    def segment_ended(self, segment: _Segment) -> None:
        self._retire(segment)

    def _retire(self, segment: _Segment) -> None:
        key = (segment.identity, segment.source)
        if self._segments.get(key) is segment:
            del self._segments[key]
        if segment in self._retired:
            return
        self._retired.add(segment)
        task = asyncio.create_task(segment.stop())
        self._stopping.add(task)
        task.add_done_callback(self._stopping.discard)

    # ── chunks and uploads ────────────────────────────────────────────────────

    def queue_chunk(self, segment: _Segment, seq: int, ogg: bytes) -> None:
        if segment.index not in self._offsets and segment.offset_ms is not None:
            self._offsets[segment.index] = segment.offset_ms
            self._manifest_dirty = True
        aad = chunk_aad(self.recording.recording_id, self.session_id, segment.index, seq)
        blob = encrypt_live_object(self.recording.chunk_key, aad, ogg)
        self._enqueue(_Upload(f"{self._base}t{segment.index:03d}/{seq:08d}.bin", blob))

    def _queue_video_chunk(self, seq: int, ts: bytes) -> None:
        if self._video_offset is None and self.video is not None and self.video.offset_ms is not None:
            self._video_offset = self.video.offset_ms
            self._manifest_dirty = True
        aad = video_chunk_aad(self.recording.recording_id, self.session_id, 0, seq)
        blob = encrypt_live_object(self.recording.chunk_key, aad, ts)
        self._enqueue(_Upload(f"{self._base}v000/{seq:08d}.bin", blob))

    def _queue_manifest(self) -> None:
        manifest = {
            "v": 1,
            "recordingId": self.recording.recording_id,
            "session": self.session_id,
            "tracks": [{"index": i, "offsetMs": ms} for i, ms in sorted(self._offsets.items())],
        }
        if self._video_offset is not None:
            manifest["video"] = [{"index": 0, "offsetMs": self._video_offset}]
        blob = encrypt_live_object(
            self.recording.chunk_key,
            manifest_aad(self.recording.recording_id, self.session_id),
            json.dumps(manifest, separators=(",", ":")).encode("utf-8"),
        )
        self._manifest_dirty = False
        self._enqueue(_Upload(f"{self._base}manifest.bin", blob))

    def _enqueue(self, upload: _Upload) -> None:
        self._pending_bytes += len(upload.blob)
        self._uploads.put_nowait(upload)
        if self._pending_bytes > MAX_PENDING_UPLOAD_BYTES and self.capturing:
            logger.error(f"recording_upload_backlog | pending_bytes={self._pending_bytes}, action=stop_capturing")
            self.capturing = False
            if self.video is not None:
                self.video.capturing = False

    async def _upload_loop(self) -> None:
        while True:
            upload = await self._uploads.get()
            if upload is None:
                return
            delay = 1.0
            while True:
                try:
                    await asyncio.to_thread(self.bucket.upload_bytes, upload.name, upload.blob, CONTENT_TYPE)
                    break
                except Exception as e:  # noqa: BLE001 — retried: a missing chunk truncates the track
                    logger.warning(f"recording_upload_retry | error={type(e).__name__}, retry_in_s={delay}")
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, UPLOAD_RETRY_MAX_S)
            self._pending_bytes -= len(upload.blob)

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            try:
                flushes = [s.flush() for s in list(self._segments.values())]
                if self.video is not None:
                    flushes.append(self.video.flush())
                await asyncio.gather(*flushes)
                if self._manifest_dirty:
                    self._queue_manifest()
            except Exception:
                logger.error("recording_flush_failed", exc_info=True)

    # ── end ───────────────────────────────────────────────────────────────────

    async def finish(self) -> None:
        """Stop capturing, write out every segment and the manifest, wait for the uploads."""
        self.capturing = False
        if self._flusher is not None:
            self._flusher.cancel()
            with contextlib.suppress(BaseException):
                await self._flusher
        for segment in list(self._segments.values()):
            self._retire(segment)
        while self._stopping:
            await asyncio.gather(*list(self._stopping), return_exceptions=True)
        if self.video is not None:
            try:
                await self.video.finish()
            finally:
                self._release_video()
        if self._offsets or self._video_offset is not None:
            self._queue_manifest()
        self._uploads.put_nowait(None)
        if self._uploader is not None:
            await self._uploader
        logger.info(
            f"recording_finished | recording_id={self.recording.recording_id}, session={self.session_id}, "
            f"segments={len(self._offsets)}, video_frames={self.video.frames_encoded if self.video else 0}"
        )

    def abort(self) -> None:
        """Give up on uploads still pending (the backend's fallback stitches what landed)."""
        self.capturing = False
        if self.video is not None:
            self.video.abort()
            self._release_video()
        for task in (self._flusher, self._uploader, *self._stopping):
            if task is not None and not task.done():
                task.cancel()

    def has_media(self) -> bool:
        return bool(self._offsets) or self._video_offset is not None


def _is_agent(participant: rtc.RemoteParticipant) -> bool:
    agent_kind = getattr(rtc.ParticipantKind, "PARTICIPANT_KIND_AGENT", None)
    kind = getattr(participant, "kind", None)
    return (agent_kind is not None and kind == agent_kind) or participant.identity.startswith("agent-")


class CallRecorder:
    """Keeps this agent's recording in step with the backend for one call."""

    def __init__(self, room: rtc.Room, client: RecordingSessionClient, bucket: Optional[StorageBucket]):
        self._room = room
        self._client = client
        self._bucket = bucket
        self._run: Optional[_RecordingRun] = None
        self._finished: Set[str] = set()
        self._lock = asyncio.Lock()
        self._poller: Optional[asyncio.Task] = None
        self._hints: Set[asyncio.Task] = set()
        self._closed = False

    def start(self) -> None:
        if self._bucket is None:
            logger.warning("call_recorder_disabled | reason=no_storage_bucket")
            return
        self._room.on("track_subscribed", self._on_track_subscribed)
        self._room.on("track_unsubscribed", self._on_track_unsubscribed)
        self._room.on("track_published", self._on_track_published)
        self._room.on("room_metadata_changed", self._on_metadata_changed)
        self._poller = asyncio.create_task(self._poll())
        logger.info("call_recorder_started")

    def _on_track_subscribed(self, track, publication, participant) -> None:
        if self._run is not None:
            self._run.on_track(track, publication, participant)

    def _on_track_published(self, publication, participant) -> None:
        if self._run is not None:
            self._run.on_published(publication, participant)

    def _on_track_unsubscribed(self, track, publication, participant) -> None:
        if self._run is not None:
            self._run.on_track_gone(publication, participant)

    def _on_metadata_changed(self, *_args) -> None:
        # A hint only (LiveKit could forge it): ask the backend what is really going on.
        if not self._closed:
            task = asyncio.create_task(self.refresh())
            self._hints.add(task)
            task.add_done_callback(self._hints.discard)

    async def _poll(self) -> None:
        while not self._closed:
            try:
                await self.refresh()
            except Exception:
                logger.error("recording_refresh_failed", exc_info=True)
            await asyncio.sleep(POLL_ACTIVE_S if self._run is not None else POLL_IDLE_S)

    async def refresh(self) -> None:
        async with self._lock:
            if self._closed:
                return
            try:
                active = await self._client.fetch()
            except RecordingSessionError as e:
                # Unsure: keep doing what we were doing.
                logger.warning(f"recording_session_check_failed | error={e}")
                return
            current = self._run
            if current is not None and (active is None or active.recording_id != current.recording.recording_id):
                self._run = None
                await self._finish(current, FINISH_TIMEOUT_S)
            if active is not None and self._run is None and active.recording_id not in self._finished:
                self._run = _RecordingRun(active, self._bucket, self._room)  # type: ignore[arg-type]
                self._run.start()

    async def _finish(self, run: _RecordingRun, timeout_s: float) -> None:
        self._finished.add(run.recording.recording_id)
        try:
            await asyncio.wait_for(run.finish(), timeout=timeout_s)
        except asyncio.TimeoutError:
            run.abort()
            logger.error("recording_finish_timeout | fallback_stitch_will_use_uploaded_chunks")
            return
        except Exception:
            run.abort()
            logger.error("recording_finish_failed", exc_info=True)
            return
        if run.has_media():
            await self._client.complete(run.recording, run.session_id)

    async def aclose(self) -> None:
        """The agent is leaving: finish the recording in progress (the backend then ends it)."""
        if self._closed:
            return
        self._closed = True
        if self._poller is not None:
            self._poller.cancel()
        for event, handler in (
            ("track_subscribed", self._on_track_subscribed),
            ("track_unsubscribed", self._on_track_unsubscribed),
            ("track_published", self._on_track_published),
            ("room_metadata_changed", self._on_metadata_changed),
        ):
            with contextlib.suppress(Exception):
                self._room.off(event, handler)
        async with self._lock:
            run, self._run = self._run, None
        if run is not None:
            await self._finish(run, FINISH_ON_LEAVE_TIMEOUT_S)
