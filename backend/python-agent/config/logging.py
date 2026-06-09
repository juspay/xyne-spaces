"""Logging configuration"""
import contextvars
import json
import logging
import os
import time
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
    Logger adapter that automatically injects call_id into log records
    if it's set in the current context.

    In production (JSON) logs, call_id becomes a top-level field so it is
    directly queryable without regex. In dev plain-text logs it still appears
    as a [call_id] prefix in the message for readability.
    """
    def process(self, msg: Any, kwargs: MutableMapping[str, Any]) -> Tuple[Any, MutableMapping[str, Any]]:
        call_id = get_call_id()
        if call_id:
            # Inject call_id as a structured field so JSON formatters emit it
            # as a top-level key. Also keep the [call_id] prefix in the message
            # so dev plain-text logs remain readable without the extra fields.
            extra = dict(kwargs.get('extra') or {})
            extra['call_id'] = call_id
            kwargs['extra'] = extra
            return f"[{call_id}] {msg}", kwargs
        return msg, kwargs


# LogRecord attributes that are part of the standard record structure and
# should not be forwarded as extra structured fields.
_LOG_RECORD_BUILTINS = frozenset({
    'msg', 'args', 'created', 'msecs', 'relativeCreated', 'thread',
    'threadName', 'process', 'processName', 'filename', 'module',
    'funcName', 'lineno', 'levelno', 'levelname', 'pathname', 'name',
    'exc_info', 'exc_text', 'stack_info', 'message',
})


class _JsonFormatter(logging.Formatter):
    """Emits each log record as a single-line JSON object.

    Fields from ``extra={}`` passed to logger calls are promoted to top-level
    JSON keys so they can be queried directly without regex in log aggregators.
    """

    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        entry: dict = {
            'timestamp': self.formatTime(record, self.datefmt),
            'level': record.levelname,
            'logger': record.name,
            'message': record.message,
        }
        for key, val in record.__dict__.items():
            if key not in _LOG_RECORD_BUILTINS:
                entry[key] = val
        if record.exc_info:
            entry['exc_info'] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def setup_logging():
    """Configure logging for the application.
    
    Uses force=True to ensure our configuration takes precedence
    even if livekit-agents has already configured logging.
    In production (APP_ENV=production) emits newline-delimited JSON so that
    every key=value pair is a first-class field rather than an embedded string.
    """
    env = os.getenv('APP_ENV', 'development')
    if env == 'production':
        formatter = _JsonFormatter(datefmt='%Y-%m-%dT%H:%M:%SZ')
        formatter.converter = time.gmtime  # ensure timestamps are UTC, matching the Z suffix
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    else:
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
            force=True,
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
