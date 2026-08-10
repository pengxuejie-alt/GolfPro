"""
微信小程序 TabBar 图标：81×81 PNG，透明底。
- 未选中：线框风格 #64748b（slate-500），参考常见底部导航
- 选中：实心 #15803d（green-700）+ 略浅高光，更醒目
2× 超采样后缩放，边缘更顺滑。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DIRS = [ROOT / "src" / "static" / "icons", ROOT / "src" / "static" / "tab"]
COLOR_NORMAL = (100, 116, 139, 255)  # slate-500
COLOR_ACTIVE = (21, 128, 61, 255)  # green-700
COLOR_ACTIVE_HI = (34, 197, 94, 255)  # green-500 高光
OUT = 81
SCALE = 2
S = OUT * SCALE
STROKE = max(3 * SCALE, 4)


def downsample(img: Image.Image) -> Image.Image:
    return img.resize((OUT, OUT), Image.Resampling.LANCZOS)


def base() -> Image.Image:
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))


def draw_home(d: ImageDraw.ImageDraw, c: tuple[int, int, int, int], filled: bool) -> None:
    body = [22 * SCALE, 34 * SCALE, 59 * SCALE, 68 * SCALE]
    roof = [(40 * SCALE, 12 * SCALE), (68 * SCALE, 36 * SCALE), (12 * SCALE, 36 * SCALE)]
    if filled:
        d.polygon(roof, fill=c)
        d.rounded_rectangle(body, radius=5 * SCALE, fill=c)
        r, g, b, a = c
        hi = (min(255, r + 50), min(255, g + 70), min(255, b + 40), a)
        d.polygon(
            [(40 * SCALE, 16 * SCALE), (62 * SCALE, 34 * SCALE), (18 * SCALE, 34 * SCALE)],
            fill=hi,
        )
        d.rounded_rectangle(
            [33 * SCALE, 46 * SCALE, 47 * SCALE, 68 * SCALE],
            radius=2 * SCALE,
            fill=(255, 255, 255, 70),
        )
    else:
        d.line([roof[0], roof[1], roof[2], roof[0]], fill=c, width=STROKE, joint="curve")
        d.rounded_rectangle(body, radius=5 * SCALE, outline=c, width=STROKE)
        d.arc(
            [33 * SCALE, 46 * SCALE, 47 * SCALE, 66 * SCALE],
            0,
            180,
            fill=c,
            width=max(2 * SCALE, STROKE // 2),
        )


def draw_players(d: ImageDraw.ImageDraw, c: tuple[int, int, int, int], filled: bool) -> None:
    r = 9 * SCALE
    r2 = 11 * SCALE
    if filled:
        d.ellipse([14 * SCALE - r, 24 * SCALE - r, 14 * SCALE + r, 24 * SCALE + r], fill=c)
        d.arc([10 * SCALE, 32 * SCALE, 30 * SCALE, 58 * SCALE], 200, 340, fill=c, width=5 * SCALE)
        d.ellipse([66 * SCALE - r, 24 * SCALE - r, 66 * SCALE + r, 24 * SCALE + r], fill=c)
        d.arc([50 * SCALE, 32 * SCALE, 70 * SCALE, 58 * SCALE], 200, 340, fill=c, width=5 * SCALE)
        d.ellipse([40 * SCALE - r2, 28 * SCALE - r2, 40 * SCALE + r2, 28 * SCALE + r2], fill=COLOR_ACTIVE_HI)
        d.arc([28 * SCALE, 38 * SCALE, 52 * SCALE, 72 * SCALE], 200, 340, fill=c, width=6 * SCALE)
    else:
        for cx, cy, rad in [(14, 24, r), (66, 24, r)]:
            d.ellipse(
                [cx * SCALE - rad, cy * SCALE - rad, cx * SCALE + rad, cy * SCALE + rad],
                outline=c,
                width=STROKE,
            )
        d.ellipse(
            [
                40 * SCALE - r2,
                28 * SCALE - r2,
                40 * SCALE + r2,
                28 * SCALE + r2,
            ],
            outline=c,
            width=STROKE + 1,
        )
        d.arc([28 * SCALE, 38 * SCALE, 52 * SCALE, 72 * SCALE], 200, 340, fill=c, width=5 * SCALE)


def draw_me(d: ImageDraw.ImageDraw, c: tuple[int, int, int, int], filled: bool) -> None:
    head = [40 * SCALE - 18 * SCALE, 14 * SCALE, 40 * SCALE + 18 * SCALE, 14 * SCALE + 36 * SCALE]
    if filled:
        d.ellipse(head, fill=c)
        d.pieslice([12 * SCALE, 40 * SCALE, 68 * SCALE, 88 * SCALE], 200, 340, fill=c)
        # 不在头像上叠小椭圆：81px 缩放后易被看成「空心/戴面具」与未选中态不一致
    else:
        d.ellipse(head, outline=c, width=STROKE)
        d.arc([12 * SCALE, 40 * SCALE, 68 * SCALE, 88 * SCALE], 200, 340, fill=c, width=STROKE)


def make(kind: str, color: tuple[int, int, int, int], active: bool) -> Image.Image:
    im = base()
    dr = ImageDraw.Draw(im)
    if kind == "home":
        draw_home(dr, color, active)
    elif kind == "players":
        draw_players(dr, color, active)
    else:
        draw_me(dr, color, active)
    return downsample(im)


def main() -> None:
    pairs = [
        ("home", "home.png", "home-active.png"),
        ("players", "players.png", "players-active.png"),
        ("me", "me.png", "me-active.png"),
    ]
    for folder in DIRS:
        folder.mkdir(parents=True, exist_ok=True)
    for kind, normal_name, active_name in pairs:
        for folder in DIRS:
            make(kind, COLOR_NORMAL, False).save(folder / normal_name, "PNG")
            make(kind, COLOR_ACTIVE, True).save(folder / active_name, "PNG")
            print("wrote", folder / normal_name, folder / active_name)


if __name__ == "__main__":
    main()
