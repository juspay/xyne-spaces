"""The recorder's video compositor (needs PyAV with libx264, as in the agent image).

Run from python-agent/:  python -m unittest tests.test_call_video
"""
import asyncio
import io
import time
import unittest

import av
import numpy as np
from livekit import rtc

from modules import call_video
from modules.call_video import (
    CANVAS_FPS,
    CANVAS_H,
    CANVAS_W,
    LAYOUT_GRID,
    LAYOUT_SPEAKER,
    H264TsEncoder,
    Rect,
    VideoCompositor,
    _Source,
    blank_canvas,
    choose_sources,
    fit_rect,
    grid_rects,
    i420_planes,
    layout_boxes,
    layout_for,
    paste,
    rotate,
    scale,
)


def _i420_frame(width: int, height: int, y: int, u: int = 128, v: int = 128) -> rtc.VideoFrame:
    cw, ch = (width + 1) // 2, (height + 1) // 2
    data = bytes([y]) * (width * height) + bytes([u]) * (cw * ch) + bytes([v]) * (cw * ch)
    return rtc.VideoFrame(width, height, rtc.VideoBufferType.I420, data)


def _decode(ts: bytes):
    with av.open(io.BytesIO(ts), format="mpegts") as container:
        stream = container.streams.video[0]
        # The raw Y plane (limited range, as composed), not a full-range grey conversion.
        frames = [f.to_ndarray(format="yuv420p")[: f.height] for f in container.decode(stream)]
        return stream.codec_context.name, stream.codec_context.width, stream.codec_context.height, frames


class LayoutTest(unittest.TestCase):
    def test_layout_per_recording_type(self):
        self.assertEqual(layout_for("AUDIO_SCREEN"), LAYOUT_SPEAKER)
        self.assertEqual(layout_for("AUDIO_VIDEO"), LAYOUT_GRID)
        self.assertIsNone(layout_for("AUDIO_ONLY"))

    def test_grid_tiles_stay_inside_the_canvas_on_even_coordinates(self):
        self.assertEqual(grid_rects(0), [])
        self.assertEqual(grid_rects(1), [Rect(0, 0, CANVAS_W, CANVAS_H)])
        for n in range(2, 17):
            rects = grid_rects(n)
            self.assertEqual(len(rects), n)
            for r in rects:
                self.assertTrue(r.x >= 0 and r.y >= 0 and r.x + r.w <= CANVAS_W and r.y + r.h <= CANVAS_H, (n, r))
                self.assertTrue(r.x % 2 == r.y % 2 == r.w % 2 == r.h % 2 == 0, (n, r))
            # no two tiles overlap
            for i, a in enumerate(rects):
                for b in rects[i + 1 :]:
                    self.assertTrue(a.x + a.w <= b.x or b.x + b.w <= a.x or a.y + a.h <= b.y or b.y + b.h <= a.y)

    def test_short_last_row_is_centred(self):
        rects = grid_rects(3)  # 2 columns: two on top, one centred below
        self.assertEqual(rects[0].y, rects[1].y)
        self.assertGreater(rects[2].y, rects[0].y)
        centre = rects[2].x + rects[2].w / 2
        self.assertAlmostEqual(centre, CANVAS_W / 2, delta=2)

    def test_fit_keeps_aspect_ratio_and_centres(self):
        box = Rect(0, 0, 1280, 720)
        portrait = fit_rect(720, 1280, box)
        self.assertEqual(portrait.h, 720)
        self.assertAlmostEqual(portrait.w / portrait.h, 720 / 1280, delta=0.01)
        self.assertAlmostEqual(portrait.x + portrait.w / 2, 640, delta=2)
        exact = fit_rect(1920, 1080, box)
        self.assertEqual((exact.x, exact.y, exact.w, exact.h), (0, 0, 1280, 720))

    def test_speaker_layout_shows_the_newest_screen_share_and_every_camera(self):
        sources = [("cam-a", False), ("screen-a", True), ("cam-b", False), ("screen-b", True)]
        self.assertEqual(choose_sources(LAYOUT_SPEAKER, sources), ["screen-b", "cam-a", "cam-b"])
        self.assertEqual(choose_sources(LAYOUT_SPEAKER, [("cam-a", False), ("cam-b", False)]), ["cam-a", "cam-b"])
        self.assertEqual(choose_sources(LAYOUT_GRID, sources), ["screen-a", "screen-b", "cam-a", "cam-b"])


    def test_speaker_layout_puts_cameras_in_a_strip_beside_the_screen(self):
        boxes = dict(layout_boxes(LAYOUT_SPEAKER, [("cam-a", False), ("screen", True), ("cam-b", False)]))
        main, a, b = boxes["screen"], boxes["cam-a"], boxes["cam-b"]
        self.assertGreater(main.w * main.h, 4 * a.w * a.h)
        for cam in (a, b):
            self.assertGreaterEqual(cam.x, main.x + main.w)  # beside, not over, the screen
            self.assertLessEqual(cam.x + cam.w, CANVAS_W)
            self.assertTrue(cam.x % 2 == cam.y % 2 == 0)
        self.assertLess(a.y + a.h, b.y)
        # Many cameras: the strip shows as many as fit, all inside the canvas.
        many = layout_boxes(LAYOUT_SPEAKER, [("screen", True)] + [(f"c{i}", False) for i in range(9)])
        self.assertEqual(len(many), 1 + call_video.STRIP_MAX_TILES)
        self.assertTrue(all(r.y >= 0 and r.y + r.h <= CANVAS_H for _, r in many))
        # No screen share: cameras use the grid; a screen alone fills the frame.
        self.assertEqual(layout_boxes(LAYOUT_SPEAKER, [("c", False)]), [("c", Rect(0, 0, CANVAS_W, CANVAS_H))])
        self.assertEqual(layout_boxes(LAYOUT_SPEAKER, [("s", True)]), [("s", Rect(0, 0, CANVAS_W, CANVAS_H))])


