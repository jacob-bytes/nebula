#!/usr/bin/env python3
"""生成分享页 OG 封面（按文件类型区分）。

为什么不用真实缩略图：缩略图链路依赖 Telegram 回源与 media ticket，爬虫抓取时可能
404，反而让分享卡片变成空白。按类型给确定性的封面，既不依赖运行时数据，
又能让「视频 / 图片 / 文档 / 压缩包」在聊天列表里有辨识度。

用法：python3 scripts/assets/gen-og-covers.py
输出：frontend/public/og/{default,image,video,audio,archive,doc}.png（1200x630）
"""
import math
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'og'

# 每类一个主色 + 文案 + 一个用多边形画出的简单标记
VARIANTS = [
    ('default', (30, 64, 175), '文件分享', '星云盘'),
    ('image', (16, 122, 87), '图片', '星云盘'),
    ('video', (124, 45, 160), '视频', '星云盘'),
    ('audio', (180, 83, 9), '音频', '星云盘'),
    ('archive', (91, 33, 182), '压缩包', '星云盘'),
    ('doc', (30, 64, 175), '文档', '星云盘'),
]


def load_font(size: int):
    for path in (
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ):
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=0)
            except Exception:
                continue
    return ImageFont.load_default()


def gradient(base: tuple[int, int, int]) -> Image.Image:
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        r = int(9 + (base[0] - 9) * t * 0.9)
        g = int(12 + (base[1] - 12) * t * 0.9)
        b = int(20 + (base[2] - 20) * t * 0.9)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    return img


def add_glow(img: Image.Image, base: tuple[int, int, int]) -> Image.Image:
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W - 620, -260, W + 200, 560], fill=(*base, 70))
    gd.ellipse([-260, H - 340, 460, H + 240], fill=(*base, 55))
    return Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')


def draw_mark(d: ImageDraw.ImageDraw, x: int, y: int, size: int, base: tuple[int, int, int]) -> None:
    """圆角方块 + 六边形：与产品 Logo 同构，避免每类都要图标字体。"""
    d.rounded_rectangle([x, y, x + size, y + size], radius=int(size * 0.26), fill=base)
    cx, cy, r = x + size // 2, y + size // 2, int(size * 0.3)
    outer = [(cx + r * math.cos(math.radians(60 * i - 30)), cy + r * math.sin(math.radians(60 * i - 30))) for i in range(6)]
    inner = [(cx + (r - 10) * math.cos(math.radians(60 * i - 30)), cy + (r - 10) * math.sin(math.radians(60 * i - 30))) for i in range(6)]
    d.polygon(outer, outline=(255, 255, 255), width=5)
    d.polygon(inner, fill=(255, 255, 255))


def build(name: str, base: tuple[int, int, int], label: str, brand: str) -> Image.Image:
    img = add_glow(gradient(base), base)
    d = ImageDraw.Draw(img)
    draw_mark(d, 92, 214, 168, base)
    d.text((300, 236), brand, font=load_font(104), fill=(255, 255, 255))
    d.text((304, 368), label, font=load_font(46), fill=(226, 232, 240))
    d.text((94, 500), '基于 Telegram 的文件分发与网盘系统', font=load_font(28), fill=(148, 163, 184))
    return img


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, base, label, brand in VARIANTS:
        path = OUT_DIR / f'{name}.png'
        build(name, base, label, brand).save(path, 'PNG', optimize=True)
        print(f'{path} {path.stat().st_size // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
