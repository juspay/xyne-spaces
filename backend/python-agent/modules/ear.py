"""
EarModule - VAD-based audio segmentation and Whisper transcription
"""
import asyncio
import io
import logging
import time
import wave
from typing import List

from livekit import rtc
from livekit.agents import vad as agents_vad
from livekit.plugins import silero
from openai import AzureOpenAI

from events import EventBus

# Configure logger
logger = logging.getLogger(__name__)


class EarModule:
    """
    Listens to participant audio, uses VAD to segment speech,
    and transcribes via Azure OpenAI Whisper API
    """

    def __init__(
        self,
        event_bus: EventBus,
        azure_endpoint: str,
        azure_api_key: str,
        azure_api_version: str,
        azure_model: str,
    ):
        """
        Initialize the EarModule

        Args:
            event_bus: EventBus instance for emitting transcription events
            azure_endpoint: Azure OpenAI endpoint URL
            azure_api_key: Azure OpenAI API key
            azure_api_version: Azure OpenAI API version
            azure_model: Azure OpenAI model/deployment name for STT
        """
        self.bus = event_bus
        self.vad = silero.VAD.load()
        self.stt_model = azure_model

        # Initialize Azure OpenAI client
        self.openai_client = AzureOpenAI(
            azure_endpoint=azure_endpoint,
            api_key=azure_api_key,
            api_version=azure_api_version,
        )

    async def listen(self, participant: rtc.Participant, track: rtc.RemoteAudioTrack):
        """
        Listen to a participant's audio track, segment with VAD, and transcribe

        Args:
            participant: The participant whose audio to listen to
            track: The audio track to process
        """
        logger.info(f"[EAR] Starting to listen to {participant.identity}")
        vad_stream = self.vad.stream()
        queue = asyncio.Queue()
        frame_count = 0

        logger.info(f"[STT] Starting VAD stream for participant: {participant.identity}")

        # Loop A: Push audio frames to VAD (background task)
        async def push_audio():
            nonlocal frame_count
            audio_stream = rtc.AudioStream(track)
            logger.info(f"[STT] Audio stream started for {participant.identity}")
            async for frame_event in audio_stream:
                frame_count += 1
                # Extract the actual AudioFrame from the AudioFrameEvent
                audio_frame = frame_event.frame
                if frame_count % 100 == 0:
                    logger.info(f"[STT] Received {frame_count} audio frames from {participant.identity} (sample_rate={audio_frame.sample_rate}, samples={audio_frame.samples_per_channel})")
                queue.put_nowait(audio_frame)
                vad_stream.push_frame(audio_frame)

        # Loop B: Process VAD events (main logic)
        process_task = asyncio.create_task(push_audio())
        frames_buffer: List[rtc.AudioFrame] = []

        try:
            logger.debug(f"[EAR] Listening for VAD events from {participant.identity}")
            async for event in vad_stream:
                # Sync buffer with queue
                while not queue.empty():
                    frames_buffer.append(queue.get_nowait())

                if event.type == agents_vad.VADEventType.START_OF_SPEECH:
                    # Reset buffer on new speech
                    logger.info(f"[VAD] Speech STARTED from {participant.identity}")
                    frames_buffer = []

                elif event.type == agents_vad.VADEventType.END_OF_SPEECH:
                    # User finished speaking - transcribe the audio
                    duration_ms = len(frames_buffer) * 10  # ~10ms per frame
                    logger.info(f"[VAD] Speech ENDED from {participant.identity} - {len(frames_buffer)} frames (~{duration_ms}ms)")
                    await self._transcribe_frames(frames_buffer, participant)
                    frames_buffer = []

        except asyncio.CancelledError:
            # EDGE CASE: Agent shutdown/redeployment - flush remaining audio
            logger.warning(f"[STT] Agent stopping, flushing buffer for {participant.identity}...")
            if len(frames_buffer) > 10:  # Only if significant audio exists
                await self._transcribe_frames(frames_buffer, participant)
            raise  # Re-raise to properly cancel

        finally:
            # EDGE CASE: Participant left or track ended - cleanup
            process_task.cancel()
            try:
                await process_task
            except asyncio.CancelledError:
                pass
            logger.info(f"[STT] Cleaned up resources for {participant.identity} (processed {frame_count} total frames)")

    async def _transcribe_frames(
        self, frames: List[rtc.AudioFrame], participant: rtc.Participant
    ):
        """
        Convert audio frames to WAV and transcribe via OpenAI Whisper API

        Args:
            frames: List of audio frames to transcribe
            participant: The participant who spoke
        """
        logger.debug(f"[TRANSCRIBE] Called with {len(frames)} frames for {participant.identity}")

        if not frames:
            logger.debug(f" [STT] No frames to transcribe for {participant.identity}")
            return

        # 1. Check minimum duration (300ms)
        total_samples = sum(len(frame.data) // 2 for frame in frames)  # 16-bit = 2 bytes/sample
        sample_rate = frames[0].sample_rate
        duration_seconds = total_samples / sample_rate

        logger.info(f"[STT] Processing {len(frames)} frames ({duration_seconds:.2f}s) from {participant.identity}")

        if duration_seconds < 0.3:
            logger.info(f"[STT] Skipping {duration_seconds:.2f}s audio from {participant.identity} (< 300ms minimum)")
            return

        # 2. Merge frames into WAV file in memory
        logger.debug(f"[TRANSCRIBE] Creating WAV file in memory...")
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)  # mono
            wav_file.setsampwidth(2)  # 16-bit PCM
            wav_file.setframerate(sample_rate)
            for frame in frames:
                wav_file.writeframes(frame.data)
        buffer.seek(0)
        buffer.name = "audio.wav"  # Required by OpenAI API
        logger.debug(f"[TRANSCRIBE] WAV file created: {len(buffer.getvalue())} bytes")

        # 3. Call OpenAI with retry logic (NON-BLOCKING via to_thread)
        logger.info(f"[STT] Sending {duration_seconds:.2f}s audio to Whisper API for {participant.identity}")
        start_time = time.time()

        for attempt in range(3):
            try:
                logger.info(f"[WHISPER] Calling Azure OpenAI Whisper API (model: {self.stt_model}, attempt {attempt + 1}/3) for {participant.identity}...")
                # CRITICAL: asyncio.to_thread prevents blocking other participants
                # Without this, User B's audio would be lost while waiting for User A's transcription
                transcript = await asyncio.to_thread(
                    self.openai_client.audio.transcriptions.create,
                    model=self.stt_model,
                    file=buffer,
                    language="en",
                )

                elapsed = time.time() - start_time
                logger.info(f"[STT] Whisper response in {elapsed:.2f}s for {participant.identity}")

                # 4. Emit event
                if transcript.text:
                    logger.info(f"[STT] Transcription from {participant.identity}: \"{transcript.text}\"")
                    await self.bus.emit(
                        "TRANSCRIPTION",
                        {
                            "user": participant.identity,
                            "text": transcript.text,
                            "timestamp": time.time(),
                            "participant_identity": participant.identity,
                        },
                    )
                else:
                    logger.warning(f"[STT] Empty transcription from Whisper for {participant.identity}")
                break

            except Exception as e:
                if attempt < 2:
                    logger.warning(f"[STT] Whisper API error (attempt {attempt + 1}/3) for {participant.identity}: {e}")
                    await asyncio.sleep(5)  # 5-second flat backoff
                else:
                    logger.error(f"[STT] Failed to transcribe after 3 attempts for {participant.identity}: {e}")
                    # Don't raise - continue processing other audio
