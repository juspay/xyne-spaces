import asyncio
import unittest
from unittest.mock import patch

from chunking import MarkdownTokenChunker
from config import settings
from models import RenderedPage
from processor import OcrProcessor
from tokenization import OffsetTokenizer


class FakeLightOnClient:
    async def ocr_image(self, _image, _prompt):
        return "# Heading\n\nhello world"


async def fake_rendered_pages(*_args, **_kwargs):
    yield RenderedPage(page_number=1, image=object(), width=100, height=100)


class ResponseSchemaTest(unittest.TestCase):
    def test_response_shape_matches_docling_schema(self):
        async def run():
            tokenizer = OffsetTokenizer(None)
            processor = OcrProcessor(
                settings=settings,
                lighton_client=FakeLightOnClient(),
                chunker=MarkdownTokenChunker(
                    tokenizer,
                    max_tokens=460,
                    overlap_tokens=12,
                ),
            )

            with patch("processor.stream_rendered_pages", fake_rendered_pages):
                return await processor.process_document(
                    "example.pdf",
                    filename="example.pdf",
                    doc_id="doc-1",
                )

        result = asyncio.run(run())

        assert set(result) == {"metadata", "toc", "chunks", "image_chunks", "images"}
        assert set(result["metadata"]) == {
            "doc_id",
            "filename",
            "num_pages",
            "num_images",
            "processing_time",
            "has_toc",
            "vlm",
        }
        assert set(result["metadata"]["vlm"]) == {
            "enabled",
            "preset",
            "model",
            "tables_replaced",
            "pictures_replaced",
            "page_ocr_candidates",
            "page_ocr_success",
            "page_ocr_failed",
            "native_chunks_suppressed",
            "picture_ocr_skipped",
            "page_image_regions_detected",
            "crop_ocr_attempted",
            "crop_ocr_success",
            "crop_ocr_failed",
            "crop_ocr_skipped",
            "crop_ocr_skipped_small",
        }
        assert set(result["chunks"][0]) == {"text", "headings", "page_numbers", "bbox"}


if __name__ == "__main__":
    unittest.main()
