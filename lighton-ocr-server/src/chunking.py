"""Simple token-aware markdown chunking with Docling-compatible output."""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from models import DocumentChunk, TocEntry

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

    from tokenization import OffsetTokenizer

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass(frozen=True)
class OcrPage:
    page_number: int
    markdown: str


@dataclass(frozen=True)
class _PageSpan:
    page_number: int
    start: int
    end: int


@dataclass(frozen=True)
class _HeadingEvent:
    position: int
    headings: list[str]


class MarkdownTokenChunker:
    def __init__(
        self,
        tokenizer: OffsetTokenizer,
        *,
        max_tokens: int,
        overlap_tokens: int,
    ) -> None:
        if max_tokens <= 0:
            raise ValueError("max_tokens must be positive")
        if overlap_tokens < 0:
            raise ValueError("overlap_tokens must be non-negative")
        if overlap_tokens >= max_tokens:
            raise ValueError("overlap_tokens must be smaller than max_tokens")
        self.tokenizer = tokenizer
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def chunk_pages(self, pages: Sequence[OcrPage]) -> list[DocumentChunk]:
        combined, page_spans = _combine_pages(pages)
        if not combined.strip():
            return []

        offsets = self.tokenizer.encode_offsets(combined)
        if not offsets:
            return []

        heading_events = _heading_events(combined)
        event_positions = [event.position for event in heading_events]
        chunks: list[DocumentChunk] = []
        start_token = 0

        while start_token < len(offsets):
            end_token = min(start_token + self.max_tokens, len(offsets))
            char_start = offsets[start_token][0]
            char_end = offsets[end_token - 1][1]
            text = combined[char_start:char_end].strip()
            if text:
                chunks.append(
                    DocumentChunk(
                        text=text,
                        headings=_headings_for_span(
                            heading_events,
                            event_positions,
                            char_start,
                            char_end,
                        ),
                        page_numbers=_pages_for_span(page_spans, char_start, char_end),
                        bbox=None,
                    )
                )
            if end_token >= len(offsets):
                break
            start_token = max(end_token - self.overlap_tokens, start_token + 1)

        return chunks


class StreamingMarkdownTokenChunker:
    """Token chunker that keeps only an open token window between pages."""

    def __init__(
        self,
        tokenizer: OffsetTokenizer,
        *,
        max_tokens: int,
        overlap_tokens: int,
    ) -> None:
        if max_tokens <= 0:
            raise ValueError("max_tokens must be positive")
        if overlap_tokens < 0:
            raise ValueError("overlap_tokens must be non-negative")
        if overlap_tokens >= max_tokens:
            raise ValueError("overlap_tokens must be smaller than max_tokens")
        self.tokenizer = tokenizer
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens
        self._buffer = ""
        self._page_spans: list[_PageSpan] = []
        self._default_headings: list[str] = []

    def add_page(self, page: OcrPage) -> list[DocumentChunk]:
        text = (page.markdown or "").strip()
        if not text:
            return []
        if self._buffer:
            self._buffer += "\n\n"
        start = len(self._buffer)
        self._buffer += text
        self._page_spans.append(_PageSpan(page.page_number, start, len(self._buffer)))
        return self._emit_ready_chunks()

    def finish(self) -> list[DocumentChunk]:
        if not self._buffer.strip():
            self._buffer = ""
            self._page_spans = []
            return []

        offsets = self.tokenizer.encode_offsets(self._buffer)
        if not offsets:
            return []
        events = _heading_events(self._buffer)
        positions = [event.position for event in events]
        text = self._buffer[offsets[0][0] : offsets[-1][1]].strip()
        chunk = DocumentChunk(
            text=text,
            headings=_headings_for_span_with_default(
                events,
                positions,
                offsets[0][0],
                offsets[-1][1],
                self._default_headings,
            ),
            page_numbers=_pages_for_span(self._page_spans, offsets[0][0], offsets[-1][1]),
            bbox=None,
        )
        self._buffer = ""
        self._page_spans = []
        return [chunk] if chunk.text else []

    def _emit_ready_chunks(self) -> list[DocumentChunk]:
        emitted: list[DocumentChunk] = []
        while True:
            offsets = self.tokenizer.encode_offsets(self._buffer)
            if len(offsets) < self.max_tokens:
                break
            events = _heading_events(self._buffer)
            positions = [event.position for event in events]
            char_start = offsets[0][0]
            char_end = offsets[self.max_tokens - 1][1]
            text = self._buffer[char_start:char_end].strip()
            if text:
                emitted.append(
                    DocumentChunk(
                        text=text,
                        headings=_headings_for_span_with_default(
                            events,
                            positions,
                            char_start,
                            char_end,
                            self._default_headings,
                        ),
                        page_numbers=_pages_for_span(self._page_spans, char_start, char_end),
                        bbox=None,
                    )
                )

            keep_token = self.max_tokens - self.overlap_tokens
            keep_char = offsets[keep_token][0] if keep_token < len(offsets) else char_end
            self._default_headings = _headings_at_position(
                events,
                positions,
                keep_char,
                self._default_headings,
            )
            self._buffer = self._buffer[keep_char:]
            self._page_spans = _shift_page_spans(self._page_spans, keep_char)
        return emitted


