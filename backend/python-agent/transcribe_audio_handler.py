"""
Route handler for low-latency voice dictation transcription.

Registered by health_server.py:
  POST /transcribe-audio -> transcribe_audio
"""

import asyncio
import base64
import json
import os
import tempfile
import traceback
from typing import Optional, Tuple

import aiohttp
from aiohttp import web
from google.auth import load_credentials_from_file
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
from openai import AzureOpenAI

from config import Config, get_logger
from infra import get_user_registry

logger = get_logger(__name__)

_azure_client: Optional[AzureOpenAI] = None
_azure_client_key: Optional[Tuple[str, str, str]] = None
_azure_model_name: Optional[str] = None


def _get_azure_client_and_model() -> Tuple[AzureOpenAI, str]:
    """Create or reuse Azure OpenAI client from current environment config."""
    global _azure_client, _azure_client_key, _azure_model_name

    cfg = Config.load()
    if not cfg.azure_stt_endpoint or not cfg.azure_stt_api_key or not cfg.azure_stt_model:
        raise ValueError("Azure STT is not configured (AZURE_OPENAI_STT_*)")

    current_key = (cfg.azure_stt_endpoint, cfg.azure_stt_api_key, cfg.azure_stt_api_version)
    if _azure_client is None or _azure_client_key != current_key:
        _azure_client = AzureOpenAI(
            azure_endpoint=cfg.azure_stt_endpoint,
            api_key=cfg.azure_stt_api_key,
            api_version=cfg.azure_stt_api_version,
        )
        _azure_client_key = current_key
        _azure_model_name = cfg.azure_stt_model

    return _azure_client, _azure_model_name or cfg.azure_stt_model


def _infer_suffix(filename: Optional[str], content_type: str) -> str:
    if filename and '.' in filename:
        ext = os.path.splitext(filename)[1].lower()
        if ext in {'.wav', '.ogg', '.mp3', '.webm', '.m4a', '.mp4'}:
            return ext

    if 'ogg' in content_type:
        return '.ogg'
    if 'mpeg' in content_type or 'mp3' in content_type:
        return '.mp3'
    if 'webm' in content_type:
        return '.webm'
    if 'mp4' in content_type or 'm4a' in content_type:
        return '.m4a'
    return '.wav'


def _first_language(language: str, fallback: str) -> str:
    value = (language or fallback).strip()
    if not value:
        return 'en-US'
    if ',' in value:
        return value.split(',')[0].strip() or 'en-US'
    return value


def _transcribe_file_with_azure(path: str, model: str, language: Optional[str]):
    client, _ = _get_azure_client_and_model()
    with open(path, 'rb') as audio_file:
        kwargs = {
            'model': model,
            'file': audio_file,
        }
        if language:
            kwargs['language'] = language
        return client.audio.transcriptions.create(**kwargs)


# Domain-specific hot words — kept in sync with multi_user_transcriber.py
_HOT_WORDS = [
    "Xyne Calls", "Juspay Euler", "Namma Cloud", "Xyne Chats",
    "Xyne Tickets", "Juspay Hyperswitch", "Xyne Support",
    "Namma Yatri", "Xyne Spaces", "Juspay", "Xyne Code",
    "Xyne Training", "Namma Bengaluru", "Xyne Automatic",
    "Juspay Payments Operating System", "Xyne AI",
    "Xyne Assistant", "Namma Shuttle", "Xyne Agent",
    "Xyne Bot", "Juspay Technologies", "Namma Switch",
]


