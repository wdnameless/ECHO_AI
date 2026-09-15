"""Generate the Echo AI icon set from the placeholder SVG mark.

Tauri needs: 32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico, icon.icns.
The SVG is rasterized by hand-drawing the same geometry, so no external
SVG rasterizer is required.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).parent
SIZE = 1024

BACKGROUND = (11, 15, 25, 255)
CORE = (34, 211, 167, 255)
RING_COLORS = [
    (34, 211, 167, 242),
    (59, 130, 246, 204),
    (139, 92, 246, 153),
]


def draw_mark(size: int) -> Image.Image:
    """Render the echo mark at the requested square size."""
    scale = size / 512.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = int(112 * scale)
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)], radius=radius, fill=BACKGROUND
    )

    cx = cy = size / 2.0

    # Core dot.
    core_r = 34 * scale
    draw.ellipse(
        [(cx - core_r, cy - core_r), (cx + core_r, cy + core_r)], fill=CORE
    )

    # Paired brackets either side of the core, mirroring the SVG mark.
    # PIL angles run clockwise from 3 o'clock, so the left bracket spans
    # 135deg..225deg and the right one -45deg..45deg.
    arcs = [
        (126, 26, 0),
        (190, 22, 1),
        (254, 18, 2),
    ]
    for radius_px, stroke, color_index in arcs:
        color = RING_COLORS[color_index]
        r = radius_px * scale
        width = max(1, int(stroke * scale))
        box = [cx - r, cy - r, cx + r, cy + r]
        draw.arc(box, start=135, end=225, fill=color, width=width)
        draw.arc(box, start=-45, end=45, fill=color, width=width)

    return img


def main() -> None:
    master = draw_mark(SIZE)

    # PNG set required by tauri.conf.json.
    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, px in targets.items():
        master.resize((px, px), Image.LANCZOS).save(ICON_DIR / name, "PNG")
        print(f"wrote {name} ({px}x{px})")

    # Windows .ico — multi-resolution.
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ICON_DIR / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"wrote icon.ico {ico_sizes}")

    # macOS .icns — Pillow writes icns from a single large raster.
    master.resize((512, 512), Image.LANCZOS).save(ICON_DIR / "icon.icns", format="ICNS")
    print("wrote icon.icns (512x512)")


if __name__ == "__main__":
    main()
