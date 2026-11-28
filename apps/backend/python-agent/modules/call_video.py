"""Video for recordings of end-to-end encrypted calls, made by this agent.

Egress can't decode an E2EE call's video; this agent can (it holds the call key). For a
screen or video recording it subscribes to the participants' cameras and screen shares
and composes them, like egress's room composite, onto one canvas:

  * "speaker" (AUDIO_SCREEN, egress `speaker-dark`): the newest screen share in the main
    area with every camera in a strip on the right; with no share, the cameras in a grid;
  * "grid" (AUDIO_VIDEO, egress `grid-dark`): every screen share and camera in a grid.

The canvas is encoded at a constant CANVAS_FPS to H.264 in one continuous MPEG-TS stream
(libx264 ships inside PyAV's wheel). The stream's bytes are cut into chunks that the
recorder encrypts and uploads exactly like the audio (call_recorder.py); the backend's
stitch worker lays the stream on the recording timeline and muxes it with the audio.

Composition and encoding run on one dedicated thread, never on the event loop. If a tick
is still being encoded when the next is due, that tick is skipped: the stream keeps its
timing (frames carry wall-clock timestamps) and only its frame rate drops.
"""
import asyncio
import concurrent.futures
import contextlib
import math
import time
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import av
import numpy as np
from livekit import rtc

from config import get_logger

logger = get_logger(__name__)

# Must match AGENT_VIDEO_CANVAS in apps/backend/src/utils/ffmpeg.ts.
CANVAS_W = 1280
CANVAS_H = 720
CANVAS_FPS = 15
# A keyframe every 2 s: bounds what a lost chunk or a seek has to wait for.
GOP_FRAMES = CANVAS_FPS * 2
GRID_GAP = 8
# Speaker layout while a screen is shared: cameras in a 16:9 strip on the right.
STRIP_W = 256
STRIP_TILE_H = 144
STRIP_MAX_TILES = (CANVAS_H + GRID_GAP) // (STRIP_TILE_H + GRID_GAP)
# A source that sent nothing for this long (camera off, paused share) leaves the layout
# instead of freezing on its last frame.
STALE_AFTER_S = 2.0
# Black in limited-range YUV.
_Y_BLACK = 16
_C_NEUTRAL = 128

LAYOUT_SPEAKER = "speaker"
LAYOUT_GRID = "grid"

_RECORDED_VIDEO_SOURCES = {rtc.TrackSource.SOURCE_CAMERA, rtc.TrackSource.SOURCE_SCREENSHARE}

# One thread: the encoder is stateful and must see frames in order anyway.
_video_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="rec-video")


def layout_for(recording_type: str) -> Optional[str]:
    """The canvas layout a recording type needs, or None for an audio-only recording."""
    if recording_type == "AUDIO_SCREEN":
        return LAYOUT_SPEAKER
    if recording_type == "AUDIO_VIDEO":
        return LAYOUT_GRID
    return None


def is_recorded_video(publication: rtc.TrackPublication) -> bool:
    return publication.kind == rtc.TrackKind.KIND_VIDEO and publication.source in _RECORDED_VIDEO_SOURCES


# ── layout (pure, tested) ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