def build_toc_from_pages(pages: Iterable[OcrPage]) -> list[TocEntry]:
    entries: list[TocEntry] = []
    for page in pages:
        for line in page.markdown.splitlines():
            match = _HEADING_RE.match(line.strip())
            if not match:
                continue
            title = match.group(2).strip()
            if not title or title.startswith("!"):
                continue
            entries.append(
                TocEntry(
                    section_number="",
                    section_title=title[:200],
                    page_number=page.page_number,
                    level=len(match.group(1)),
                    bbox=None,
                    parent_index=None,
                )
            )
    return normalize_toc_entries(entries)


def normalize_toc_entries(entries: Sequence[TocEntry]) -> list[TocEntry]:
    normalized: list[TocEntry] = []
    for _, original in sorted(enumerate(entries), key=lambda item: (item[1].page_number, item[0])):
        parent_index: int | None = None
        for idx in range(len(normalized) - 1, -1, -1):
            if normalized[idx].level < original.level:
                parent_index = idx
                break
        entry = TocEntry(
            section_number=str(len(normalized) + 1),
            section_title=original.section_title,
            page_number=original.page_number,
            level=original.level,
            bbox=original.bbox,
            parent_index=parent_index,
        )
        normalized.append(entry)
    return normalized


def _combine_pages(pages: Sequence[OcrPage]) -> tuple[str, list[_PageSpan]]:
    parts: list[str] = []
    spans: list[_PageSpan] = []
    cursor = 0
    for page in pages:
        text = (page.markdown or "").strip()
        if not text:
            continue
        if parts:
            parts.append("\n\n")
            cursor += 2
        start = cursor
        parts.append(text)
        cursor += len(text)
        spans.append(_PageSpan(page.page_number, start, cursor))
    return "".join(parts), spans


def _heading_events(text: str) -> list[_HeadingEvent]:
    events: list[_HeadingEvent] = []
    stack: list[tuple[int, str]] = []
    cursor = 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        match = _HEADING_RE.match(stripped)
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            stack = [(lvl, name) for lvl, name in stack if lvl < level]
            stack.append((level, title))
            events.append(_HeadingEvent(cursor, [name for _, name in stack]))
        cursor += len(line)
    return events


def _headings_for_span(
    events: Sequence[_HeadingEvent],
    positions: Sequence[int],
    char_start: int,
    char_end: int,
) -> list[str]:
    if not events:
        return []
    idx = bisect.bisect_right(positions, char_start) - 1
    if idx >= 0:
        return list(events[idx].headings)
    idx = bisect.bisect_left(positions, char_start)
    if idx < len(events) and events[idx].position < char_end:
        return list(events[idx].headings)
    return []


def _headings_for_span_with_default(
    events: Sequence[_HeadingEvent],
    positions: Sequence[int],
    char_start: int,
    char_end: int,
    default: Sequence[str],
) -> list[str]:
    headings = _headings_for_span(events, positions, char_start, char_end)
    return headings or list(default)


def _headings_at_position(
    events: Sequence[_HeadingEvent],
    positions: Sequence[int],
    position: int,
    default: Sequence[str],
) -> list[str]:
    idx = bisect.bisect_right(positions, position) - 1
    if idx >= 0:
        return list(events[idx].headings)
    return list(default)


def _pages_for_span(spans: Sequence[_PageSpan], char_start: int, char_end: int) -> list[int]:
    pages = [span.page_number for span in spans if char_end > span.start and char_start < span.end]
    return pages or ([spans[0].page_number] if spans else [1])


def _shift_page_spans(spans: Sequence[_PageSpan], removed_chars: int) -> list[_PageSpan]:
    return [
        _PageSpan(
            page_number=span.page_number,
            start=max(0, span.start - removed_chars),
            end=span.end - removed_chars,
        )
        for span in spans
        if span.end > removed_chars
    ]
