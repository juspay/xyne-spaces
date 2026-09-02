"""
Simple HTTP health endpoint server for the transcription agent.
Runs alongside the LiveKit agent to provide health checks and the enrollment endpoint.

Routes
------
GET  /health      -> health_check  (liveness probe)
GET  /            -> health_check
POST /embed-voice -> embed_voice   (speaker enrollment, handled by embed_voice_server)
POST /transcribe-audio -> transcribe_audio (voice dictation STT)
"""
import asyncio
import logging
import aiohttp
from aiohttp import web
from config import get_logger, Config
from transcribe_audio_handler import transcribe_audio, transcribe_stream_ws
from infra import get_user_registry

from embed_voice_handler import embed_voice

logger = get_logger(__name__)

REGISTER_AGENT_MAX_ATTEMPTS = 3
REGISTER_AGENT_RETRY_INITIAL_SECONDS = 30
REGISTER_AGENT_RETRY_MAX_SECONDS = 600  # 10 minutes

# health_server's background thread (and this task with it) starts before main.py calls
# cli.run_app(...) — the call that actually registers this process as a worker with the
# LiveKit server. Without this delay, the first attempt below can fire the backend's
# live-verification dispatch before LiveKit even knows this worker exists yet, causing a
# spurious "not claimed" rejection that has nothing to do with the build being bad. A
# worker's register handshake over its persistent connection is normally sub-second to a
# couple seconds; this is a heuristic cushion, not an exact signal — same tradeoff as the
# ~9s dispatch-claim-check delay used elsewhere in this flow.
REGISTER_AGENT_STARTUP_DELAY_SECONDS = 8


async def _register_agent() -> None:
    """
    One-time on-startup call telling the backend "I'm agentName=X, please consider me
    for role=Y" — both values from this pod's own env vars, never human-typed. Logs at
    error level from the very first failed attempt (not just after repeated ones) so
    whatever log-based alerting is watching this service's output fires immediately,
    rather than only after a human happens to notice. Retries up to
    REGISTER_AGENT_MAX_ATTEMPTS times on a growing backoff, then gives up for good and
    logs one final diagnostic line with the last-seen failure reason — this build then
    relies on the human-facing fallback (POST /internal/transcription-agent/rollout) to
    ever become eligible, since nothing keeps retrying in the background past this point.
    The backend still independently live-verifies against LiveKit before committing
    anything to its table — this call is just the trigger, not proof of life.
    """
    cfg = Config.load()
    if not cfg.backend_url or not cfg.transcription_agent_api_key:
        logger.error("[register_agent] misconfigured | reason=backend_url_or_api_key_not_configured")
        return

    url = f"{cfg.backend_url}/api/transcriptionAgent/register-agent"
    headers = {"x-api-key": cfg.transcription_agent_api_key, "Content-Type": "application/json"}
    payload = {"agentName": cfg.transcription_agent_name, "role": cfg.transcription_agent_role}

    await asyncio.sleep(REGISTER_AGENT_STARTUP_DELAY_SECONDS)

    last_reason: str | None = None
    for attempt in range(1, REGISTER_AGENT_MAX_ATTEMPTS + 1):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    body = await response.json()
                    if response.status == 200 and body.get("success"):
                        logger.info(
                            f"[register_agent] registered | agent_name={cfg.transcription_agent_name}, role={cfg.transcription_agent_role}, attempt={attempt}"
                        )
                        return
                    last_reason = body.get("reason") or body.get("error") or f"http_{response.status}"
                    logger.error(
                        f"[register_agent] rejected | status={response.status}, body={body}, attempt={attempt}/{REGISTER_AGENT_MAX_ATTEMPTS}"
                    )
        except Exception as e:
            last_reason = f"{type(e).__name__}: {e}"
            logger.error(
                f"[register_agent] failed | agent_name={cfg.transcription_agent_name}, error={e}, attempt={attempt}/{REGISTER_AGENT_MAX_ATTEMPTS}"
            )

        if attempt < REGISTER_AGENT_MAX_ATTEMPTS:
            delay = min(REGISTER_AGENT_RETRY_INITIAL_SECONDS * (2 ** (attempt - 1)), REGISTER_AGENT_RETRY_MAX_SECONDS)
            await asyncio.sleep(delay)

    logger.error(
        f"[register_agent] gave_up | agent_name={cfg.transcription_agent_name}, role={cfg.transcription_agent_role}, "
        f"attempts={REGISTER_AGENT_MAX_ATTEMPTS}, last_reason={last_reason} — will not retry again; "
        f"use POST /internal/transcription-agent/rollout to register this build manually"
    )


