"""LightOn bbox marker parsing, crop filtering, and overlap merging."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from models import DetectedRegion

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

_NUM = r"-?\d+(?:\.\d+)?"
_BBOX_RE = re.compile(
    rf"!\[image\]\((?P<ref>[^)]*)\)\s*"
    rf"(?P<x1>{_NUM})\s*,\s*(?P<y1>{_NUM})\s*,\s*"
    rf"(?P<x2>{_NUM})\s*,\s*(?P<y2>{_NUM})",
    re.IGNORECASE,
)
_IMAGE_TAG_LOOSE_RE = re.compile(
    r"!\[image\]\([^)]*\)\s*"
    r"(?:\[?\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){0,5}\s*\]?)?",
    re.IGNORECASE,
)


def parse_lighton_regions(
    markdown: str,
    page_size: tuple[int, int],
    *,
    padding_pixels: int = 0,
    max_regions: int = -1,
) -> list[DetectedRegion]:
    regions: list[DetectedRegion] = []
    if max_regions == 0:
        return regions
    for match in _BBOX_RE.finditer(markdown or ""):
        coords = _coords_from_match(match)
        if coords is None:
            continue
        region = _region_from_coords(
            refs=(match.group("ref") or "",),
            coords=coords,
            page_size=page_size,
            padding_pixels=padding_pixels,
            start=match.start(),
            end=match.end(),
        )
        if region is not None:
            regions.append(region)
            if max_regions > 0 and len(regions) >= max_regions:
                break
    return regions


def merge_overlapping_regions(regions: Sequence[DetectedRegion]) -> list[DetectedRegion]:
    if not regions:
        return []
    parent = list(range(len(regions)))

    def find(idx: int) -> int:
        while parent[idx] != idx:
            parent[idx] = parent[parent[idx]]
            idx = parent[idx]
        return idx

    def union(a: int, b: int) -> None:
        root_a = find(a)
        root_b = find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            if _intersects_or_touches(regions[i].pixel_bbox, regions[j].pixel_bbox):
                union(i, j)

    groups: dict[int, list[DetectedRegion]] = {}
    for idx, region in enumerate(regions):
        groups.setdefault(find(idx), []).append(region)

    merged = [_merge_group(group) for group in groups.values()]
    return sorted(merged, key=lambda item: (item.pixel_bbox[1], item.pixel_bbox[0]))


def filter_regions(
    regions: Iterable[DetectedRegion],
    *,
    min_width: int,
    min_height: int,
    min_area: int,
    max_regions: int,
) -> tuple[list[DetectedRegion], int, int]:
    kept: list[DetectedRegion] = []
    skipped_small = 0
    skipped_limit = 0
    for region in regions:
        if (
            region.width < min_width
            or region.height < min_height
            or region.width * region.height < min_area
        ):
            skipped_small += 1
            continue
        if max_regions >= 0 and len(kept) >= max_regions:
            skipped_limit += 1
            continue
        kept.append(region)
    return kept, skipped_small, skipped_limit


def strip_lighton_image_markers(markdown: str) -> str:
    text = _IMAGE_TAG_LOOSE_RE.sub("", markdown or "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _coords_from_match(match: re.Match[str]) -> tuple[float, float, float, float] | None:
    try:
        x1 = float(match.group("x1"))
        y1 = float(match.group("y1"))
        x2 = float(match.group("x2"))
        y2 = float(match.group("y2"))
    except (TypeError, ValueError):
        return None
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _region_from_coords(
    *,
    refs: tuple[str, ...],
    coords: tuple[float, float, float, float],
    page_size: tuple[int, int],
    padding_pixels: int,
    start: int,
    end: int,
) -> DetectedRegion | None:
    page_w, page_h = page_size
    if page_w <= 0 or page_h <= 0:
        return None
    x1, y1, x2, y2 = coords
    # LightOn bbox coordinates are normalized to [0, 1000].
    left = _clamp_int(round(x1 * page_w / 1000) - padding_pixels, 0, page_w)
    top = _clamp_int(round(y1 * page_h / 1000) - padding_pixels, 0, page_h)
    right = _clamp_int(round(x2 * page_w / 1000) + padding_pixels, 0, page_w)
    bottom = _clamp_int(round(y2 * page_h / 1000) + padding_pixels, 0, page_h)
    width = right - left
    height = bottom - top
    if width <= 0 or height <= 0:
        return None
    return DetectedRegion(
        refs=refs,
        bbox={"l": round(x1, 4), "t": round(y1, 4), "r": round(x2, 4), "b": round(y2, 4)},
        pixel_bbox=(left, top, right, bottom),
        width=width,
        height=height,
        start=start,
        end=end,
    )


def _merge_group(group: Sequence[DetectedRegion]) -> DetectedRegion:
    left = min(item.pixel_bbox[0] for item in group)
    top = min(item.pixel_bbox[1] for item in group)
    right = max(item.pixel_bbox[2] for item in group)
    bottom = max(item.pixel_bbox[3] for item in group)
    norm_l = min(item.bbox["l"] for item in group)
    norm_t = min(item.bbox["t"] for item in group)
    norm_r = max(item.bbox["r"] for item in group)
    norm_b = max(item.bbox["b"] for item in group)
    refs: list[str] = []
    for item in group:
        refs.extend(ref for ref in item.refs if ref)
    return DetectedRegion(
        refs=tuple(dict.fromkeys(refs)),
        bbox={"l": norm_l, "t": norm_t, "r": norm_r, "b": norm_b},
        pixel_bbox=(left, top, right, bottom),
        width=right - left,
        height=bottom - top,
        start=min(item.start for item in group),
        end=max(item.end for item in group),
    )


def _intersects_or_touches(
    a: tuple[int, int, int, int],
    b: tuple[int, int, int, int],
) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _clamp_int(value: int, lower: int, upper: int) -> int:
    return max(lower, min(upper, value))
