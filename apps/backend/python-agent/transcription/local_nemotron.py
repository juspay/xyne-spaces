"""Local Nemotron ASR adapter for LiveKit's batch STT interface."""

import asyncio
import logging
import time
from typing import Any, Optional, Tuple

import numpy as np
from livekit.agents import stt


logger = logging.getLogger(__name__)


class LocalNemotronSTT(stt.STT):
    """Run NVIDIA Nemotron 3.5 ASR locally on VAD-delimited utterances."""

    _shared_models: dict[tuple[str, str, bool], tuple[Any, Any, str, Any]] = {}
    _load_locks: dict[tuple[str, str, bool], asyncio.Lock] = {}

    def __init__(
        self,
        *,
        model_id: str,
        language: str = "auto",
        device: str = "auto",
        allow_download: bool = True,
    ) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(streaming=False, interim_results=False)
        )
        self._model_id = model_id
        self._language = language
        self._requested_device = device
        self._allow_download = allow_download
        self._inference_lock = asyncio.Lock()

    @property
    def _cache_key(self) -> tuple[str, str, bool]:
        return (self._model_id, self._requested_device, self._allow_download)

    async def warmup(self) -> None:
        """Load the processor and model before participant audio arrives."""
        started = time.perf_counter()
        logger.info(
            "local_stt_warmup_started | model=%s, requested_device=%s, allow_download=%s",
            self._model_id,
            self._requested_device,
            self._allow_download,
        )
        await self._ensure_loaded()
        logger.info(
            "local_stt_warmup_completed | model=%s, elapsed_ms=%.1f",
            self._model_id,
            (time.perf_counter() - started) * 1000,
        )

    def _select_device(self, torch: Any) -> str:
        if self._requested_device != "auto":
            return self._requested_device
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    async def _ensure_loaded(self) -> tuple[Any, Any, str, Any]:
        cached = self._shared_models.get(self._cache_key)
        if cached is not None:
            return cached

        lock = self._load_locks.setdefault(self._cache_key, asyncio.Lock())
        async with lock:
            cached = self._shared_models.get(self._cache_key)
            if cached is not None:
                return cached
            loaded = await asyncio.to_thread(self._load_model)
            self._shared_models[self._cache_key] = loaded
            return loaded

    def _load_model(self) -> tuple[Any, Any, str, Any]:
        import torch
        from transformers import AutoModelForRNNT, AutoProcessor

        started = time.perf_counter()
        device = self._select_device(torch)
        dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
        logger.info(
            "local_stt_model_load_started | model=%s, device=%s, dtype=%s, local_only=%s",
            self._model_id,
            device,
            dtype,
            not self._allow_download,
        )
        try:
            processor = AutoProcessor.from_pretrained(
                self._model_id,
                local_files_only=not self._allow_download,
            )
            model = AutoModelForRNNT.from_pretrained(
                self._model_id,
                dtype=dtype,
                local_files_only=not self._allow_download,
            )
            model.to(device)
            model.eval()
        except Exception:
            logger.exception(
                "local_stt_model_load_failed | model=%s, device=%s",
                self._model_id,
                device,
            )
            raise

        sample_rate = processor.feature_extractor.sampling_rate
        parameter_count = sum(parameter.numel() for parameter in model.parameters())
        logger.info(
            "local_stt_model_ready | model=%s, device=%s, dtype=%s, sample_rate=%s, "
            "parameters=%s, elapsed_ms=%.1f",
            self._model_id,
            device,
            dtype,
            sample_rate,
            parameter_count,
            (time.perf_counter() - started) * 1000,
        )
        return processor, model, device, dtype

    @staticmethod
    def _frames_to_float_audio(
        buffer: Any, target_rate: int
    ) -> Tuple[np.ndarray, int, int, float]:
        # LiveKit's AudioBuffer accepts either one AudioFrame or a list of
        # frames. Agents 1.6.x commonly sends a single combined AudioFrame.
        frames = [buffer] if hasattr(buffer, "data") else list(buffer)
        if not frames:
            return np.empty(0, dtype=np.float32), target_rate, 1, 0.0

        source_rate = int(frames[0].sample_rate)
        channels = int(frames[0].num_channels)
        chunks = []
        total_samples_per_channel = 0
        for frame in frames:
            pcm = np.frombuffer(frame.data, dtype=np.int16)
            frame_channels = int(frame.num_channels)
            if frame_channels > 1:
                pcm = pcm.reshape(-1, frame_channels).mean(axis=1)
            chunks.append(pcm.astype(np.float32) / 32768.0)
            total_samples_per_channel += int(frame.samples_per_channel)

        audio = np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)
        duration = total_samples_per_channel / source_rate if source_rate else 0.0
        if source_rate != target_rate and audio.size:
            output_size = max(1, round(audio.size * target_rate / source_rate))
            positions = np.linspace(0, audio.size - 1, output_size)
            audio = np.interp(positions, np.arange(audio.size), audio).astype(np.float32)
        return audio, source_rate, channels, duration

    def _transcribe_sync(
        self, audio: np.ndarray, processor: Any, model: Any, device: str, dtype: Any
    ) -> tuple[str, float, float]:
        import torch

        preprocess_started = time.perf_counter()
        inputs = processor(
            audio,
            sampling_rate=processor.feature_extractor.sampling_rate,
            language=self._language,
            return_tensors="pt",
        )
        inputs = inputs.to(device, dtype=dtype)
        preprocess_ms = (time.perf_counter() - preprocess_started) * 1000

        inference_started = time.perf_counter()
        with torch.inference_mode():
            output = model.generate(**inputs, return_dict_in_generate=True)
        inference_ms = (time.perf_counter() - inference_started) * 1000
        decoded = processor.decode(output.sequences, skip_special_tokens=True)
        # Transformers currently returns a list for batched RNNT sequences, while
        # some processor versions return a string for a single sequence.
        if isinstance(decoded, (list, tuple)):
            text = str(decoded[0]).strip() if decoded else ""
        else:
            text = str(decoded).strip()
        return text, preprocess_ms, inference_ms

    async def _recognize_impl(
        self,
        buffer: Any,
        *,
        language: Optional[str] = None,
        conn_options: Any = None,
    ) -> stt.SpeechEvent:
        del conn_options
        processor, model, device, dtype = await self._ensure_loaded()
        target_rate = int(processor.feature_extractor.sampling_rate)
        audio, source_rate, channels, duration = self._frames_to_float_audio(
            buffer, target_rate
        )
        started = time.perf_counter()
        logger.info(
            "local_stt_transcription_started | model=%s, audio_seconds=%.3f, "
            "source_rate=%s, target_rate=%s, channels=%s, samples=%s",
            self._model_id,
            duration,
            source_rate,
            target_rate,
            channels,
            audio.size,
        )

        if audio.size == 0:
            text, preprocess_ms, inference_ms, queue_ms = "", 0.0, 0.0, 0.0
        else:
            queue_started = time.perf_counter()
            async with self._inference_lock:
                queue_ms = (time.perf_counter() - queue_started) * 1000
                if queue_ms >= 10:
                    logger.info("local_stt_inference_queue_wait | wait_ms=%.1f", queue_ms)
                try:
                    text, preprocess_ms, inference_ms = await asyncio.to_thread(
                        self._transcribe_sync,
                        audio,
                        processor,
                        model,
                        device,
                        dtype,
                    )
                except Exception:
                    logger.exception(
                        "local_stt_transcription_failed | model=%s, audio_seconds=%.3f, device=%s",
                        self._model_id,
                        duration,
                        device,
                    )
                    raise

        total_ms = (time.perf_counter() - started) * 1000
        rtf = (inference_ms / 1000) / duration if duration else 0.0
        logger.info(
            "local_stt_transcription_completed | model=%s, language=%s, chars=%s, empty=%s, "
            "queue_ms=%.1f, preprocessing_ms=%.1f, inference_ms=%.1f, total_ms=%.1f, rtf=%.3f",
            self._model_id,
            language or self._language,
            len(text),
            not bool(text),
            queue_ms,
            preprocess_ms,
            inference_ms,
            total_ms,
            rtf,
        )
        logger.debug("local_stt_transcript | text=%r", text)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                stt.SpeechData(language=language or self._language, text=text)
            ],
        )