class PixelTest(unittest.TestCase):
    def test_odd_sized_i420_buffers_are_read_with_rounded_up_chroma(self):
        frame = _i420_frame(5, 3, y=200, u=90, v=160)
        planes = i420_planes(frame.data, 5, 3)
        self.assertEqual(planes.y.shape, (3, 5))
        self.assertEqual(planes.u.shape, (2, 3))
        self.assertTrue((planes.v == 160).all())
        with self.assertRaises(ValueError):
            i420_planes(b"\x00" * 10, 5, 3)

    def test_rotation_turns_portrait_into_landscape(self):
        planes = i420_planes(_i420_frame(4, 8, y=50).data, 4, 8)
        turned = rotate(planes, rtc.VideoRotation.VIDEO_ROTATION_90)
        self.assertEqual((turned.width, turned.height), (8, 4))
        self.assertIs(rotate(planes, rtc.VideoRotation.VIDEO_ROTATION_0), planes)

    def test_scale_and_paste(self):
        src = i420_planes(_i420_frame(641, 361, y=180).data, 641, 361)  # odd edges are cropped
        small = scale(src, 320, 180)
        self.assertEqual((small.width, small.height), (320, 180))
        self.assertEqual(small.u.shape, (90, 160))
        self.assertTrue(abs(int(small.y.mean()) - 180) <= 1)

        canvas = blank_canvas()
        paste(canvas, small, 100, 50)
        self.assertEqual(int(canvas.y[60, 110]), int(small.y[10, 10]))
        self.assertEqual(int(canvas.y[0, 0]), 16)  # untouched canvas stays black
        paste(canvas, small, CANVAS_W - 10, CANVAS_H - 10)  # clipped, no error


