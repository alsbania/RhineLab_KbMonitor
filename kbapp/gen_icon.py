# -*- coding: utf-8 -*-
"""生成 KbMonitor 应用图标 icon.ico —— 莱茵生命「无限」标记。

标记的两环在右上 / 左下各有一处缺口，手画的实心环复现不出来。因此这里
直接使用 RhineLabUI `src/brand.ts` 的原始路径数据：先用 Edge headless
把 SVG 栅格化成 PNG，再裁到标记外接框、居中放到圆角暖纸底板上。

这样图标与界面里 `#i-rhine` 用的是同一份轮廓，缩放后也不会走形。

依赖：Edge（栅格化）+ Pillow（合成与 ICO 输出）
输出：kbapp/icon.ico（16/24/32/48/64/128/256）+ icon-preview.png
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icon.ico")

S = 256                      # 目标边长
RENDER = 1024                # SVG 栅格化边长（高分辨率下采样）

PAPER_TOP = (241, 238, 232)
PAPER_BOT = (222, 218, 210)
INK = "#080a08"

# RhineLabUI src/brand.ts 的标记路径（无限环 + 加号 + 减号）
MARK_PATHS = (
    '<path d="M156 75C127 48 103 15 70 15C37 15 15 39 15 70S38 128 70 128'
    'C103 128 127 96 176 52M155 75C182 99 208 128 240 128C273 128 295 105'
    ' 295 73S273 15 240 15C221 15 207 23 192 38" fill="none" stroke="%s"'
    ' stroke-width="26"/>'
    '<path d="M44 70h50M69 45v50M219 70h44" fill="none" stroke="%s"'
    ' stroke-width="15"/>'
) % (INK, INK)

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def find_edge():
    for path in EDGE_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("找不到 msedge.exe，无法栅格化标记")


def rasterize_mark(workdir):
    """把标记渲染成一张高分辨率 PNG，返回路径。"""
    page = os.path.join(workdir, "mark.html")
    png = os.path.join(workdir, "mark.png")
    # 画布略大于 viewBox，保证笔画不被裁掉；底色用纯白以便抠图
    html = (
        '<!doctype html><html><head><meta charset="utf-8"><style>'
        'html,body{margin:0;background:#fff}svg{display:block}'
        '</style></head><body>'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 322 157"'
        ' width="%d" height="%d">%s</svg></body></html>'
        % (RENDER, int(round(RENDER * 157 / 322)), MARK_PATHS)
    )
    with open(page, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)

    cmd = [find_edge(), "--headless", "--disable-gpu", "--hide-scrollbars",
           "--force-device-scale-factor=1",
           "--screenshot=%s" % png,
           "--window-size=%d,%d" % (RENDER, int(round(RENDER * 157 / 322))),
           "file:///" + page.replace("\\", "/")]
    subprocess.run(cmd, capture_output=True, timeout=180)
    if not os.path.exists(png):
        raise SystemExit("Edge 未能输出截图")
    return png


def tight_mark(png_path):
    """裁到标记外接框，返回 RGBA 图（背景透明）。"""
    img = Image.open(png_path).convert("RGB")
    # 白色背景 -> alpha；标记为近黑
    gray = img.convert("L")
    alpha = gray.point(lambda v: 255 - v)
    rgba = Image.new("RGBA", img.size, (8, 10, 8, 0))
    rgba.putalpha(alpha)
    box = alpha.getbbox()
    if not box:
        raise SystemExit("栅格化结果为空")
    return rgba.crop(box)


def paper(size):
    img = Image.new("RGB", (size, size), PAPER_TOP)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)],
               fill=tuple(int(PAPER_TOP[i] + (PAPER_BOT[i] - PAPER_TOP[i]) * t)
                          for i in range(3)))
    return img.convert("RGBA")


def rounded_alpha(size, radius_ratio=0.21):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return m


def render():
    with tempfile.TemporaryDirectory() as work:
        mark = tight_mark(rasterize_mark(work))

    # 把标记按「面积占比」缩放到目标——标记本身是 280×113 的扁长形，
    # 只按宽度缩放会让 16/32px 下的留白过多。约束宽度 ≤ 88%、高度 ≤ 58%。
    aspect = mark.width / mark.height
    target_w = int(S * 0.88)
    target_h = int(round(target_w / aspect))
    if target_h > S * 0.58:
        target_h = int(S * 0.58)
        target_w = int(round(target_h * aspect))
    mark = mark.resize((target_w, target_h), Image.LANCZOS)

    base = paper(S)
    base.alpha_composite(mark, ((S - target_w) // 2, (S - target_h) // 2))
    base.putalpha(rounded_alpha(S))
    return base


def main():
    img = render()
    img.save(OUT, format="ICO",
             sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                    (128, 128), (256, 256)])
    png = os.path.splitext(OUT)[0] + "-preview.png"
    img.resize((512, 512), Image.LANCZOS).save(png)
    print("icon saved: %s (%d bytes) + %s" % (OUT, os.path.getsize(OUT), png))


if __name__ == "__main__":
    main()
