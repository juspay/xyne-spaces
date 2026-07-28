"""Top-level LightOn OCR processing pipeline."""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from bbox import (
    filter_regions,
    merge_overlapping_regions,
    parse_lighton_regions,
    strip_lighton_image_markers,
)
from chunking import (
    MarkdownTokenChunker,
    OcrPage,
    build_toc_from_pages,
    normalize_toc_entries,
)
from image_utils import encode_image_jpeg_data_url
from models import DetectedRegion, ImageChunk, PageOcrResult, RenderedPage
from renderer import stream_rendered_pages

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import Callable

    from config import Settings
    from lighton_client import LightOnClient


class OcrProcessor:
    def __init__(
        self,
        *,
        settings: Settings,
        lighton_client: LightOnClient,
        chunker: MarkdownTokenChunker,
        lighton_concurrency_provider: Callable[[], int] | None = None,
    ) -> None:
        self.settings = settings
        self.lighton_client = lighton_client
        self.chunker = chunker
        self.lighton_concurrency_provider = lighton_concurrency_provider

    async def process_document(
        self,
        file_path: str,
        *,
        filename: str,
        doc_id: str,
        set_stage: Callable[[str], None] = lambda _stage: None,
    ) -> dict[str, Any]:
        start = time.time()
        file_size = Path(file_path).stat().st_size if Path(file_path).exists() else -1
        logger.info(
            "[processor] start doc_id=%s filename=%s file_size_bytes=%d",
            doc_id, filename, file_size,
        )
        set_stage("render_ocr")
        pending: dict[asyncio.Task[PageOcrResult], int] = {}
        completed: dict[int, PageOcrResult] = {}
        next_page_to_commit = 1
        total_pages = 0
        chunks = []
        toc_entries = []
        image_chunks: list[ImageChunk] = []
        page_ocr_success: list[int] = []
        page_ocr_failed: list[int] = []
        crop_stats = _empty_crop_stats()
        render_queue_size = self._current_lighton_concurrency()

        def commit_ready_pages() -> None:
            nonlocal next_page_to_commit
            while next_page_to_commit in completed:
                result = completed.pop(next_page_to_commit)
                _add_crop_stats(crop_stats, result)
                image_chunks.extend(result.image_chunks)
                if result.markdown.strip():
                    page_ocr_success.append(result.page_number)
                    ocr_page = OcrPage(
                        page_number=result.page_number,
                        markdown=result.markdown,
                    )
                    chunks.extend(self.chunker.chunk_pages([ocr_page]))
                    toc_entries.extend(build_toc_from_pages([ocr_page]))
                else:
                    page_ocr_failed.append(result.page_number)
                next_page_to_commit += 1

        try:
            async for page in stream_rendered_pages(
                file_path,
                filename=filename,
                render_max_dim=self.settings.render_max_dim,
                pdf_render_dpi=self.settings.pdf_render_dpi,
                max_pages=self.settings.max_pages,
                queue_size=render_queue_size,
                office_convert_timeout_seconds=self.settings.office_convert_timeout_seconds,
                text_page_width=self.settings.text_page_width,
                text_page_height=self.settings.text_page_height,
                text_font_size=self.settings.text_font_size,
                text_margin=self.settings.text_margin,
            ):
                total_pages += 1
                logger.info(
                    "[processor] queuing page doc_id=%s page=%d size=%dx%d pending=%d",
                    doc_id, page.page_number, page.width, page.height, len(pending),
                )
                task = asyncio.create_task(self._process_page(page))
                pending[task] = page.page_number
                while len(pending) >= self._current_lighton_concurrency():
                    for result in await _drain_one(pending):
                        completed[result.page_number] = result
                    commit_ready_pages()

            while pending:
                for result in await _drain_one(pending):
                    completed[result.page_number] = result
                commit_ready_pages()
        except Exception as exc:
            logger.error(
                "[processor] failed doc_id=%s filename=%s elapsed=%.2fs error=%s",
                doc_id, filename, time.time() - start, exc,
            )
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending.keys(), return_exceptions=True)
            raise

        if total_pages == 0:
            raise RuntimeError("No renderable pages found in the provided file")

        set_stage("chunking")
        toc = normalize_toc_entries(toc_entries)
        processing_time = round(time.time() - start, 2)
        logger.info(
            "[processor] done doc_id=%s filename=%s pages=%d chunks=%d image_chunks=%d"
            " ocr_success=%d ocr_failed=%d elapsed=%.2fs",
            doc_id, filename, total_pages, len(chunks), len(image_chunks),
            len(page_ocr_success), len(page_ocr_failed), processing_time,
        )

        return {
            "metadata": {
                "doc_id": doc_id,
                "filename": Path(filename or file_path).name,
                "num_pages": total_pages,
                "num_images": len(image_chunks),
                "processing_time": processing_time,
                "has_toc": bool(toc),
                "vlm": {
                    "enabled": True,
                    "preset": "lightonocr",
                    "model": self.settings.lighton_model,
                    "tables_replaced": 0,
                    "pictures_replaced": 0,
                    "page_ocr_candidates": list(range(1, total_pages + 1)),
                    "page_ocr_success": page_ocr_success,
                    "page_ocr_failed": page_ocr_failed,
                    "native_chunks_suppressed": 0,
                    "picture_ocr_skipped": 0,
                    **crop_stats,
                },
            },
            "toc": {
                "entries": [
                    {
                        "section_number": entry.section_number,
                        "section_title": entry.section_title,
                        "page_number": entry.page_number,
                        "level": entry.level,
                        "bbox": entry.bbox,
                        "parent_index": entry.parent_index,
                    }
                    for entry in toc
                ]
            },
            "chunks": [chunk.to_dict() for chunk in chunks],
            "image_chunks": [
                {
                    "text": item.text,
                    "page_number": item.page_number,
                    "bbox": item.bbox,
                    "width": item.width,
                    "height": item.height,
                }
                for item in image_chunks
            ],
            "images": {f"img_{idx}": item.image_base64 for idx, item in enumerate(image_chunks)},
        }

    async def _process_page(self, page: RenderedPage) -> PageOcrResult:
        page_start = time.time()
        logger.info("[processor] ocr_start page=%d size=%dx%d", page.page_number, page.width, page.height)
        raw_markdown = await self.lighton_client.ocr_image(
            page.image,
            self.settings.lighton_prompt,
        )
        logger.info(
            "[processor] ocr_done page=%d markdown_len=%d elapsed=%.2fs",
            page.page_number, len(raw_markdown), time.time() - page_start,
        )
        parsed_regions = parse_lighton_regions(
            raw_markdown,
            (page.width, page.height),
            padding_pixels=self.settings.crop_padding_pixels,
            max_regions=self.settings.max_image_regions_per_page,
        )
        merged_regions = merge_overlapping_regions(parsed_regions)
        regions, skipped_small, skipped_limit = filter_regions(
            merged_regions,
            min_width=self.settings.min_crop_width,
            min_height=self.settings.min_crop_height,
            min_area=self.settings.min_crop_area,
            max_regions=self.settings.max_crops_per_page,
        )

        result = PageOcrResult(
            page_number=page.page_number,
            markdown=strip_lighton_image_markers(raw_markdown),
            raw_markdown=raw_markdown,
            image_regions_detected=len(parsed_regions),
            crop_ocr_skipped=skipped_small + skipped_limit,
            crop_ocr_skipped_small=skipped_small,
        )
        result.crop_ocr_attempted = len(regions)

        logger.info(
            "[processor] page=%d regions_detected=%d regions_to_crop=%d skipped=%d",
            page.page_number, len(parsed_regions), len(regions),
            skipped_small + skipped_limit,
        )
        if regions:
            crop_tasks = [self._ocr_crop(page, region) for region in regions]
            crop_results = await asyncio.gather(*crop_tasks, return_exceptions=True)
            for crop_result in crop_results:
                if isinstance(crop_result, Exception):
                    logger.warning("[processor] crop_ocr_failed page=%d error=%s", page.page_number, crop_result)
                    result.crop_ocr_failed += 1
                    continue
                if crop_result is None:
                    result.crop_ocr_failed += 1
                    continue
                result.crop_ocr_success += 1
                result.image_chunks.extend(crop_result)

        logger.info(
            "[processor] page_done page=%d markdown_len=%d crop_success=%d crop_failed=%d elapsed=%.2fs",
            page.page_number, len(result.markdown), result.crop_ocr_success,
            result.crop_ocr_failed, time.time() - page_start,
        )
        return result

    async def _ocr_crop(
        self,
        page: RenderedPage,
        region: DetectedRegion,
    ) -> list[ImageChunk] | None:
        crop = page.image.crop(region.pixel_bbox)
        text = await self.lighton_client.ocr_image(crop, self.settings.lighton_crop_prompt)
        text = strip_lighton_image_markers(text)
        text_chunks = _split_text_tokens(
            text,
            tokenizer=self.chunker.tokenizer,
            max_tokens=self.settings.image_chunk_max_tokens,
        )
        if not text_chunks or all(_is_placeholder(item) for item in text_chunks):
            return None
        image_base64 = encode_image_jpeg_data_url(
            crop,
            max_dim=self.settings.image_max_dim,
            quality=self.settings.jpeg_quality,
        )
        return [
            ImageChunk(
                text=item,
                image_base64=image_base64,
                page_number=page.page_number,
                bbox=region.bbox,
                width=region.width,
                height=region.height,
            )
            for item in text_chunks
            if not _is_placeholder(item)
        ]

    def _current_lighton_concurrency(self) -> int:
        if self.lighton_concurrency_provider is None:
            return max(1, self.settings.lighton_concurrency)
        try:
            return max(1, int(self.lighton_concurrency_provider()))
        except Exception:
            return max(1, self.settings.lighton_concurrency)


