"""
Simple HTTP health endpoint server for the transcription agent
Runs alongside the LiveKit agent to provide health checks for deployment
"""
import logging
from aiohttp import web
from config import get_logger

logger = get_logger(__name__)


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
    app.router.add_get("/", health_check)  # Also respond to root path

    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, host, port)
    await site.start()

    logger.info(f"Health server started on http://{host}:{port}")
    logger.info(f"Health endpoint available at http://{host}:{port}/health")

    # Keep the server running
    return runner


async def stop_health_server(runner):
    """Stop the health check server"""
    await runner.cleanup()
    logger.info("Health server stopped")
