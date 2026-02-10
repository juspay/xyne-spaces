"""Logging configuration"""
import contextvars
import logging
from typing import Optional, MutableMapping, Any, Tuple

# Context variable to store the current call_id
_call_id_ctx = contextvars.ContextVar("call_id", default=None)


def set_call_id(call_id: str) -> None:
    """Set the call_id for the current context (async-safe)."""
    _call_id_ctx.set(call_id)


def get_call_id() -> Optional[str]:
    """Get the current call_id."""
    return _call_id_ctx.get()


class ContextAwareAdapter(logging.LoggerAdapter):
    """
    Logger adapter that automatically injects [call_id] into log messages
    if it's set in the current context.
    """
    def process(self, msg: Any, kwargs: MutableMapping[str, Any]) -> Tuple[Any, MutableMapping[str, Any]]:
        call_id = get_call_id()
        if call_id:
            return f"[{call_id}] {msg}", kwargs
        return msg, kwargs


def setup_logging():
    """Configure logging for the application.
    
    Uses force=True to ensure our configuration takes precedence
    even if livekit-agents has already configured logging.
    """
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
        force=True,  # Override any existing configuration
    )


def get_logger(name: str) -> logging.LoggerAdapter:
    """Get a context-aware logger instance
    
    Args:
        name: Logger name (typically __name__)
    
    Returns:
        Configured logger adapter
    """
    logger = logging.getLogger(name)
    return ContextAwareAdapter(logger, {})