async def _drain_one(pending: dict[asyncio.Task[PageOcrResult], int]) -> list[PageOcrResult]:
    done, _ = await asyncio.wait(pending.keys(), return_when=asyncio.FIRST_COMPLETED)
    results: list[PageOcrResult] = []
    for task in done:
        pending.pop(task, None)
        results.append(await task)
    return results


def _aggregate_crop_stats(results: list[PageOcrResult]) -> dict[str, int]:
    return {
        "page_image_regions_detected": sum(item.image_regions_detected for item in results),
        "crop_ocr_attempted": sum(item.crop_ocr_attempted for item in results),
        "crop_ocr_success": sum(item.crop_ocr_success for item in results),
        "crop_ocr_failed": sum(item.crop_ocr_failed for item in results),
        "crop_ocr_skipped": sum(item.crop_ocr_skipped for item in results),
        "crop_ocr_skipped_small": sum(item.crop_ocr_skipped_small for item in results),
    }


def _empty_crop_stats() -> dict[str, int]:
    return {
        "page_image_regions_detected": 0,
        "crop_ocr_attempted": 0,
        "crop_ocr_success": 0,
        "crop_ocr_failed": 0,
        "crop_ocr_skipped": 0,
        "crop_ocr_skipped_small": 0,
    }


def _add_crop_stats(stats: dict[str, int], result: PageOcrResult) -> None:
    stats["page_image_regions_detected"] += result.image_regions_detected
    stats["crop_ocr_attempted"] += result.crop_ocr_attempted
    stats["crop_ocr_success"] += result.crop_ocr_success
    stats["crop_ocr_failed"] += result.crop_ocr_failed
    stats["crop_ocr_skipped"] += result.crop_ocr_skipped
    stats["crop_ocr_skipped_small"] += result.crop_ocr_skipped_small


def _is_placeholder(text: str) -> bool:
    stripped = (text or "").strip()
    return not stripped or stripped == "<!-- missing-text -->"


def _split_text_tokens(text: str, *, tokenizer: Any, max_tokens: int) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    offsets = tokenizer.encode_offsets(text)
    if not offsets:
        return []

    chunks: list[str] = []
    start_token = 0
    while start_token < len(offsets):
        end_token = min(start_token + max_tokens, len(offsets))
        chunk = text[offsets[start_token][0] : offsets[end_token - 1][1]].strip()
        if chunk:
            chunks.append(chunk)
        start_token = end_token
    return chunks