def _even(n: float) -> int:
    return max(2, int(n) // 2 * 2)


def grid_rects(n: int, width: int = CANVAS_W, height: int = CANVAS_H, gap: int = GRID_GAP) -> List[Rect]:
    """`n` equal tiles, row by row, the grid centred and a short last row centred too."""
    if n <= 0:
        return []
    if n == 1:
        return [Rect(0, 0, width, height)]
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    tile_w = _even((width - gap * (cols + 1)) / cols)
    tile_h = _even((height - gap * (rows + 1)) / rows)
    top = _even((height - rows * tile_h - (rows - 1) * gap) / 2) if rows > 1 else _even((height - tile_h) / 2)
    rects = []
    for i in range(n):
        row, col = divmod(i, cols)
        in_row = min(cols, n - row * cols)
        left = _even((width - in_row * tile_w - (in_row - 1) * gap) / 2)
        rects.append(Rect(left + col * (tile_w + gap), top + row * (tile_h + gap), tile_w, tile_h))
    return rects


def fit_rect(src_w: int, src_h: int, box: Rect) -> Rect:
    """The largest rect of the source's aspect ratio inside `box`, centred, even-sized."""
    scale = min(box.w / max(1, src_w), box.h / max(1, src_h))
    w = min(box.w, _even(src_w * scale))
    h = min(box.h, _even(src_h * scale))
    # Margins rounded down to even, so every rect stays on the chroma grid.
    return Rect(box.x + (box.w - w) // 4 * 2, box.y + (box.h - h) // 4 * 2, w, h)


def choose_sources(layout: str, sources: Sequence[Tuple[str, bool]]) -> List[str]:
    """Which sources (key, is_screen_share), in display order, the layout shows.
    Sources come in arrival order. The speaker layout shows the newest screen share
    (if any) first, then every camera; the grid shows everything."""
    screens = [key for key, is_screen in sources if is_screen]
    cameras = [key for key, is_screen in sources if not is_screen]
    if layout == LAYOUT_SPEAKER:
        return ([screens[-1]] if screens else []) + cameras
    return screens + cameras


def speaker_rects(n_cameras: int, width: int = CANVAS_W, height: int = CANVAS_H, gap: int = GRID_GAP) -> List[Rect]:
    """A screen share in the main area with the cameras stacked in a strip on the right.
    Returns the main rect first, then one rect per camera shown (at most STRIP_MAX_TILES)."""
    if n_cameras <= 0:
        return [Rect(0, 0, width, height)]
    shown = min(n_cameras, STRIP_MAX_TILES)
    tile_h = STRIP_TILE_H
    strip_x = width - STRIP_W
    top = _even((height - shown * tile_h - (shown - 1) * gap) / 2)
    main = Rect(0, 0, strip_x - gap, height)
    return [main] + [Rect(strip_x, top + i * (tile_h + gap), STRIP_W, tile_h) for i in range(shown)]


def layout_boxes(layout: str, sources: Sequence[Tuple[str, bool]]) -> List[Tuple[str, Rect]]:
    """Where each shown source is drawn: (key, box), in drawing order."""
    order = choose_sources(layout, sources)
    if layout == LAYOUT_SPEAKER and any(is_screen for _, is_screen in sources):
        rects = speaker_rects(len(order) - 1)
    else:
        rects = grid_rects(len(order))
    return list(zip(order, rects))


# ── pixels (pure, tested) ─────────────────────────────────────────────────────


@dataclass
class Planes:
    """One I420 picture as three uint8 planes (Y full size, U and V half size)."""

    y: np.ndarray
    u: np.ndarray
    v: np.ndarray

    @property
    def width(self) -> int:
        return self.y.shape[1]

    @property
    def height(self) -> int:
        return self.y.shape[0]


def i420_planes(data, width: int, height: int) -> Planes:
    """Planes of a packed I420 buffer as LiveKit lays it out (chroma rounded up)."""
    cw, ch = (width + 1) // 2, (height + 1) // 2
    buf = np.frombuffer(data, dtype=np.uint8)
    y_size, c_size = width * height, cw * ch
    if buf.size < y_size + 2 * c_size:
        raise ValueError("I420 buffer is too small")
    return Planes(
        buf[:y_size].reshape(height, width),
        buf[y_size : y_size + c_size].reshape(ch, cw),
        buf[y_size + c_size : y_size + 2 * c_size].reshape(ch, cw),
    )


_ROTATION_TURNS = {
    rtc.VideoRotation.VIDEO_ROTATION_0: 0,
    rtc.VideoRotation.VIDEO_ROTATION_90: -1,  # np.rot90 turns counter-clockwise; -1 is clockwise
    rtc.VideoRotation.VIDEO_ROTATION_180: 2,
    rtc.VideoRotation.VIDEO_ROTATION_270: 1,
}


def rotate(planes: Planes, rotation) -> Planes:
    """Apply a frame's display rotation (phones send portrait cameras rotated)."""
    turns = _ROTATION_TURNS.get(rotation, 0)
    if turns == 0:
        return planes
    return Planes(np.rot90(planes.y, turns), np.rot90(planes.u, turns), np.rot90(planes.v, turns))


def scale(planes: Planes, width: int, height: int) -> Planes:
    """Resize with libswscale (via PyAV). Odd source edges are cropped by one pixel."""
    sw, sh = planes.width // 2 * 2, planes.height // 2 * 2
    if sw < 2 or sh < 2:
        raise ValueError("picture too small")
    if (sw, sh) == (width, height) and planes.u.shape == (sh // 2, sw // 2):
        return planes
    packed = np.concatenate(
        [
            np.ascontiguousarray(planes.y[:sh, :sw]).ravel(),
            np.ascontiguousarray(planes.u[: sh // 2, : sw // 2]).ravel(),
            np.ascontiguousarray(planes.v[: sh // 2, : sw // 2]).ravel(),
        ]
    ).reshape(sh * 3 // 2, sw)
    frame = av.VideoFrame.from_ndarray(packed, format="yuv420p").reformat(width=width, height=height, format="yuv420p")
    out = frame.to_ndarray()
    c_size = (width // 2) * (height // 2)
    rest = out[height:].ravel()
    return Planes(
        out[:height].copy(),
        rest[:c_size].reshape(height // 2, width // 2).copy(),
        rest[c_size : 2 * c_size].reshape(height // 2, width // 2).copy(),
    )


def blank_canvas(width: int = CANVAS_W, height: int = CANVAS_H) -> Planes:
    return Planes(
        np.full((height, width), _Y_BLACK, dtype=np.uint8),
        np.full((height // 2, width // 2), _C_NEUTRAL, dtype=np.uint8),
        np.full((height // 2, width // 2), _C_NEUTRAL, dtype=np.uint8),
    )


def paste(canvas: Planes, picture: Planes, x: int, y: int) -> None:
    """Copy `picture` onto `canvas` at an even (x, y), clipped to the canvas."""
    w = min(picture.width, canvas.width - x)
    h = min(picture.height, canvas.height - y)
    if w <= 0 or h <= 0:
        return
    canvas.y[y : y + h, x : x + w] = picture.y[:h, :w]
    canvas.u[y // 2 : (y + h) // 2, x // 2 : (x + w) // 2] = picture.u[: h // 2, : w // 2]
    canvas.v[y // 2 : (y + h) // 2, x // 2 : (x + w) // 2] = picture.v[: h // 2, : w // 2]


# ── encoder ──────────────────────────────────────────────────────────────────


class _MemorySink:
    """Write-only file object for PyAV: collects the bytes the muxer produces."""

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


class H264TsEncoder:
    """Canvas pictures in, one continuous MPEG-TS/H.264 byte stream out. MPEG-TS needs no
    seeking and no trailer, so any prefix of the stream is playable. Not thread-safe."""

    def __init__(self, width: int = CANVAS_W, height: int = CANVAS_H, fps: int = CANVAS_FPS) -> None:
        self._sink = _MemorySink()
        self._container = av.open(self._sink, mode="w", format="mpegts")
        self._stream = self._container.add_stream(
            "libx264",
            rate=fps,
            options={
                "preset": "veryfast",
                # No lookahead or B-frames: bytes come out as frames go in, so every chunk
                # carries the latest seconds and a crash loses little.
                "tune": "zerolatency",
                "crf": "28",
                "maxrate": "1500k",
                "bufsize": "3000k",
                "g": str(GOP_FRAMES),
            },
        )
        self._stream.width = width
        self._stream.height = height
        self._stream.pix_fmt = "yuv420p"
        self._time_base = Fraction(1, fps)
        self._width, self._height = width, height
        self._last_pts = -1
        self.closed = False

    def encode(self, canvas: Planes, pts: int) -> None:
        """Encode one picture at `pts` (in 1/fps units). Out-of-order pts are dropped."""
        if self.closed or pts <= self._last_pts:
            return
        packed = np.concatenate([canvas.y.ravel(), canvas.u.ravel(), canvas.v.ravel()]).reshape(
            self._height * 3 // 2, self._width
        )
        frame = av.VideoFrame.from_ndarray(packed, format="yuv420p")
        frame.pts = pts
        frame.time_base = self._time_base
        self._last_pts = pts
        for packet in self._stream.encode(frame):
            self._container.mux(packet)

    def take(self) -> bytes:
        return self._sink.take()

    def close(self) -> bytes:
        if self.closed:
            return b""
        self.closed = True
        for packet in self._stream.encode(None):
            self._container.mux(packet)
        self._container.close()
        return self._sink.take()


# ── compositor ───────────────────────────────────────────────────────────────


@dataclass
class _Source:
    is_screen: bool
    order: int
    frame: Optional[rtc.VideoFrame] = None
    rotation: int = rtc.VideoRotation.VIDEO_ROTATION_0
    version: int = 0
    last_frame_at: float = 0.0
    task: Optional[asyncio.Task] = None
    # (version, w, h) -> scaled planes, so an unchanged frame is never rescaled
    cache: Dict[Tuple[int, int, int], Planes] = field(default_factory=dict)


@dataclass(frozen=True)
class _Snapshot:
    key: str
    frame: rtc.VideoFrame
    rotation: int
    version: int
    source: _Source


def compose(layout: str, snapshots: Sequence[_Snapshot]) -> Planes:
    """Draw one canvas from the sources' latest frames (runs on the video thread)."""
    canvas = blank_canvas()
    by_key = {s.key: s for s in snapshots}
    for key, box in layout_boxes(layout, [(s.key, s.source.is_screen) for s in snapshots]):
        snap = by_key[key]
        try:
            picture = rotate(i420_planes(snap.frame.data, snap.frame.width, snap.frame.height), snap.rotation)
            target = fit_rect(picture.width, picture.height, box)
            cache_key = (snap.version, target.w, target.h)
            scaled = snap.source.cache.get(cache_key)
            if scaled is None:
                scaled = scale(picture, target.w, target.h)
                snap.source.cache.clear()
                snap.source.cache[cache_key] = scaled
            paste(canvas, scaled, target.x, target.y)
        except Exception:
            logger.warning(f"recording_video_source_draw_failed | key={key}", exc_info=True)
    return canvas


class VideoCompositor:
    """Composes, encodes and hands out the video of one recording run.

    `emit(seq, data)` receives consecutive slices of the MPEG-TS stream, numbered in order.
    """

    def __init__(self, layout: str, emit: Callable[[int, bytes], None]):
        self.layout = layout
        self._emit = emit
        self._sources: Dict[str, _Source] = {}
        self._next_order = 0
        self._encoder: Optional[H264TsEncoder] = None
        self._lock = asyncio.Lock()
        self._seq = 0
        self._ticker: Optional[asyncio.Task] = None
        self._t0 = 0.0
        self.offset_ms: Optional[int] = None
        self.frames_encoded = 0
        self.capturing = False

    def start(self, recording_started_at_ms: int) -> None:
        """Start the clock: frame 0 of the stream is now, `offset_ms` into the recording."""
        self._t0 = time.monotonic()
        self.offset_ms = max(0, int(time.time() * 1000 - recording_started_at_ms))
        self.capturing = True
        self._ticker = asyncio.create_task(self._tick_loop())

    # ── sources ──

    def add_track(self, key: str, track: rtc.Track, is_screen: bool) -> None:
        if not self.capturing or key in self._sources:
            return
        source = _Source(is_screen=is_screen, order=self._next_order)
        self._next_order += 1
        self._sources[key] = source
        source.task = asyncio.create_task(self._consume(key, source, track))
        logger.info(f"recording_video_source_added | key={key}, screen={is_screen}, sources={len(self._sources)}")

    def remove_track(self, key: str) -> None:
        source = self._sources.pop(key, None)
        if source is not None:
            logger.info(f"recording_video_source_removed | key={key}, sources={len(self._sources)}")
        if source is not None and source.task is not None and not source.task.done():
            source.task.cancel()

    async def _consume(self, key: str, source: _Source, track: rtc.Track) -> None:
        # capacity=1: only the newest frame matters; I420 conversion happens in the SDK.
        stream = rtc.VideoStream(track, capacity=1, format=rtc.VideoBufferType.I420)
        try:
            async for event in stream:
                if not self.capturing:
                    break
                source.frame = event.frame
                source.rotation = event.rotation
                source.version += 1
                source.last_frame_at = time.monotonic()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.error(f"recording_video_stream_failed | key={key}", exc_info=True)
        finally:
            with contextlib.suppress(Exception):
                await stream.aclose()
            if self._sources.get(key) is source:
                del self._sources[key]

    def _snapshot(self) -> List[_Snapshot]:
        now = time.monotonic()
        live = [
            (key, s)
            for key, s in self._sources.items()
            if s.frame is not None and now - s.last_frame_at <= STALE_AFTER_S
        ]
        live.sort(key=lambda item: item[1].order)
        return [_Snapshot(key, s.frame, s.rotation, s.version, s) for key, s in live]  # type: ignore[arg-type]

    # ── encoding ──

    async def _tick_loop(self) -> None:
        loop = asyncio.get_running_loop()
        interval = 1.0 / CANVAS_FPS
        last_pts = -1
        while self.capturing:
            pts = int((time.monotonic() - self._t0) * CANVAS_FPS)
            if pts > last_pts:
                last_pts = pts
                snapshots = self._snapshot()
                try:
                    async with self._lock:
                        if self._encoder is None:
                            self._encoder = await loop.run_in_executor(_video_executor, H264TsEncoder)
                        if not self._encoder.closed:
                            await loop.run_in_executor(_video_executor, self._encode_tick, snapshots, pts)
                except Exception:
                    logger.error("recording_video_tick_failed", exc_info=True)
            # Sleep to the next tick boundary; a slow tick simply skips the ones it overran.
            next_at = self._t0 + (int((time.monotonic() - self._t0) * CANVAS_FPS) + 1) * interval
            await asyncio.sleep(max(0.0, next_at - time.monotonic()))

    def _encode_tick(self, snapshots: List[_Snapshot], pts: int) -> None:
        assert self._encoder is not None
        self._encoder.encode(compose(self.layout, snapshots), pts)
        self.frames_encoded += 1

    async def _cut(self, final: bool) -> None:
        loop = asyncio.get_running_loop()
        async with self._lock:
            if self._encoder is None or (self._encoder.closed and not final):
                return
            data = await loop.run_in_executor(_video_executor, self._encoder.close if final else self._encoder.take)
            if data:
                # Numbered under the lock: slices can't overtake each other.
                self._emit(self._seq, data)
                self._seq += 1

    async def flush(self) -> None:
        """Hand out the stream bytes produced since the last flush."""
        await self._cut(final=False)

    async def finish(self) -> None:
        """Stop composing, end the stream and hand out its last bytes."""
        self.capturing = False
        if self._ticker is not None:
            self._ticker.cancel()
            with contextlib.suppress(BaseException):
                await self._ticker
        for key in list(self._sources):
            self.remove_track(key)
        await self._cut(final=True)

    def abort(self) -> None:
        self.capturing = False
        if self._ticker is not None and not self._ticker.done():
            self._ticker.cancel()
        for key in list(self._sources):
            self.remove_track(key)
