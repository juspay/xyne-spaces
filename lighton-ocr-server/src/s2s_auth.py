"""Service-to-service authentication for the OCR wrapper.

Callers prove they are internal by sending a shared key in the ``x-s2s-key``
header, the same header xyne-spaces uses for its other internal services. Two
keys are accepted:

- ``OCR_S2S_KEY``: the OCR service's own key, for services outside xyne-spaces.
- ``INTERNAL_S2S_KEY``: the fallback. xyne-spaces' backend and workers send their
  existing internal key, so they need no OCR-specific secret.

Only ``/health`` stays open, for the kubelet probes and the load-balancer check.
The check fails closed: a key that is unset is never accepted, so with neither
set every protected request is rejected. Every rejection is the same opaque 401,
and each comparison is constant-time.
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


def accepted_keys() -> list[str]:
    """OCR_S2S_KEY first, then the INTERNAL_S2S_KEY fallback; unset keys are skipped."""
    return [key for key in (settings.s2s_key, settings.internal_s2s_key) if key]


def require_s2s_key(
    x_s2s_key: Annotated[str | None, Header(alias=S2S_HEADER)] = None,
) -> None:
    """FastAPI dependency guarding every route except /health."""
    # Compare against every accepted key (no early exit), so the response time
    # doesn't reveal which key, if any, matched.
    matches = [s2s_key_matches(x_s2s_key, key) for key in accepted_keys()]
    if not any(matches):
        raise HTTPException(status_code=401, detail="Unauthorized")
