import asyncio
import tempfile
import unittest
from pathlib import Path

from renderer import is_supported_upload, stream_rendered_pages


class RendererTest(unittest.TestCase):
    def test_supported_uploads_include_office_text_pdf_and_images(self):
        accepted = [
            "file.pdf",
            "file.docx",
            "file.pptx",
            "file.txt",
            "file.png",
            "file.jpg",
            "file.jpeg",
            "file.bmp",
            "file.webp",
            "file.tif",
            "file.tiff",
        ]
        for filename in accepted:
            with self.subTest(filename=filename):
                assert is_supported_upload(filename)

        assert not is_supported_upload("file.xlsx")
        assert not is_supported_upload("file.csv")

    def test_text_file_is_rasterized_into_pages(self):
        async def run():
            with tempfile.TemporaryDirectory() as tmpdir:
                path = Path(tmpdir) / "sample.txt"
                path.write_text("hello world\n" * 20, encoding="utf-8")
                return [
                    page
                    async for page in stream_rendered_pages(
                        str(path),
                        filename="sample.txt",
                        render_max_dim=1540,
                        pdf_render_dpi=200,
                        max_pages=1,
                        queue_size=1,
                        text_page_width=400,
                        text_page_height=300,
                        text_font_size=16,
                        text_margin=24,
                    )
                ]

        pages = asyncio.run(run())
        assert len(pages) == 1
        assert pages[0].page_number == 1
        assert (pages[0].width, pages[0].height) == (400, 300)


if __name__ == "__main__":
    unittest.main()