class EncoderTest(unittest.TestCase):
    def test_chunks_concatenate_into_one_playable_h264_stream(self):
        encoder = H264TsEncoder()
        chunks = []
        for pts in range(30):
            canvas = blank_canvas()
            canvas.y[:] = 16 + pts * 4  # brightening, so frames differ
            encoder.encode(canvas, pts)
            if pts % 7 == 0:
                chunks.append(encoder.take())
        encoder.encode(blank_canvas(), 10)  # out of order: dropped
        chunks.append(encoder.close())
        self.assertEqual(encoder.close(), b"")

        codec, width, height, frames = _decode(b"".join(chunks))
        self.assertEqual((codec, width, height), ("h264", CANVAS_W, CANVAS_H))
        self.assertEqual(len(frames), 30)
        self.assertLess(frames[0].mean(), frames[-1].mean())

    def test_a_prefix_of_the_stream_is_playable(self):
        encoder = H264TsEncoder()
        for pts in range(20):
            encoder.encode(blank_canvas(), pts)
        # A crash before close(): what was taken so far must still decode.
        _, _, _, frames = _decode(encoder.take())
        self.assertGreater(len(frames), 0)


class CompositorTest(unittest.TestCase):
    def test_composes_live_sources_and_emits_ordered_chunks(self):
        async def run():
            emitted = []
            comp = VideoCompositor(LAYOUT_SPEAKER, lambda seq, data: emitted.append((seq, data)))
            comp.start(int(time.time() * 1000) - 1500)
            self.assertGreaterEqual(comp.offset_ms, 1500)

            # Inject sources directly (VideoStream needs a live room).
            now = time.monotonic()
            camera = _Source(is_screen=False, order=0, frame=_i420_frame(640, 480, y=100), version=1, last_frame_at=now)
            screen = _Source(is_screen=True, order=1, frame=_i420_frame(1920, 1080, y=220), version=1, last_frame_at=now)
            comp._sources = {"cam": camera, "screen": screen}

            async def keep_fresh():
                while comp.capturing:
                    camera.last_frame_at = screen.last_frame_at = time.monotonic()
                    await asyncio.sleep(0.1)

            fresher = asyncio.create_task(keep_fresh())
            await asyncio.sleep(0.6)
            await comp.flush()
            # Screen share stops: the speaker layout falls back to the camera.
            del comp._sources["screen"]
            await asyncio.sleep(0.6)
            await comp.finish()
            fresher.cancel()
            return comp, emitted

        comp, emitted = asyncio.run(run())
        self.assertEqual([seq for seq, _ in emitted], list(range(len(emitted))))
        self.assertGreaterEqual(len(emitted), 2)
        _, width, height, frames = _decode(b"".join(data for _, data in emitted))
        self.assertEqual((width, height), (CANVAS_W, CANVAS_H))
        # ~1.2 s at CANVAS_FPS; a slow test machine may skip a few ticks.
        self.assertGreaterEqual(len(frames), CANVAS_FPS // 2)
        self.assertEqual(len(frames), comp.frames_encoded)
        centre = lambda f: int(f[CANVAS_H // 2, CANVAS_W // 2])
        boxes = dict(layout_boxes(LAYOUT_SPEAKER, [("cam", False), ("screen", True)]))
        main, strip = boxes["screen"], boxes["cam"]
        at = lambda f, r: int(f[r.y + r.h // 2, r.x + r.w // 2])
        self.assertAlmostEqual(at(frames[2], main), 220, delta=8)  # screen share in the main area
        self.assertAlmostEqual(at(frames[2], strip), 100, delta=8)  # camera alongside it
        self.assertAlmostEqual(centre(frames[-1]), 100, delta=8)  # camera alone
        self.assertLess(int(frames[-1][CANVAS_H // 2, 5]), 30)  # 4:3 camera pillarboxed in black

    def test_stale_sources_leave_the_layout(self):
        comp = VideoCompositor(LAYOUT_GRID, lambda *_: None)
        comp._sources = {
            "fresh": _Source(is_screen=False, order=0, frame=_i420_frame(64, 64, y=90), last_frame_at=time.monotonic()),
            "stale": _Source(
                is_screen=False, order=1, frame=_i420_frame(64, 64, y=90),
                last_frame_at=time.monotonic() - call_video.STALE_AFTER_S - 1,
            ),
            "never": _Source(is_screen=False, order=2),
        }
        self.assertEqual([s.key for s in comp._snapshot()], ["fresh"])


if __name__ == "__main__":
    unittest.main()
