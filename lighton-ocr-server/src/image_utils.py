"""Image conversion helpers shared by OCR and response serialization."""

from __future__ import annotations

import base64
import io

from PIL import Image


def normalize_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        mask = img.split()[-1] if img.mode in ("RGBA", "LA") else None
        bg.paste(img.convert("RGB"), mask=mask)
        return bg
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def resize_max_dim(img: Image.Image, max_dim: int | None) -> Image.Image:
    if not max_dim or max_dim <= 0:
        return img
    width, height = img.size
    largest = max(width, height)
    if largest <= max_dim:
        return img
    scale = max_dim / float(largest)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def encode_image_jpeg_data_url(
    img: Image.Image,
    *,
    max_dim: int | None,
    quality: int,
) -> str:
    encoded = normalize_rgb(resize_max_dim(img, max_dim))
    buf = io.BytesIO()
    encoded.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