def _load_google_credentials_info(cfg: Config) -> dict:
    logger.debug('[google] Loading credentials info')
    if cfg.google_voice_credentials_json:
        try:
            return json.loads(cfg.google_voice_credentials_json)
        except json.JSONDecodeError as e:
            raise ValueError(f'Invalid GOOGLE_VOICE_CREDENTIALS_JSON: {e}') from e

    credentials_file = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if not credentials_file:
        raise ValueError('Google STT requires GOOGLE_VOICE_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS')

    try:
        with open(credentials_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        raise ValueError(f'Failed to read GOOGLE_APPLICATION_CREDENTIALS: {e}') from e


async def _transcribe_with_google(
    path: str,
    cfg: Config,
    requested_language: Optional[str],
    extra_hints: Optional[list] = None,
) -> Tuple[str, str, str]:
    credentials_info = _load_google_credentials_info(cfg)

    # project_id: prefer value from credentials JSON (service-account format),
    # fall back to GCS_PROJECT_ID which is always set in config.
    project_id = credentials_info.get('project_id') or cfg.gcs_project_id
    if not project_id:
        raise ValueError(
            'Google STT requires a project_id — set GCS_PROJECT_ID in .env or use a service-account credentials file'
        )

    target_language = _first_language(requested_language or '', cfg.google_stt_language)
    # location="us" matches multi_user_transcriber.py exactly — chirp models live in the
    # "us" multi-region endpoint, not "global" and not the full region name "us-central1".
    _GOOGLE_LOCATION = 'us'
    logger.info(
        f'[google] Starting transcription | project={project_id} | location={_GOOGLE_LOCATION} | model={cfg.google_stt_model}'
        f' | language={target_language} | hints={len(extra_hints or [])} extra'
    )

    # Load credentials using google.auth so both service-account JSON and ADC
    # (authorized_user) formats are handled correctly.
    credentials_file = (
        None
        if cfg.google_voice_credentials_json  # inline JSON path: write to tmp file
        else os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    )

    if cfg.google_voice_credentials_json:
        # Write the inline JSON to a temporary file that google.auth can read
        import tempfile as _tf
        with _tf.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as _f:
            _f.write(cfg.google_voice_credentials_json)
            credentials_file = _f.name

    if credentials_file:
        creds, _ = load_credentials_from_file(
            credentials_file,
            scopes=['https://www.googleapis.com/auth/cloud-platform'],
        )
    else:
        # Last resort: build from the parsed dict (service-account only)
        creds = service_account.Credentials.from_service_account_info(
            credentials_info,
            scopes=['https://www.googleapis.com/auth/cloud-platform'],
        )

    if not creds.valid:
        logger.debug('[google] Refreshing credentials token')
        await asyncio.to_thread(creds.refresh, GoogleAuthRequest())
    else:
        logger.debug('[google] Credentials token still valid, skipping refresh')

    with open(path, 'rb') as audio_file:
        audio_data = audio_file.read()
        content_b64 = base64.b64encode(audio_data).decode('utf-8')

    file_size_kb = len(audio_data) / 1024

    # Build speechAdaptation phrase set from hot_words + dynamic per-request hints
    all_hints = list(_HOT_WORDS) + (extra_hints or [])
    seen: set = set()
    phrases = []
    for term in all_hints:
        key = term.lower()
        if key not in seen:
            seen.add(key)
            phrases.append({'value': term, 'boost': 10})

    payload = {
        'config': {
            'autoDecodingConfig': {},
            'languageCodes': [target_language],
            'model': cfg.google_stt_model,
            'adaptation': {'phraseSets': [{'inlinePhraseSet': {'phrases': phrases[:500]}}]},
        },
        'content': content_b64,
    }

    # location="us" matches multi_user_transcriber.py exactly — chirp models live in the
    # "us" multi-region endpoint, not "global" and not the full region name "us-central1".
    _api_host = f'{_GOOGLE_LOCATION}-speech.googleapis.com'
    url = f'https://{_api_host}/v2/projects/{project_id}/locations/{_GOOGLE_LOCATION}/recognizers/_:recognize'
    timeout = aiohttp.ClientTimeout(total=60)
    logger.info(
        f'[google] POST {url} | file={file_size_kb:.1f}KB'
        f' | phrases={len(phrases[:500])} (hot_words={len(_HOT_WORDS)} + hints={len(extra_hints or [])})'
    )
    import time as _time
    _t0 = _time.monotonic()

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            url,
            headers={
                'Authorization': f'Bearer {creds.token}',
                'Content-Type': 'application/json',
            },
            json=payload,
        ) as response:
            body = await response.json(content_type=None)

    elapsed_ms = (_time.monotonic() - _t0) * 1000
    logger.info(f'[google] Response | status={response.status} | elapsed={elapsed_ms:.0f}ms')

    if response.status >= 400:
        error_message = body.get('error', {}).get('message') if isinstance(body, dict) else None
        logger.error(f'[google] STT API error | status={response.status} | detail={error_message or body}')
        raise ValueError(f'Google STT failed ({response.status}): {error_message or body}')

    results = body.get('results', []) if isinstance(body, dict) else []
    chunks = []
    for result in results:
        alternatives = result.get('alternatives', [])
        if alternatives:
            transcript = alternatives[0].get('transcript', '')
            if transcript:
                chunks.append(transcript)

    final_text = ' '.join(chunks).strip()
    logger.info(f'[google] Transcript ready | chars={len(final_text)} | results={len(results)}')
    return final_text, target_language, cfg.google_stt_model


