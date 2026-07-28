import asyncio
import unittest
from dataclasses import replace
from unittest.mock import patch

from PIL import Image

from chunking import MarkdownTokenChunker
from config import settings
from models import RenderedPage
from processor import OcrProcessor
from tokenization import OffsetTokenizer


class FakeCropLightOnClient:
    def __init__(self):
        self.calls = 0

    async def ocr_image(self, _image, _prompt):
        self.calls += 1
        if self.calls == 1:
            return "# Page\n\n![image](image_1.png) 0,0,1000,1000"
        return " ".join(f"crop{i}" for i in range(20))


async def fake_image_page(*_args, **_kwargs):
    yield RenderedPage(
        page_number=1,
        image=Image.new("RGB", (100, 100), "white"),
        width=100,
        height=100,
    )


class ProcessorImageChunkTest(unittest.TestCase):
    def test_oversized_image_chunk_text_is_split_without_schema_changes(self):
        async def run():
            tokenizer = OffsetTokenizer(None)
            processor = OcrProcessor(
                settings=replace(
                    settings,
                    image_chunk_max_tokens=5,
                    min_crop_width=1,
                    min_crop_height=1,
                    min_crop_area=1,
                    max_crops_per_page=1,
                ),
                lighton_client=FakeCropLightOnClient(),
                chunker=MarkdownTokenChunker(
                    tokenizer,
                    max_tokens=460,
                    overlap_tokens=12,
                ),
            )

            with patch("processor.stream_rendered_pages", fake_image_page):
                return await processor.process_document(
                    "example.pdf",
                    filename="example.pdf",
                    doc_id="doc-1",
                )

        result = asyncio.run(run())

        assert len(result["image_chunks"]) == 4
        assert [item["text"] for item in result["image_chunks"]] == [
            "crop0 crop1 crop2 crop3 crop4",
            "crop5 crop6 crop7 crop8 crop9",
            "crop10 crop11 crop12 crop13 crop14",
            "crop15 crop16 crop17 crop18 crop19",
        ]
        for image_chunk in result["image_chunks"]:
            assert set(image_chunk) == {"text", "page_number", "bbox", "width", "height"}


if __name__ == "__main__":
    unittest.main()
