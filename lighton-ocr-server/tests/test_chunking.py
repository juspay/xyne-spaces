import unittest

from chunking import (
    MarkdownTokenChunker,
    OcrPage,
    StreamingMarkdownTokenChunker,
    build_toc_from_pages,
)
from tokenization import OffsetTokenizer


class MarkdownTokenChunkerTest(unittest.TestCase):
    def test_chunks_are_strict_docling_shape_and_token_limited(self):
        tokenizer = OffsetTokenizer(None)
        chunker = MarkdownTokenChunker(tokenizer, max_tokens=10, overlap_tokens=3)
        words = " ".join(f"word{i}" for i in range(25))

        chunks = chunker.chunk_pages([OcrPage(1, f"# Heading\n\n{words}")])

        assert len(chunks) > 1
        for chunk in chunks:
            payload = chunk.to_dict()
            assert set(payload) == {"text", "headings", "page_numbers", "bbox"}
            assert tokenizer.count(chunk.text) <= 10
            assert chunk.headings == ["Heading"]
            assert chunk.page_numbers == [1]
            assert chunk.bbox is None

        assert chunks[0].text.split()[-3:] == chunks[1].text.split()[:3]

    def test_page_and_heading_metadata_are_derived_from_markdown(self):
        tokenizer = OffsetTokenizer(None)
        chunker = MarkdownTokenChunker(tokenizer, max_tokens=100, overlap_tokens=12)

        chunks = chunker.chunk_pages(
            [
                OcrPage(1, "# A\n\nalpha beta"),
                OcrPage(2, "## B\n\ngamma delta"),
            ]
        )

        assert len(chunks) == 1
        assert chunks[0].page_numbers == [1, 2]
        assert chunks[0].headings == ["A"]

        toc = build_toc_from_pages(
            [
                OcrPage(1, "# A\n\nalpha"),
                OcrPage(2, "## B\n\nbeta"),
            ]
        )
        assert [entry.section_title for entry in toc] == ["A", "B"]
        assert toc[1].parent_index == 0

    def test_streaming_chunker_drops_committed_text_but_preserves_overlap(self):
        tokenizer = OffsetTokenizer(None)
        chunker = StreamingMarkdownTokenChunker(tokenizer, max_tokens=8, overlap_tokens=2)

        emitted = []
        emitted.extend(chunker.add_page(OcrPage(1, "# A\none two three four")))
        assert emitted == []

        emitted.extend(chunker.add_page(OcrPage(2, "five six seven eight nine ten")))
        assert len(emitted) >= 1
        assert tokenizer.count(chunker._buffer) < 8

        final = chunker.finish()
        assert final
        assert emitted[0].text.split()[-2:] == final[0].text.split()[:2]
        assert final[0].headings == ["A"]

    def test_processor_style_page_chunking_does_not_span_pages(self):
        tokenizer = OffsetTokenizer(None)
        chunker = MarkdownTokenChunker(tokenizer, max_tokens=10, overlap_tokens=2)

        chunks = []
        for page in [
            OcrPage(1, "# A\n\n" + " ".join(f"a{i}" for i in range(8))),
            OcrPage(2, "# B\n\n" + " ".join(f"b{i}" for i in range(8))),
        ]:
            chunks.extend(chunker.chunk_pages([page]))

        assert chunks
        assert all(len(chunk.page_numbers) == 1 for chunk in chunks)
        assert {tuple(chunk.page_numbers) for chunk in chunks} == {(1,), (2,)}


if __name__ == "__main__":
    unittest.main()
