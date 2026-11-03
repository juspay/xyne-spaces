"""Service-to-service authentication for the OCR wrapper.

Callers (the xyne backend and workers) prove they are internal by sending the
shared OCR_S2S_KEY in the ``x-s2s-key`` header, the same contract xyne-claw-auth
uses for XYNE_CLAW_S2S_KEY. Only ``/health`` stays open, for the kubelet probes.

The check fails closed: when OCR_S2S_KEY is unset every protected request is
rejected, so a missing secret never leaves the service open. Every rejection is
the same opaque 401, and the comparison is constant-time.
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header, HTTPException

from config import settings

S2S_HEADER = "x-s2s-key"


def s2s_key_matches(provided: str | None, expected: str) -> bool:
    """Constant-time comparison; False when either side is empty."""
    if not expected or not provided:
        return False
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def require_s2s_key(
    x_s2s_key: Annotated[str | None, Header(alias=S2S_HEADER)] = None,
) -> None:
    """FastAPI dependency guarding every route except /health."""
    if not s2s_key_matches(x_s2s_key, settings.s2s_key):
        raise HTTPException(status_code=401, detail="Unauthorized")