async def _transcribe_with_deepgram(
    path: str,
    cfg: Config,
    requested_language: Optional[str],
    extra_hints: Optional[list] = None,
) -> Tuple[str, str, str]:
    if not cfg.deepgram_api_key:
        raise ValueError('Deepgram STT selected but DEEPGRAM_API_KEY is not configured')

    target_language = _first_language(requested_language or '', cfg.deepgram_language)
    logger.info(
        f'[deepgram] Starting transcription | model={cfg.deepgram_model}'
        f' | language={target_language} | hints={len(extra_hints or [])} extra'
    )

    with open(path, 'rb') as audio_file:
        audio_bytes = audio_file.read()

    file_size_kb = len(audio_bytes) / 1024

    # Build deduplicated keyword list: static hot_words + dynamic per-request hints
    all_hints = list(_HOT_WORDS) + (extra_hints or [])
    seen: set = set()
    deduped_hints = []
    for term in all_hints:
        key = term.lower()
        if key not in seen:
            seen.add(key)
            deduped_hints.append(term)

    is_nova3 = cfg.deepgram_model.startswith('nova-3')
    logger.debug(f'[deepgram] Model family | nova3={is_nova3} | keyword_param={"keyterms" if is_nova3 else "keywords"}')

    params: dict = {
        'model': cfg.deepgram_model,
        'language': target_language,
        'punctuate': 'true',
        'smart_format': 'true',
    }
    if is_nova3:
        # Nova-3 uses plain keyterms
        for term in deduped_hints:
            params.setdefault('keyterms', []).append(term)
    else:
        # Older models use keyword:boost tuples
        for term in deduped_hints:
            params.setdefault('keywords', []).append(f'{term}:10')

    timeout = aiohttp.ClientTimeout(total=60)
    import time as _time
    _t0 = _time.monotonic()
    hint_count = len(params.get('keyterms', params.get('keywords', [])))
    logger.info(f'[deepgram] POST https://api.deepgram.com/v1/listen | file={file_size_kb:.1f}KB | hints={hint_count}')
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(
            'https://api.deepgram.com/v1/listen',
            params=params,
            headers={
                'Authorization': f'Token {cfg.deepgram_api_key}',
                'Content-Type': 'application/octet-stream',
            },
            data=audio_bytes,
        ) as response:
            body = await response.json(content_type=None)

    elapsed_ms = (_time.monotonic() - _t0) * 1000
    logger.info(f'[deepgram] Response | status={response.status} | elapsed={elapsed_ms:.0f}ms')

    if response.status >= 400:
        error_message = body.get('err_msg') if isinstance(body, dict) else None
        logger.error(f'[deepgram] STT API error | status={response.status} | detail={error_message or body}')
        raise ValueError(f'Deepgram STT failed ({response.status}): {error_message or body}')

    transcript = ''
    if isinstance(body, dict):
        channels = body.get('results', {}).get('channels', [])
        if channels:
            alternatives = channels[0].get('alternatives', [])
            if alternatives:
                transcript = (alternatives[0].get('transcript') or '').strip()

    logger.info(f'[deepgram] Transcript ready | chars={len(transcript)}')
    return transcript, target_language, cfg.deepgram_model


