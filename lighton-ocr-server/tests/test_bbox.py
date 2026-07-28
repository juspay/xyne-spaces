import unittest

from bbox import (
    filter_regions,
    merge_overlapping_regions,
    parse_lighton_regions,
    strip_lighton_image_markers,
)


class BboxTest(unittest.TestCase):
    def test_parse_lighton_bbox_normalized_to_1000(self):
        regions = parse_lighton_regions(
            "before ![image](image_1.png)100,50,400,250 after",
            (1000, 2000),
            padding_pixels=0,
        )

        assert len(regions) == 1
        assert regions[0].pixel_bbox == (100, 100, 400, 500)
        assert regions[0].bbox == {"l": 100.0, "t": 50.0, "r": 400.0, "b": 250.0}

    def test_merge_overlapping_regions_and_filter_after_merge(self):
        regions = parse_lighton_regions(
            "![image](image_1.png)100,100,300,300\n"
            "![image](image_2.png)250,250,500,500\n"
            "![image](image_3.png)800,800,805,805",
            (1000, 1000),
            padding_pixels=0,
        )

        merged = merge_overlapping_regions(regions)
        assert len(merged) == 2
        assert merged[0].pixel_bbox == (100, 100, 500, 500)

        kept, skipped_small, skipped_limit = filter_regions(
            merged,
            min_width=32,
            min_height=32,
            min_area=2048,
            max_regions=32,
        )
        assert len(kept) == 1
        assert skipped_small == 1
        assert skipped_limit == 0

    def test_parse_regions_can_be_capped_before_merge_work(self):
        markdown = "\n".join(
            f"![image](image_{idx}.png){idx},{idx},{idx + 10},{idx + 10}" for idx in range(20)
        )

        regions = parse_lighton_regions(
            markdown,
            (1000, 1000),
            padding_pixels=0,
            max_regions=3,
        )

        assert len(regions) == 3
        assert [region.refs[0] for region in regions] == [
            "image_0.png",
            "image_1.png",
            "image_2.png",
        ]

    def test_strip_markers_removes_bbox_noise(self):
        cleaned = strip_lighton_image_markers("hello ![image](image_1.png)100,100,300,300\n\nworld")
        assert cleaned == "hello world"


if __name__ == "__main__":
    unittest.main()
