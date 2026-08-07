"""Publish a WAV file to a local LiveKit room and await a final transcript."""

import argparse
import asyncio
import os
import time
import wave

from livekit import api, rtc


def _token(room_name: str, identity: str) -> str:
    return (
        api.AccessToken(
            os.getenv("LIVEKIT_API_KEY", "devkey"),
            os.getenv("LIVEKIT_API_SECRET", "devsecret"),
        )
        .with_identity(identity)
        .with_name("Local STT compatibility test")
        .with_grants(api.VideoGrants(room_join=True, room=room_name))
        .to_jwt()
    )


async def run(wav_path: str, timeout: float, agent_ready_delay: float) -> None:
    room_name = f"local-stt-compat-{int(time.time())}"
    room = rtc.Room()
    monitor = rtc.Room()
    final_transcript = asyncio.Event()
    media_received = asyncio.Event()
    transcripts: list[str] = []
    monitor_tasks: set[asyncio.Task] = set()

    @room.on("transcription_received")
    def on_transcription(segments, participant, publication) -> None:
        del participant, publication
        for segment in segments:
            text = segment.text.strip()
            if segment.final and text:
                transcripts.append(text)
            if segment.final:
                final_transcript.set()

    @monitor.on("track_subscribed")
    def on_monitor_track(track, publication, participant) -> None:
        del publication, participant
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return

        async def consume_audio() -> None:
            stream = rtc.AudioStream(track)
            try:
                async for event in stream:
                    if any(event.frame.data):
                        media_received.set()
                        return
            finally:
                await stream.aclose()

        task = asyncio.create_task(consume_audio())
        monitor_tasks.add(task)
        task.add_done_callback(monitor_tasks.discard)

    try:
        await room.connect(
            os.getenv("LIVEKIT_URL", "ws://livekit:7880"),
            _token(room_name, "local-stt-test-speaker"),
        )

        # Give the worker time to accept the room job and initialize its session pool.
        deadline = asyncio.get_running_loop().time() + timeout
        while not room.remote_participants:
            if asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError("No LiveKit agent joined the test room")
            await asyncio.sleep(0.25)

        await monitor.connect(
            os.getenv("LIVEKIT_URL", "ws://livekit:7880"),
            _token(room_name, "local-stt-test-monitor"),
        )

        # An agent participant appears before a cold local ASR model and the
        # per-participant session pool are ready to consume media.
        await asyncio.sleep(agent_ready_delay)

        with wave.open(wav_path, "rb") as wav:
            if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
                raise ValueError("Test WAV must be mono, 16-bit PCM")
            sample_rate = wav.getframerate()
            source = rtc.AudioSource(sample_rate, 1)
            track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
            options = rtc.TrackPublishOptions()
            options.source = rtc.TrackSource.SOURCE_MICROPHONE
            await room.local_participant.publish_track(track, options)

            samples_per_frame = sample_rate // 50  # 20 ms
            silence = bytes(samples_per_frame * 2)
            # Publishing the track triggers lazy creation of the participant's
            # AgentSession. Keep the track alive while that attachment completes.
            for _ in range(100):
                await source.capture_frame(
                    rtc.AudioFrame(silence, sample_rate, 1, samples_per_frame)
                )
                await asyncio.sleep(samples_per_frame / sample_rate)

            while chunk := wav.readframes(samples_per_frame):
                samples = len(chunk) // 2
                await source.capture_frame(
                    rtc.AudioFrame(chunk, sample_rate, 1, samples)
                )
                await asyncio.sleep(samples / sample_rate)

            # Ensure Silero observes enough trailing silence to close the utterance.
            for _ in range(75):
                await source.capture_frame(
                    rtc.AudioFrame(silence, sample_rate, 1, samples_per_frame)
                )
                await asyncio.sleep(samples_per_frame / sample_rate)

        await asyncio.wait_for(media_received.wait(), timeout=5.0)
        remaining = max(0.1, deadline - asyncio.get_running_loop().time())
        await asyncio.wait_for(final_transcript.wait(), timeout=remaining)
        text = " ".join(transcripts).strip()
        if not text:
            raise RuntimeError("Agent published a final event without transcript text")
        print(
            "LiveKit room STT check passed:",
            {"room": room_name, "transcript": text},
        )
    finally:
        for task in monitor_tasks:
            task.cancel()
        if monitor_tasks:
            await asyncio.gather(*monitor_tasks, return_exceptions=True)
        await monitor.disconnect()
        await room.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav_path")
    parser.add_argument("--timeout", type=float, default=45.0)
    parser.add_argument("--agent-ready-delay", type=float, default=20.0)
    args = parser.parse_args()
    asyncio.run(run(args.wav_path, args.timeout, args.agent_ready_delay))


if __name__ == "__main__":
    main()
