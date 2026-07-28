"""Tokenizer adapter with offset support for exact markdown slicing."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

TokenOffsets = list[tuple[int, int]]


class OffsetTokenizer:
    """Tokenize text and return token offsets without requiring model weights."""

    def __init__(self, tokenizer_path: str | None = None) -> None:
        self._tokenizer = self._load_tokenizer(tokenizer_path)
        self.backend = "fallback" if self._tokenizer is None else "tokenizers"

    def encode_offsets(self, text: str) -> TokenOffsets:
        text = text or ""
        if not text:
            return []
        if self._tokenizer is not None:
            try:
                encoded = self._tokenizer.encode(text)
                offsets = [(int(start), int(end)) for start, end in encoded.offsets if end > start]
                if offsets:
                    return offsets
            except Exception:
                return _fallback_offsets(text)
        return _fallback_offsets(text)

    def count(self, text: str) -> int:
        return len(self.encode_offsets(text))

    @staticmethod
    def _load_tokenizer(tokenizer_path: str | None) -> Any:
        if not tokenizer_path:
            return None
        path = Path(tokenizer_path)
        tokenizer_file = path / "tokenizer.json" if path.is_dir() else path
        if not tokenizer_file.is_file():
            return None
        try:
            from tokenizers import Tokenizer

            return Tokenizer.from_file(str(tokenizer_file))
        except Exception:
            return None


def _fallback_offsets(text: str) -> TokenOffsets:
    # This is only a local/test fallback. Production should mount the E5
    # tokenizer.json so token counts match embedding.
    matches = list(re.finditer(r"\S+", text))
    if matches:
        return [(match.start(), match.end()) for match in matches]
    return [(0, max(1, math.ceil(len(text) / 4)))] if text else []
