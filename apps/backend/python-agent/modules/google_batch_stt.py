"""
Google Speech-to-Text v2 BatchRecognize provider for whole-file transcription.

BatchRecognize is the only v2 method that takes long audio (up to 8 h) and the only
one that supports speaker diarization with Chirp 3 — but it reads audio exclusively
from Cloud Storage. So this provider:

  upload the local file to a scratch GCS object -> batch_recognize(inline results)
  -> await the long-running operation -> format text (speaker-labelled when
  diarization ran) -> delete the scratch object (always, in `finally`).

The scratch object is the only copy of the recording we ever write; it lives for the
duration of one job. Put a short lifecycle rule on RECORDING_GCS_PREFIX as a backstop
for crashed jobs, and grant the Speech-to-Text service agent
(service-<project-number>@gcp-sa-speech.iam.gserviceaccount.com) read access to the
bucket — batchRecognize reads the object with that identity, not with ours.

Errors are raised as google.api_core exceptions (classified by the caller) or as
ValueError("Google STT failed (<status>): ...") for per-file errors reported inside
an otherwise successful operation, mirroring the synchronous helper.
"""

import asyncio
import os
import time
import uuid
from typing import List, Optional, Tuple

from google.api_core import exceptions as gexc
from google.api_core.client_options import ClientOptions
from google.auth import load_credentials_from_file
from google.cloud import storage
from google.cloud.speech_v2 import SpeechAsyncClient
from google.cloud.speech_v2.types import (
    AutoDetectDecodingConfig,
    BatchRecognizeFileMetadata,
    BatchRecognizeRequest,
    InlineOutputConfig,
    PhraseSet,
    RecognitionConfig,
    RecognitionFeatures,
    RecognitionOutputConfig,
    SpeakerDiarizationConfig,
    SpeechAdaptation,
)

from config import Config, get_logger
from transcribe_audio_handler import (
    _GOOGLE_BATCH_PHRASE_LIMIT,
    _HOT_WORDS,
    _build_google_credentials,
)

logger = get_logger(__name__)

# Chirp 3 speaker diarization is GA for exactly these locales (docs: chirp_3-model,
# "Speaker diarization"). Requesting it for any other language is INVALID_ARGUMENT.
DIARIZATION_LANGUAGES = frozenset({
    "cmn-hans-cn", "de-de", "en-gb", "en-in", "en-us", "es-es", "es-us",
    "fr-ca", "fr-fr", "hi-in", "it-it", "ja-jp", "ko-kr", "pt-br",
})

# Google documents "up to three languages" per request, but Chirp 3 BatchRecognize
# answers any 3-code list with a bare "500 An internal error occurred" per file,
# with or without adaptation, while every 1- or 2-code list works (verified
# 2026-09-25 on real Ozonetel audio: kn-IN, en-IN, kn-IN+en-IN, en-IN+hi-IN ok;
# kn-IN+en-IN+hi-IN and en-US+en-IN+hi-IN fail). Extra codes are dropped with a warning.
MAX_LANGUAGE_CODES = 2

# gRPC status code -> HTTP-ish status, so the caller's "STT failed (NNN)" classifier
# (retry on 429/5xx, permanent on 400/415) keeps working for per-file errors.
_GRPC_TO_HTTP = {
    3: 400,   # INVALID_ARGUMENT
    4: 504,   # DEADLINE_EXCEEDED
    5: 404,   # NOT_FOUND
    7: 403,   # PERMISSION_DENIED
    8: 429,   # RESOURCE_EXHAUSTED
    10: 409,  # ABORTED
    13: 500,  # INTERNAL
    14: 503,  # UNAVAILABLE
}

_CONTENT_TYPES = {
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac", ".ogg": "audio/ogg",
    ".oga": "audio/ogg", ".opus": "audio/ogg", ".webm": "audio/webm", ".m4a": "audio/mp4",
    ".mp4": "audio/mp4", ".aac": "audio/aac", ".amr": "audio/amr",
}


def language_codes(language: str, cfg: Config) -> List[str]:
    """Comma-separated request/config language -> de-duplicated list for the API.

    Chirp 3 accepts several codes per request (it picks per utterance) and the
    special value "auto" for language identification.
    """
    raw = (language or cfg.google_stt_language or "en-US").split(",")
    codes: List[str] = []
    for item in raw:
        code = item.strip()
        if code and code not in codes:
            codes.append(code)
    if not codes:
        return ["en-US"]
    if any(c.lower() == "auto" for c in codes):
        return ["auto"]
    if len(codes) > MAX_LANGUAGE_CODES:
        logger.warning(f"[google-batch] {len(codes)} language codes given, using the first {MAX_LANGUAGE_CODES}: {codes[:MAX_LANGUAGE_CODES]}")
        codes = codes[:MAX_LANGUAGE_CODES]
    return codes


