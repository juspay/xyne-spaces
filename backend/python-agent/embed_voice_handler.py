"""
Route handler for speaker voice enrollment.

Registered by health_server.py on the shared aiohttp app:
  POST /embed-voice -> embed_voice

This is a plain handler module — not a server. It runs inside the
transcription agent process on port 8080 alongside the health endpoints.

Speaker-embedding logic lives in:
  modules/speaker_embedding.py -- model loading + enrollment algorithm
"""
import asyncio
import tempfile
import os
import traceback
from aiohttp import web
from config import get_logger

from modules.speaker_embedding import compute_enrollment_embedding

logger = get_logger(__name__)


async def embed_voice(request):
    """
    POST /embed-voice
    Accepts a multipart audio file upload and produces a single 256-dim
    speaker embedding using a sliding-window + L2-normalized mean strategy.

    See modules/speaker_embedding.compute_enrollment_embedding for the full
    algorithm description.

    Supported audio: WAV, OGG, MP3, WebM -- anything PyAV can decode.
    Minimum recommended speech duration: 5 s (3 s hard minimum enforced).
    """
    tmp_path = None
    try:
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "audio":
            return web.json_response({"error": "Expected multipart field 'audio'"}, status=400)

        suffix = ".wav"
        content_type = field.headers.get("Content-Type", "")
        if "ogg" in content_type:
            suffix = ".ogg"
        elif "mp3" in content_type or "mpeg" in content_type:
            suffix = ".mp3"
        elif "webm" in content_type:
            suffix = ".webm"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = await field.read_chunk(65536)
                if not chunk:
                    break
                tmp.write(chunk)

        import av
        import numpy as np
        import torch

        container = av.open(tmp_path)
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)

        frames = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                frames.append(resampled.to_ndarray())
        for resampled in resampler.resample(None):
            frames.append(resampled.to_ndarray())
        container.close()

        if not frames:
            return web.json_response({"error": "No audio frames decoded"}, status=400)

        waveform_np = np.concatenate(frames, axis=-1)
        sample_rate = 16000
        duration_s  = waveform_np.shape[-1] / sample_rate

        MIN_DURATION_S = 3.0
        if duration_s < MIN_DURATION_S:
            return web.json_response(
                {"error": f"Audio too short ({duration_s:.1f}s). "
                          f"Please provide at least {MIN_DURATION_S}s of speech."},
                status=400,
            )

        waveform = torch.from_numpy(waveform_np)

        final_embedding, n_windows = await asyncio.to_thread(
            compute_enrollment_embedding, waveform, sample_rate
        )

        flat = final_embedding.tolist()

        if len(flat) != 256:
            return web.json_response(
                {"error": f"Unexpected embedding dimension: {len(flat)}"},
                status=500,
            )

        logger.info(
            f"[embed_voice] signature computed from {n_windows} windows, "
            f"duration={duration_s:.1f}s"
        )
        return web.json_response({
            "embedding":  flat,
            "dim":        len(flat),
            "windows":    n_windows,
            "duration_s": round(duration_s, 2),
        })

    except ValueError as e:
        logger.error(f"embed_voice config error: {e}")
        return web.json_response({"error": str(e)}, status=500)
    except Exception as e:
        logger.error(f"embed_voice error: {e}\n{traceback.format_exc()}")
        return web.json_response({"error": "Internal server error"}, status=500)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
