"""Smoke-test the local Nemotron STT adapter with one second of silent PCM."""

import asyncio
import logging
import os
import time

from livekit import rtc

from transcription.local_nemotron import LocalNemotronSTT


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    model_id = os.getenv(
        "LOCAL_STT_MODEL_ID", "nvidia/nemotron-3.5-asr-streaming-0.6b"
    )
    stt = LocalNemotronSTT(
        model_id=model_id,
        device=os.getenv("LOCAL_STT_DEVICE", "cpu"),
        allow_download=False,
    )
    started = time.perf_counter()
    try:
        await stt.warmup()
        frame = rtc.AudioFrame(
            data=bytes(16_000 * 2),
            sample_rate=16_000,
            num_channels=1,
            samples_per_channel=16_000,
        )
        event = await stt.recognize(buffer=frame)
        if not event.alternatives:
            raise RuntimeError("Nemotron returned no transcription alternative")
        print(
            "Local STT smoke check passed:",
            {
                "event": str(event.type),
                "text": event.alternatives[0].text,
                "elapsed_seconds": round(time.perf_counter() - started, 3),
            },
        )
    finally:
        await stt.aclose()


if __name__ == "__main__":
    asyncio.run(main())
