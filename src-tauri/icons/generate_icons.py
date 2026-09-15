"""Generate the Echo AI icon set from the rasterized vector master.

The master PNG is produced by rasterizing src-tauri/icons/echo-ai.svg in a
browser (no SVG rasterizer is available in this environment). Run the browser
step first, then this script writes the full Tauri icon set.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ICON_DIR = Path(__file__).parent
MASTER = ICON_DIR.parent.parent / "raster_master.png"

# Tauri reads these names from tauri.conf.json.
PNG_TARGETS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
}


def main() -> int:
    if not MASTER.is_file():
        print(f"master not found: {MASTER}", file=sys.stderr)
        print("rasterize echo-ai.svg first", file=sys.stderr)
        return 1

    master = Image.open(MASTER).convert("RGBA")
    if master.width != master.height:
        side = min(master.width, master.height)
        left = (master.width - side) // 2
        top = (master.height - side) // 2
        master = master.crop((left, top, left + side, top + side))

    for name, px in PNG_TARGETS.items():
        master.resize((px, px), Image.LANCZOS).save(ICON_DIR / name, "PNG")
        print(f"wrote {name} ({px}x{px})")

    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.resize((256, 256), Image.LANCZOS).save(
        ICON_DIR / "icon.ico", format="ICO", sizes=ico_sizes
    )
    print(f"wrote icon.ico {ico_sizes}")

    for px in (512, 256, 128):
        master.resize((px, px), Image.LANCZOS).save(
            ICON_DIR / "icon.icns", format="ICNS"
        )
    print("wrote icon.icns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