def diarization_supported(codes: List[str]) -> bool:
    return all(c.lower() in DIARIZATION_LANGUAGES for c in codes)


def _storage_client(cfg: Config, speech_creds, speech_project: str) -> storage.Client:
    """Client for the scratch bucket.

    Uses the same storage credentials as the transcription bucket (GCS_CREDENTIALS_PATH
    + GCS_PROJECT_ID) when configured — that identity already owns the buckets in the
    storage project. Falls back to the Speech credentials otherwise. The Speech API
    reads the object separately, as its own project's service agent.
    """
    if cfg.gcs_credentials_path:
        creds, _ = load_credentials_from_file(
            cfg.gcs_credentials_path,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        return storage.Client(project=cfg.gcs_project_id or speech_project, credentials=creds)
    return storage.Client(project=cfg.gcs_project_id or speech_project, credentials=speech_creds)


def _build_adaptation() -> Optional[SpeechAdaptation]:
    phrases = [PhraseSet.Phrase(value=term, boost=10) for term in _HOT_WORDS]
    if not phrases:
        return None
    return SpeechAdaptation(
        phrase_sets=[
            SpeechAdaptation.AdaptationPhraseSet(
                inline_phrase_set=PhraseSet(phrases=phrases[:_GOOGLE_BATCH_PHRASE_LIMIT]),
            )
        ]
    )


def _build_request(
    recognizer: str,
    gs_uri: str,
    cfg: Config,
    codes: List[str],
    diarize: bool,
) -> BatchRecognizeRequest:
    features = RecognitionFeatures(enable_automatic_punctuation=True)
    if diarize:
        features.diarization_config = SpeakerDiarizationConfig(
            min_speaker_count=max(1, int(cfg.recording_google_min_speakers)),
            max_speaker_count=max(int(cfg.recording_google_min_speakers), int(cfg.recording_google_max_speakers)),
        )
    config = RecognitionConfig(
        auto_decoding_config=AutoDetectDecodingConfig(),
        language_codes=codes,
        model=cfg.google_stt_model,
        features=features,
    )
    # Language identification ("auto") plus a phrase set makes Chirp 3 batch fail
    # with a bare 500; the same request without adaptation works (verified 2026-09-25).
    adaptation = None if codes == ["auto"] else _build_adaptation()
    if adaptation is not None:
        config.adaptation = adaptation

    request = BatchRecognizeRequest(
        recognizer=recognizer,
        config=config,
        files=[BatchRecognizeFileMetadata(uri=gs_uri)],
        recognition_output_config=RecognitionOutputConfig(inline_response_config=InlineOutputConfig()),
    )
    if cfg.recording_google_dynamic_batch:
        request.processing_strategy = BatchRecognizeRequest.ProcessingStrategy.DYNAMIC_BATCHING
    return request


def format_transcript(results) -> Tuple[str, bool]:
    """(text, diarized). One line per speaker turn when word-level speaker labels
    are present, otherwise the segment transcripts joined with spaces."""
    turns: List[Tuple[str, List[str]]] = []
    plain: List[str] = []
    labelled = False

    for result in results:
        if not result.alternatives:
            continue
        alt = result.alternatives[0]
        segment = (alt.transcript or "").strip()
        if segment:
            plain.append(segment)
        for word in alt.words:
            label = (word.speaker_label or "").strip()
            token = (word.word or "").strip()
            if not label or not token:
                continue
            labelled = True
            if turns and turns[-1][0] == label:
                turns[-1][1].append(token)
            else:
                turns.append((label, [token]))

    if labelled:
        lines = [f"Speaker {label}: {' '.join(tokens)}" for label, tokens in turns if tokens]
        return "\n".join(lines).strip(), True
    return " ".join(plain).strip(), False


async def transcribe_with_google_batch(
    path: str,
    cfg: Config,
    language: str,
    job_id: str = "",
) -> Tuple[str, str, str]:
    """Whole-file transcription via BatchRecognize. Returns (text, language, model)."""
    tag = f"[google-batch] jobId={job_id or '-'}"
    creds, project_id = await _build_google_credentials(cfg)

    bucket_name = cfg.recording_gcs_bucket or cfg.gcs_bucket_name
    if not bucket_name:
        raise ValueError("Google batch STT requires RECORDING_GCS_BUCKET or GCS_BUCKET_NAME")
    prefix = (cfg.recording_gcs_prefix or "").strip("/")
    suffix = os.path.splitext(path)[1].lower()
    object_name = f"{prefix + '/' if prefix else ''}{job_id or 'recording'}-{uuid.uuid4().hex[:8]}{suffix}"
    gs_uri = f"gs://{bucket_name}/{object_name}"

    location = cfg.google_stt_location or "us"
    client_options = (
        ClientOptions(api_endpoint=f"{location}-speech.googleapis.com")
        if location != "global" else None
    )
    recognizer = f"projects/{project_id}/locations/{location}/recognizers/_"

    codes = language_codes(language, cfg)
    diarize = bool(cfg.recording_google_diarization) and diarization_supported(codes)
    if cfg.recording_google_diarization and not diarize:
        logger.info(f"{tag} | diarization skipped: not supported for languages={codes}")

    blob = _storage_client(cfg, creds, project_id).bucket(bucket_name).blob(object_name)
    size = os.path.getsize(path)

    started = time.monotonic()
    logger.info(
        f"{tag} | upload | uri={gs_uri} | bytes={size} | model={cfg.google_stt_model}"
        f" | languages={codes} | diarize={diarize} | dynamic_batch={bool(cfg.recording_google_dynamic_batch)}"
    )
    try:
        await asyncio.to_thread(
            blob.upload_from_filename,
            path,
            content_type=_CONTENT_TYPES.get(suffix, "application/octet-stream"),
        )
        upload_s = time.monotonic() - started

        speech = SpeechAsyncClient(credentials=creds, client_options=client_options)
        try:
            response = await _run_batch(speech, _build_request(recognizer, gs_uri, cfg, codes, diarize), cfg, tag)
        except gexc.InvalidArgument as e:
            if not diarize:
                raise
            # Diarization is the most likely rejected option (model/locale combos move
            # under us); one retry without it costs nothing but latency.
            logger.warning(f"{tag} | INVALID_ARGUMENT with diarization, retrying without | {e.message}")
            diarize = False
            response = await _run_batch(speech, _build_request(recognizer, gs_uri, cfg, codes, False), cfg, tag)

        file_result = response.results.get(gs_uri)
        if file_result is None:
            raise ValueError(f"Google STT failed (500): no result returned for {gs_uri}")
        if file_result.error and file_result.error.code:
            http_status = _GRPC_TO_HTTP.get(file_result.error.code, 500)
            raise ValueError(f"Google STT failed ({http_status}): {file_result.error.message}")

        # Newer clients report inline transcripts under inline_result; `transcript`
        # is the deprecated top-level alias. Read whichever is populated.
        inline = getattr(file_result, "inline_result", None)
        batch_results = inline.transcript if inline and inline.transcript.results else file_result.transcript
        text, diarized = format_transcript(batch_results.results)
        logger.info(
            f"{tag} | done | chars={len(text)} | diarized={diarized}"
            f" | results={len(batch_results.results)} | upload={upload_s:.1f}s"
            f" | total={time.monotonic() - started:.1f}s"
        )
        return text, codes[0], cfg.google_stt_model
    finally:
        try:
            await asyncio.to_thread(blob.delete)
        except gexc.NotFound:
            pass
        except Exception as e:  # noqa: BLE001 — best effort; lifecycle rule is the backstop
            logger.warning(f"{tag} | failed to delete scratch object {gs_uri}: {e}")


async def _run_batch(speech: SpeechAsyncClient, request: BatchRecognizeRequest, cfg: Config, tag: str):
    operation = await speech.batch_recognize(request=request)
    logger.info(f"{tag} | operation started | name={operation.operation.name}")
    timeout_s = max(60, int(cfg.recording_google_batch_timeout_s))
    try:
        return await operation.result(timeout=timeout_s)
    except (asyncio.TimeoutError, TimeoutError) as e:
        # Do not let the generic retry re-submit a job that already took this long.
        from modules.recording_transcriber import TranscriptionError
        raise TranscriptionError(
            "transcription_failed",
            f"Google batch operation did not finish within {timeout_s}s",
            False,
        ) from e


__all__ = [
    "DIARIZATION_LANGUAGES",
    "diarization_supported",
    "format_transcript",
    "language_codes",
    "transcribe_with_google_batch",
]