async def _warm_user_registry() -> None:
    """Pre-fetch the workspace user list from the backend so the cache is warm
    before the first /transcribe-audio request arrives."""
    logger.info("[warm_user_registry] Starting user registry pre-load")
    try:
        cfg = Config.load()
        logger.debug(f"[warm_user_registry] Fetching from backend_url={cfg.backend_url}")
        registry = get_user_registry(cfg.backend_url, cfg.transcription_agent_api_key)
        names = await registry.get_names()
        logger.info(f"[warm_user_registry] Pre-load complete | {len(names)} user names cached")
    except Exception as e:
        logger.warning(f"[warm_user_registry] Pre-load failed (will retry on first request): {type(e).__name__}: {e}")
async def _warm_speaker_model() -> None:
    """Pre-load the WeSpeaker embedding model in a thread so the event loop
    stays unblocked and the first /embed-voice request responds instantly."""
    cfg = Config.load()
    if not cfg.diarization_enabled:
        logger.info("[warm_speaker_model] Skipped | DIARIZATION_ENABLED=false")
        return

    logger.info("[warm_speaker_model] Starting WeSpeaker model pre-load")
    try:
        from modules.speaker_embedding import get_embedding_inference
        await asyncio.to_thread(get_embedding_inference)
        logger.info("[warm_speaker_model] Speaker embedding model pre-loaded and ready")
    except Exception as e:
        logger.warning(f"[warm_speaker_model] Speaker model pre-load failed (will retry on first request): {e}")


async def health_check(request):
    """Health check endpoint"""
    return web.json_response({
        "status": "healthy",
        "service": "transcription-agent",
        "version": "1.0.0"
    })


async def start_health_server(host: str = "0.0.0.0", port: int = 8080):
    """
    Start the health check HTTP server

    Args:
        host: Host to bind to (default: 0.0.0.0)
        port: Port to bind to (default: 8080)
    """
    app = web.Application()
    app.router.add_get("/health", health_check)
    app.router.add_get("/", health_check)
    app.router.add_post("/transcribe-audio", transcribe_audio)
    app.router.add_post("/embed-voice", embed_voice)
    app.router.add_get("/transcribe-stream", transcribe_stream_ws)

    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, host, port)
    await site.start()

    # Pre-fetch workspace user names for STT hints — don't block server startup
    asyncio.create_task(_warm_user_registry())
    # Self-registration — one-time, up to REGISTER_AGENT_MAX_ATTEMPTS retries in the background
    asyncio.create_task(_register_agent())
    # Warm the speaker model in the background only when diarization is enabled.
    cfg = Config.load()
    logger.info(f"Health server diarization config | enabled={cfg.diarization_enabled}")
    if cfg.diarization_enabled:
        asyncio.create_task(_warm_speaker_model())
    else:
        logger.info("Speaker model warmup disabled | DIARIZATION_ENABLED=false")

    logger.info(f"Health server started on http://{host}:{port}")
    logger.info(f"Health endpoint available at http://{host}:{port}/health")

    # Keep the server running
    return runner


async def stop_health_server(runner):
    """Stop the health check server"""
    await runner.cleanup()
    logger.info("Health server stopped")
