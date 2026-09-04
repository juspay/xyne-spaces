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
from aiohttp import web
from config import get_logger, Config
from transcribe_audio_handler import transcribe_audio, transcribe_stream_ws
from infra import get_user_registry

from embed_voice_handler import embed_voice

logger = get_logger(__name__)


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
