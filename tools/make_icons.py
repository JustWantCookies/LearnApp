#!/usr/bin/env python3
"""Draws the app icons (open book on a green tile) into docs/icons/. Run once, or after changing colors."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "docs" / "icons"
BG = (47, 111, 94)
PAGE = (247, 245, 240)
LINE = (190, 208, 200)


def icon(size: int, full_bleed: bool) -> Image.Image:
    s = 4  # supersample for smooth edges
    W = size * s
    img = Image.new("RGB", (W, W), BG)
    d = ImageDraw.Draw(img)
    # Keep the art inside the maskable safe zone (inner 80%).
    m = W * (0.22 if full_bleed else 0.18)
    top, bottom = W * 0.30, W * 0.72
    mid = W / 2
    d.polygon([(m, top), (mid - W * 0.02, top + W * 0.04), (mid - W * 0.02, bottom + W * 0.04), (m, bottom)], fill=PAGE)
    d.polygon([(W - m, top), (mid + W * 0.02, top + W * 0.04), (mid + W * 0.02, bottom + W * 0.04), (W - m, bottom)], fill=PAGE)
    for i in range(4):
        y = top + W * (0.09 + i * 0.08)
        d.line([(m + W * 0.05, y), (mid - W * 0.07, y + W * 0.02)], fill=LINE, width=int(W * 0.018))
        d.line([(W - m - W * 0.05, y), (mid + W * 0.07, y + W * 0.02)], fill=LINE, width=int(W * 0.018))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon(180, False).save(OUT / "apple-touch-icon.png", optimize=True)
    icon(192, False).save(OUT / "icon-192.png", optimize=True)
    icon(512, True).save(OUT / "icon-512.png", optimize=True)
    print(f"Icons written to {OUT}")


if __name__ == "__main__":
    main()
