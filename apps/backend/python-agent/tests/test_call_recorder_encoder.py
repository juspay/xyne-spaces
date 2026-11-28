"""The recorder's Ogg/Opus encoder (needs PyAV with libopus, as in the agent image).

Run from python-agent/:  python -m unittest tests.test_call_recorder_encoder
"""
import io
import unittest

import av
import numpy as np

from modules.call_recorder import SAMPLE_RATE, OggOpusEncoder


def _tone(seconds: float) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (np.sin(2 * np.pi * 440 * t) * 8000).astype(np.int16)


class OggOpusEncoderTest(unittest.TestCase):
    def test_chunks_concatenate_into_one_playable_stream(self):
        encoder = OggOpusEncoder()
        chunks = []
        pcm = _tone(2.5)
        # Uneven batches, as the recorder hands them over, with takes in between.
        for start in range(0, pcm.size, 7_333):
            encoder.encode(pcm[start : start + 7_333])
            chunks.append(encoder.take())
        chunks.append(encoder.close())
        data = b"".join(chunks)
        self.assertTrue(data.startswith(b"OggS"))

        with av.open(io.BytesIO(data), format="ogg") as container:
            stream = container.streams.audio[0]
            self.assertEqual(stream.codec_context.name, "opus")
            samples = sum(frame.samples for frame in container.decode(stream))
        # 2.5 s, plus at most one padded 20 ms frame and the codec's pre-skip.
        self.assertAlmostEqual(samples / SAMPLE_RATE, 2.5, delta=0.05)

    def test_close_is_idempotent(self):
        encoder = OggOpusEncoder()
        encoder.encode(_tone(0.1))
        self.assertTrue(encoder.close())
        self.assertEqual(encoder.close(), b"")


if __name__ == "__main__":
    unittest.main()
