"""
Simple HTTP health endpoint server for the transcription agent.
Runs alongside the LiveKit agent to provide health checks and the enrollment endpoint.

Routes
------
GET  /health      -> health_check  (liveness probe)
GET  /            -> health_check
POST /embed-voice -> embed_voice   (speaker enrollment, handled by embed_voice_server)
"""
import asyncio
from aiohttp import web
from config import get_logger

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

    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, host, port)
    await site.start()

    # Warm the speaker model in the background — don't block server startup
    asyncio.create_task(_warm_speaker_model())

    logger.info(f"Health server started on http://{host}:{port}")
    logger.info(f"Health endpoint available at http://{host}:{port}/health")

    # Keep the server running
    return runner


async def stop_health_server(runner):
    """Stop the health check server"""
    await runner.cleanup()
    logger.info("Health server stopped")
