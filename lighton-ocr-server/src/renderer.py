"""Bounded rasterization of PDFs, Office documents, text files, and images."""

from __future__ import annotations

import asyncio
import io
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import TYPE_CHECKING

from PIL import Image, ImageDraw, ImageFont, ImageSequence

from image_utils import normalize_rgb, resize_max_dim
from models import RenderedPage

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterator

SUPPORTED_PDF_SUFFIXES = {".pdf"}
SUPPORTED_IMAGE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".webp",
    ".tif",
    ".tiff",
}
SUPPORTED_OFFICE_SUFFIXES = {".docx", ".pptx"}
SUPPORTED_TEXT_SUFFIXES = {".txt"}
SUPPORTED_SUFFIXES = (
    SUPPORTED_PDF_SUFFIXES
    | SUPPORTED_IMAGE_SUFFIXES
    | SUPPORTED_OFFICE_SUFFIXES
    | SUPPORTED_TEXT_SUFFIXES
)


def is_supported_upload(filename: str) -> bool:
    suffix = Path(filename or "").suffix.lower()
    return suffix in SUPPORTED_SUFFIXES


async def stream_rendered_pages(
    file_path: str,
    *,
    filename: str,
    render_max_dim: int,
    pdf_render_dpi: int,
    max_pages: int,
    queue_size: int,
    office_convert_timeout_seconds: float = 120.0,
    text_page_width: int = 1240,
    text_page_height: int = 1754,
    text_font_size: int = 28,
    text_margin: int = 72,
) -> AsyncIterator[RenderedPage]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue(maxsize=max(1, queue_size))
    stop_event = threading.Event()

    def put(kind: str, payload: object) -> None:
        future = asyncio.run_coroutine_threadsafe(queue.put((kind, payload)), loop)
        future.result()

    def worker() -> None:
        try:
            suffix = Path(filename or file_path).suffix.lower()
            if suffix == ".pdf":
                for page in _iter_pdf_pages(
                    file_path,
                    render_max_dim=render_max_dim,
                    pdf_render_dpi=pdf_render_dpi,
                    max_pages=max_pages,
                    stop_event=stop_event,
                ):
                    put("page", page)
            elif suffix in SUPPORTED_OFFICE_SUFFIXES:
                for page in _iter_office_pages(
                    file_path,
                    render_max_dim=render_max_dim,
                    pdf_render_dpi=pdf_render_dpi,
                    max_pages=max_pages,
                    stop_event=stop_event,
                    timeout_seconds=office_convert_timeout_seconds,
                ):
                    put("page", page)
            elif suffix in SUPPORTED_TEXT_SUFFIXES:
                for page in _iter_text_pages(
                    file_path,
                    max_pages=max_pages,
                    stop_event=stop_event,
                    page_width=text_page_width,
                    page_height=text_page_height,
                    font_size=text_font_size,
                    margin=text_margin,
                ):
                    put("page", page)
            else:
                for page in _iter_image_pages(
                    file_path,
                    render_max_dim=render_max_dim,
                    max_pages=max_pages,
                    stop_event=stop_event,
                ):
                    put("page", page)
        except Exception as exc:
            put("error", exc)
        finally:
            put("done", None)

    thread = threading.Thread(target=worker, name="ocr-renderer", daemon=True)
    thread.start()
    try:
        while True:
            kind, payload = await queue.get()
            if kind == "page":
                yield payload  # type: ignore[misc]
            elif kind == "error":
                raise payload  # type: ignore[misc]
            elif kind == "done":
                break
    finally:
        stop_event.set()
        thread.join(timeout=2.0)


def _iter_pdf_pages(
    file_path: str,
    *,
    render_max_dim: int,
    pdf_render_dpi: int,
    max_pages: int,
    stop_event: threading.Event,
) -> Iterator[RenderedPage]:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is required for PDF rendering") from exc

    with fitz.open(file_path) as document:
        allowed = document.page_count if max_pages < 0 else min(document.page_count, max_pages)
        for index in range(allowed):
            if stop_event.is_set():
                break
            page = document.load_page(index)
            rect = page.rect
            base_scale = pdf_render_dpi / 72.0
            longest_at_base = max(rect.width, rect.height) * base_scale
            if longest_at_base > render_max_dim:
                scale = render_max_dim / max(rect.width, rect.height)
            else:
                scale = base_scale
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            yield RenderedPage(index + 1, img, img.width, img.height)