async def transcribe_audio(request):
    """
    POST /transcribe-audio

    multipart/form-data:
      - audio: binary audio payload
      - language: optional language code
    """
    import time as _time
    _request_start = _time.monotonic()
    logger.info('[transcribe_audio] Request received')
    tmp_path = None
    try:
        reader = await request.multipart()
        language = ''
        extra_hints: list = []

        while True:
            field = await reader.next()
            if field is None:
                break

            if field.name == 'audio':
                filename = field.filename
                content_type = field.headers.get('Content-Type', '')
                suffix = _infer_suffix(filename, content_type)

                with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                    tmp_path = tmp.name
                    while True:
                        chunk = await field.read_chunk(65536)
                        if not chunk:
                            break
                        tmp.write(chunk)
            elif field.name == 'language':
                language_value = (await field.text()).strip()
                if language_value:
                    language = language_value
            elif field.name == 'hints':
                # JSON-encoded string[] of workspace user names from the frontend.
                # Kept for backwards compatibility but the registry is the
                # authoritative source — these are only used as a fallback.
                hints_raw = (await field.text()).strip()
                if hints_raw:
                    try:
                        parsed = json.loads(hints_raw)
                        extra_hints = parsed if isinstance(parsed, list) else []
                    except (json.JSONDecodeError, ValueError):
                        extra_hints = []

        if not tmp_path:
            logger.warning('[transcribe_audio] No audio field in multipart payload')
            return web.json_response({'error': "Expected multipart field 'audio'"}, status=400)

        file_size = os.path.getsize(tmp_path)
        if file_size == 0:
            logger.warning('[transcribe_audio] Uploaded audio is empty')
            return web.json_response({'error': 'Uploaded audio is empty'}, status=400)

        cfg = Config.load()
        selected_provider = (cfg.voice_input_stt_model or cfg.stt_model or 'azure').lower()

        # Fetch all workspace user names from the registry (TTL-cached, 5 min refresh).
        # Falls back to frontend-provided hints if the registry returns nothing
        # (e.g. backend not yet reachable on first boot).
        registry = get_user_registry(cfg.backend_url, cfg.transcription_agent_api_key)
        registry_names = await registry.get_names()
        if registry_names:
            extra_hints = registry_names
            logger.debug(f'[transcribe_audio] Using registry hints | count={len(registry_names)}')
        elif extra_hints:
            logger.debug(f'[transcribe_audio] Registry empty — falling back to frontend hints | count={len(extra_hints)}')
        else:
            logger.debug('[transcribe_audio] No user hints available')

        logger.info(
            f'[transcribe_audio] Parsed request | provider={selected_provider}'
            f' | file={file_size / 1024:.1f}KB | language={language or "(default)"}'
            f' | hints={len(extra_hints)}'
        )

        if selected_provider == 'google':
            text, resolved_language, model_name = await _transcribe_with_google(tmp_path, cfg, language, extra_hints)
        elif selected_provider == 'deepgram':
            text, resolved_language, model_name = await _transcribe_with_deepgram(tmp_path, cfg, language, extra_hints)
        else:
            _, model_name = _get_azure_client_and_model()
            # Use the same language normalisation as Google/Deepgram so comma-separated
            # lists (e.g. "en-US,es-ES") don't reach the Azure API verbatim.
            azure_language = _first_language(language, 'en') if language else None
            logger.info(f'[azure] Starting transcription | model={model_name} | language={azure_language}')
            transcript = await asyncio.to_thread(
                _transcribe_file_with_azure,
                tmp_path,
                model_name,
                azure_language,
            )
            text = (getattr(transcript, 'text', '') or '').strip()
            resolved_language = azure_language or 'en'
            selected_provider = 'azure'
            logger.info(f'[azure] Transcript ready | chars={len(text)}')

        total_ms = (_time.monotonic() - _request_start) * 1000
        logger.info(
            f'[transcribe_audio] Done | provider={selected_provider} | model={model_name}'
            f' | language={resolved_language} | chars={len(text)} | total={total_ms:.0f}ms'
        )
        return web.json_response(
            {
                'text': text,
                'language': resolved_language,
                'provider': selected_provider,
                'model': model_name,
            }
        )

    except ValueError as e:
        logger.error(f'[transcribe_audio] Config/validation error: {e}')
        return web.json_response({'error': str(e)}, status=500)
    except Exception as e:
        logger.error(f'[transcribe_audio] Unexpected error: {type(e).__name__}: {e}\n{traceback.format_exc()}')
        return web.json_response({'error': f'{type(e).__name__}: {e}'}, status=500)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
