"""Shared dataclasses for OCR processing."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DocumentChunk:
    text: str
    headings: list[str]
    page_numbers: list[int]
    bbox: dict[str, float] | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "text": self.text,
            "headings": self.headings,
            "page_numbers": self.page_numbers,
            "bbox": self.bbox,
        }


@dataclass(frozen=True)
class ImageChunk:
    text: str
    image_base64: str
    page_number: int
    bbox: dict[str, float] | None = None
    width: int | None = None
    height: int | None = None


@dataclass(frozen=True)
class TocEntry:
    section_number: str
    section_title: str
    page_number: int
    level: int
    bbox: dict[str, float] | None = None
    parent_index: int | None = None


@dataclass(frozen=True)
class RenderedPage:
    page_number: int
    image: object
    width: int
    height: int


@dataclass(frozen=True)
class DetectedRegion:
    refs: tuple[str, ...]
    bbox: dict[str, float]
    pixel_bbox: tuple[int, int, int, int]
    width: int
    height: int
    start: int = 0
    end: int = 0


@dataclass
class PageOcrResult:
    page_number: int
    markdown: str
    raw_markdown: str
    image_chunks: list[ImageChunk] = field(default_factory=list)
    image_regions_detected: int = 0
    crop_ocr_attempted: int = 0
    crop_ocr_success: int = 0
    crop_ocr_failed: int = 0
    crop_ocr_skipped: int = 0
    crop_ocr_skipped_small: int = 0