def _iter_office_pages(
    file_path: str,
    *,
    render_max_dim: int,
    pdf_render_dpi: int,
    max_pages: int,
    stop_event: threading.Event,
    timeout_seconds: float,
) -> Iterator[RenderedPage]:
    soffice = _find_soffice()
    with tempfile.TemporaryDirectory(prefix="lighton-office-") as tmpdir:
        cmd = [
            soffice,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--convert-to",
            "pdf",
            "--outdir",
            tmpdir,
            file_path,
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=max(1.0, timeout_seconds),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("LibreOffice conversion timed out") from exc

        pdf_path = Path(tmpdir) / f"{Path(file_path).stem}.pdf"
        if result.returncode != 0 or not pdf_path.is_file():
            detail = (result.stderr or result.stdout or "unknown conversion error").strip()
            raise RuntimeError(f"LibreOffice failed to rasterize office document: {detail}")

        yield from _iter_pdf_pages(
            str(pdf_path),
            render_max_dim=render_max_dim,
            pdf_render_dpi=pdf_render_dpi,
            max_pages=max_pages,
            stop_event=stop_event,
        )


def _iter_text_pages(
    file_path: str,
    *,
    max_pages: int,
    stop_event: threading.Event,
    page_width: int,
    page_height: int,
    font_size: int,
    margin: int,
) -> Iterator[RenderedPage]:
    raw = Path(file_path).read_bytes()
    text = raw.decode("utf-8", errors="replace").replace("\t", "    ")
    font = _load_text_font(font_size)
    line_spacing = max(4, font_size // 3)
    line_height = _text_height(font) + line_spacing
    usable_width = max(1, page_width - 2 * margin)
    usable_height = max(1, page_height - 2 * margin)
    max_lines_per_page = max(1, usable_height // max(1, line_height))
    wrapped_lines = _wrap_text_lines(text, font, usable_width)
    if not wrapped_lines:
        wrapped_lines = [""]

    allowed = (
        len(wrapped_lines)
        if max_pages < 0
        else min(
            len(wrapped_lines),
            max_pages * max_lines_per_page,
        )
    )
    page_number = 1
    for start in range(0, allowed, max_lines_per_page):
        if stop_event.is_set():
            break
        lines = wrapped_lines[start : start + max_lines_per_page]
        img = Image.new("RGB", (page_width, page_height), "white")
        draw = ImageDraw.Draw(img)
        y = margin
        for line in lines:
            draw.text((margin, y), line, fill="black", font=font)
            y += line_height
        yield RenderedPage(page_number, img, img.width, img.height)
        page_number += 1
        if max_pages >= 0 and page_number > max_pages:
            break


def _iter_image_pages(
    file_path: str,
    *,
    render_max_dim: int,
    max_pages: int,
    stop_event: threading.Event,
) -> Iterator[RenderedPage]:
    with Image.open(file_path) as image:
        limit: int | None = None if max_pages < 0 else max_pages
        for index, frame in enumerate(ImageSequence.Iterator(image)):
            if stop_event.is_set() or (limit is not None and index >= limit):
                break
            img = resize_max_dim(normalize_rgb(frame.copy()), render_max_dim)
            yield RenderedPage(index + 1, img, img.width, img.height)


def _find_soffice() -> str:
    configured = os.getenv("LIBREOFFICE_BIN", "").strip()
    candidates = [
        configured,
        "soffice",
        "libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        resolved = shutil.which(candidate) if os.sep not in candidate else candidate
        if resolved and Path(resolved).exists():
            return resolved
    raise RuntimeError("LibreOffice/soffice is required to rasterize .docx and .pptx files")


def _load_text_font(font_size: int) -> ImageFont.ImageFont:
    configured = os.getenv("OCR_TEXT_FONT_PATH", "").strip()
    candidates = [
        configured,
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            if Path(candidate).is_file():
                return ImageFont.truetype(candidate, font_size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap_text_lines(text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1), "white"))
    lines: list[str] = []
    for source_line in text.splitlines() or [""]:
        if not source_line:
            lines.append("")
            continue
        current = ""
        for word in source_line.split(" "):
            candidate = word if not current else f"{current} {word}"
            if _text_width(draw, candidate, font) <= max_width:
                current = candidate
                continue
            if current:
                lines.append(current)
            current = word
            while current and _text_width(draw, current, font) > max_width:
                prefix = _largest_prefix_that_fits(draw, current, font, max_width)
                lines.append(prefix)
                current = current[len(prefix) :]
        lines.append(current)
    return lines


def _largest_prefix_that_fits(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> str:
    low = 1
    high = len(text)
    best = 1
    while low <= high:
        mid = (low + high) // 2
        if _text_width(draw, text[:mid], font) <= max_width:
            best = mid
            low = mid + 1
        else:
            high = mid - 1
    return text[:best]


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _text_height(font: ImageFont.ImageFont) -> int:
    bbox = ImageDraw.Draw(Image.new("RGB", (1, 1), "white")).textbbox((0, 0), "Ag", font=font)
    return bbox[3] - bbox[1]
