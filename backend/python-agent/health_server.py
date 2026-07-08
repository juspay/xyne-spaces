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
from aiohttp import web
from config import get_logger, Config
from transcribe_audio_handler import transcribe_audio, transcribe_stream_ws
from infra import get_user_registry

from embed_voice_handler import embed_voice

logger = get_logger(__name__)


async def _warm_speaker_model() -> None:
    """Pre-load the WeSpeaker embedding model in a thread so the event loop
    stays unblocked and the first /embed-voice request responds instantly."""
    try:
        from modules.speaker_embedding import get_embedding_inference
        await asyncio.to_thread(get_embedding_inference)
        logger.info("Speaker embedding model pre-loaded and ready")
    except Exception as e:
        logger.warning(f"Speaker model pre-load failed (will retry on first request): {e}")


async def _warm_user_registry() -> None:
    """Pre-fetch the workspace user list from the backend so the cache is warm
    before the first /transcribe-audio request arrives."""
    try:
        cfg = Config.load()
        registry = get_user_registry(cfg.backend_url, cfg.transcription_agent_api_key)
        names = await registry.get_names()
        logger.info(f"User registry pre-loaded | {len(names)} user names cached")
    except Exception as e:
        logger.warning(f"User registry pre-load failed (will retry on first request): {e}")


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
    app.router.add_post("/embed-voice", embed_voice)
    app.router.add_post("/transcribe-audio", transcribe_audio)
    app.router.add_get("/transcribe-stream", transcribe_stream_ws)

    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, host, port)
    await site.start()

    # Warm the speaker model in the background — don't block server startup
    asyncio.create_task(_warm_speaker_model())
    # Pre-fetch workspace user names for STT hints — don't block server startup
    asyncio.create_task(_warm_user_registry())

    logger.info(f"Health server started on http://{host}:{port}")
    logger.info(f"Health endpoint available at http://{host}:{port}/health")

    # Keep the server running
    return runner


async def stop_health_server(runner):
    """Stop the health check server"""
    await runner.cleanup()
    logger.info("Health server stopped")
