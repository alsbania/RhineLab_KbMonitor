# -*- coding: utf-8 -*-
"""
RhineLabUI 的 MiSans 网页分包 -> RhineLab_KbMonitor 专用字体集。

上游 `misans-webfont@4.3.1/<weight>/*.woff2` 是按 unicode-range 切成 188 份的
CID-keyed CFF（单字重约 6 MB），fontTools 无法合并 CID-keyed CFF
（NotImplementedError: Merging CID-keyed CFF tables is not supported yet）。

因此这里不做合并，而是逐分包求交集子集：每个分包只保留「界面真正会渲染的
字符」里属于它的那几个字形，再按实际保留的码位生成 @font-face 的
unicode-range。分包之间的 unicode-range 本来就不重叠，所以不会冲突。

输出：
  kbapp/web/fonts/misans-<weight>.css      —— @font-face 声明
  kbapp/web/fonts/<weight>/<n>.woff2       —— 子集分包
  kbapp/web/fonts/manifest.json            —— 体积与来源记录
"""
import glob
import io
import json
import os
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 上游仓库原本在 E:\edge down\RhineLabUI-main，后来被搬进了工程内的 kbapp\RhineLabUI-main。
# 两个位置都认，避免路径一挪字体就静默地切不出来。
SRC_CANDIDATES = [
    os.path.join(APP, "kbapp", "RhineLabUI-main", "public", "fonts",
                 "misans-webfont-4.3.1"),
    r"E:\edge down\RhineLabUI-main\public\fonts\misans-webfont-4.3.1",
]
SRC = next((p for p in SRC_CANDIDATES if os.path.isdir(p)), SRC_CANDIDATES[0])
OUT = os.path.join(APP, "kbapp", "web", "fonts")

# 字重映射：MiSans 网页包目录名 -> CSS font-weight
WEIGHTS = [("light", 300), ("regular", 400), ("demibold", 600), ("bold", 700)]

# 界面字符之外的兜底码位段（ASCII、标点、箭头、常用符号、全角形式）
FALLBACK_RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x00FF), (0x0100, 0x017F),
    (0x2000, 0x206F), (0x2070, 0x209F), (0x20A0, 0x20BF),
    (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF),
    (0x2300, 0x23FF),                      # ⏸ 等媒体控制符
    (0x2460, 0x24FF), (0x25A0, 0x25FF), (0x2600, 0x26FF),
    (0x2700, 0x27BF), (0x3000, 0x303F), (0xFF00, 0xFFEF),
    (0xFE00, 0xFE0F),                      # 变体选择符（emoji 呈现方式）
]

# 字体里可能会被渲染、但不写在源码里的字符（数字/日期是运行时拼的，已在兜底段内）
EXTRA = "0123456789"

# 用户数据兜底：课程名 / 教师 / 教室是导入来的任意汉字，不可能预先枚举。
# 只切「界面自己写死的那几百个字」会让课程名逐字回退到系统字体 ——
# 同一行里 MiSans 与雅黑混排，字号字面都对不齐。
# GB2312 的 6763 个汉字覆盖一级/二级字表、常见姓氏与课程名词汇，体积可控
# （MiSans 本身没有的字会被自动跳过，见 verify）。
def user_data_hanzi():
    out = set()
    for cp in range(0x4E00, 0x9FA6):
        try:
            chr(cp).encode("gb2312")
        except UnicodeEncodeError:
            continue
        out.add(cp)
    return out


def _html_visible(src):
    """HTML 里会被渲染的字符：去掉注释/脚本/样式后的文本，以及会显示出来的属性。"""
    s = re.sub(r"<!--[\s\S]*?-->", " ", src)
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    text = "".join(re.findall(r">([^<>]+)<", s))
    attrs = "".join(re.findall(
        r'(?:placeholder|title|aria-label|alt|value)="([^"]*)"', s))
    return text + attrs


def _css_content(src):
    """CSS 里会被渲染的字符只有 content: 的值。"""
    s = re.sub(r"/\*[\s\S]*?\*/", " ", src)
    return "".join(m.group(2) for m in re.finditer(
        r"""content:\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1""", s))


def _js_strings(src):
    """只取 JS 的字符串字面量 —— 注释里的字不会被渲染，不该进字符集。

    原先的做法是整文件 set(fh.read())：注释、变量名、base64 模型全算进去，
    于是子集里塞满永远不渲染的字（约 4 成码位是注释带来的），
    而界面上真正新增的文字反而不在集合里 —— 那部分会掉回退字。
    """
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ""
        if c == "/" and d == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and d == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if c in "\"'`":
            q = c
            i += 1
            buf = []
            while i < n:
                if src[i] == "\\":
                    if i + 1 < n:
                        buf.append(src[i + 1])
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                buf.append(src[i])
                i += 1
            out.append("".join(buf))
            continue
        # 正则字面量：粗略跳过，免得里面的 // 被当成注释吞掉一整行字符串
        if c == "/" and re.search(r"[=(,:[!&|?{};+\-*%^~<>]$",
                                  src[max(0, i - 8):i].rstrip() or "x"):
            i += 1
            in_class = False
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == "[":
                    in_class = True
                elif src[i] == "]":
                    in_class = False
                elif src[i] == "/" and not in_class:
                    i += 1
                    break
                elif src[i] == "\n":
                    break
                i += 1
            continue
        i += 1
    return "".join(out)


def collect_chars(include_user_hanzi=False):
    """抽出界面真正会渲染的字符集合（不含注释）。

    include_user_hanzi 打开时额外并入 GB2312 常用汉字，用于正文那一档字重：
    课程名/教师/教室是导入的任意汉字，只切界面写死的字会让它们逐字回退。
    """
    # 兜底段必须并入：数字、日期、百分比这些是运行时拼出来的，
    # 源码里只有格式串，字面量里根本没有最终会显示的字符。
    base = set(EXTRA)
    for lo, hi in FALLBACK_RANGES:
        base |= {chr(c) for c in range(lo, hi + 1)}

    files = []
    for pat in ("web/*.html", "web/*.css", "web/*.js",
                "web/vendor/*.js", "web/rhine/*.js",
                "kbapp/web/*.html", "kbapp/web/*.css", "kbapp/web/*.js",
                "kbapp/web/vendor/*.js", "kbapp/web/rhine/*.js"):
        files += glob.glob(os.path.join(APP, pat))
    files += glob.glob(os.path.join(APP, "kb_viewer.html"))

    ui_chars = set()
    for path in sorted(set(files)):
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            src = fh.read()
        ext = os.path.splitext(path)[1].lower()
        if ext == ".html":
            ui_chars |= set(_html_visible(src))
        elif ext == ".css":
            ui_chars |= set(_css_content(src))
        else:
            ui_chars |= set(_js_strings(src))

    # 丢掉控制符与不可打印字符。注意 isprintable() 对分隔符一律给 False，
    # 但 U+3000（表意空格）是界面真的会用来对齐的字符，必须显式留下。
    ui_chars = {c for c in ui_chars
                if (c.isprintable() or c == "\u3000")
                and c not in "\u200b\ufeff"}
    codepoints = {ord(c) for c in ui_chars} | {ord(c) for c in base}
    if include_user_hanzi:
        codepoints |= user_data_hanzi()
    print("  界面可见字符 %d 个码位%s"
          % (len({ord(c) for c in ui_chars}),
             "（含 GB2312 汉字兜底，共 %d）" % len(codepoints)
             if include_user_hanzi else ""))
    return codepoints


def subset_options():
    opts = Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables = ["DSIG"]
    opts.passthrough_tables = False
    return opts


def write_utf8(path, text):
    """显式 UTF-8 —— 本机默认编码是 GBK，不能依赖 open() 的默认值。"""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def css_unicode_range(codepoints):
    """把码位列表压成 CSS unicode-range 的紧凑写法。"""
    pts = sorted(codepoints)
    parts, start, prev = [], pts[0], pts[0]
    for cp in pts[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        parts.append((start, prev))
        start = prev = cp
    parts.append((start, prev))
    out = []
    for lo, hi in parts:
        if lo == hi:
            out.append("U+%04X" % lo)
        elif hi == lo + 1:
            out.append("U+%04X,U+%04X" % (lo, hi))
        else:
            out.append("U+%04X-%04X" % (lo, hi))
    return ",".join(out)


def build_weight(weight, css_weight, wanted, outdir):
    chunks = sorted(glob.glob(os.path.join(SRC, weight, "*.woff2")),
                    key=lambda p: int(re.search(r"(\d+)\.woff2$", p).group(1)))
    if not chunks:
        raise SystemExit("找不到分包: %s" % weight)

    fontdir = os.path.join(outdir, weight)
    os.makedirs(fontdir, exist_ok=True)

    faces, kept, total_in, total_out, sources = [], 0, 0, 0, 0
    opts = subset_options()

    for path in chunks:
        total_in += os.path.getsize(path)
        font = TTFont(path)
        cmap = font.getBestCmap()
        keep = sorted(set(cmap) & wanted)
        if not keep:
            font.close()
            continue

        sub = Subsetter(options=opts)
        sub.populate(unicodes=keep)
        sub.subset(font)

        # 子集化后实际留下的码位（正常应与 keep 一致）
        final = sorted(font.getBestCmap())
        if not final:
            font.close()
            continue

        name = "%s.woff2" % os.path.basename(path).split(".")[0]
        dest = os.path.join(fontdir, name)
        font.flavor = "woff2"
        font.save(dest)
        font.close()

        size = os.path.getsize(dest)
        total_out += size
        kept += len(final)
        sources += 1
        faces.append(
            "@font-face{font-family:'MiSans';font-style:normal;font-weight:%d;"
            "font-display:swap;src:url('%s/%s') format('woff2');unicode-range:%s}"
            % (css_weight, weight, name, css_unicode_range(final))
        )

    header = (
        "/* MiSans %d —— 由 kbapp/build_fonts.py 从 misans-webfont@4.3.1 子集化生成，\n"
        "   请勿手工编辑。字体版权归小米所有，许可见 License/MiSans-license.pdf。 */\n"
        % css_weight
    )
    write_utf8(os.path.join(outdir, "misans-%s.css" % weight),
               header + "\n".join(faces) + "\n")

    print("  %-9s 分包 %3d -> %3d 个  字形 %4d  %6.1f KB -> %6.1f KB"
          % (weight, len(chunks), sources, kept, total_in / 1024.0, total_out / 1024.0))
    return {"css_weight": css_weight, "faces": sources, "glyphs": kept,
            "bytes_in": total_in, "bytes_out": total_out}


def main():
    wanted = collect_chars()
    # 正文（400）与中黑（600）都会渲染用户数据 —— 课表里课程名是 600、
    # 教师/教室是 400 —— 这两档必须带常用汉字兜底，否则课程名会逐字掉回雅黑。
    # 300 / 700 只用于界面自身文案，不必背上 6763 个汉字。
    wanted_body = collect_chars(include_user_hanzi=True)
    per_weight = {"light": wanted, "regular": wanted_body,
                  "demibold": wanted_body, "bold": wanted}
    print("界面字符集: %d 个码位（正文档 %d）" % (len(wanted), len(wanted_body)))
    os.makedirs(OUT, exist_ok=True)

    if os.path.isdir(OUT):
        for entry in os.listdir(OUT):
            target = os.path.join(OUT, entry)
            if os.path.isdir(target):
                for f in glob.glob(os.path.join(target, "*.woff2")):
                    os.remove(f)

    manifest = {"source": "misans-webfont@4.3.1 (MiSans 4.003)",
                "license": "MiSans 字体许可（小米）—— 见 License/LICENSE-MiSans.pdf",
                "generator": "kbapp/build_fonts.py",
                "charset": "界面可见文字（剥注释，HTML 文本+属性 / JS 字符串 / CSS content）",
                "user_data_hanzi": "regular 档额外并入 GB2312 常用汉字，覆盖课程名等导入数据",
                "weights": {}}
    print("逐分包子集化：")
    for weight, css_weight in WEIGHTS:
        manifest["weights"][weight] = build_weight(
            weight, css_weight, per_weight[weight], OUT)

    write_utf8(os.path.join(OUT, "manifest.json"),
               json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    tot = sum(v["bytes_out"] for v in manifest["weights"].values())
    print("\n四字重合计 %.2f MB（原始 %.2f MB）"
          % (tot / 1048576.0,
             sum(v["bytes_in"] for v in manifest["weights"].values()) / 1048576.0))
    verify(OUT, per_weight)


def verify(outdir, per_weight):
    """自检：每个 @font-face 的 unicode-range 必须与文件内真实 cmap 完全一致。

    注意 `wanted` 含兜底码位段（ASCII 全段、CJK 标点等），其中一部分
    MiSans 本身就没有字形（如 U+2009 之后的若干空格类字符）。因此
    「未覆盖」只对「源字体里确实存在的码位」有意义 —— 这里用
    源分包 cmap 的并集作为基准。
    """
    print("\n自检 @font-face 与字形表一致性：")
    problems = 0
    for weight, css_weight in WEIGHTS:
        # 源字体真实拥有的码位
        source = set()
        for path in glob.glob(os.path.join(SRC, weight, "*.woff2")):
            f = TTFont(path)
            source |= set(f.getBestCmap())
            f.close()

        css = os.path.join(outdir, "misans-%s.css" % weight)
        with open(css, "r", encoding="utf-8") as fh:
            text = fh.read()
        faces = re.findall(r"src:url\('([^']+)'\).*?unicode-range:([^}]+)\}", text)

        declared, files = set(), 0
        for rel, spec in faces:
            files += 1
            for part in spec.split(","):
                part = part.strip().replace("U+", "")
                if "-" in part:
                    lo, hi = part.split("-")
                    declared |= set(range(int(lo, 16), int(hi, 16) + 1))
                else:
                    declared.add(int(part, 16))

        real = set()
        for rel, _ in faces:
            f = TTFont(os.path.join(outdir, rel))
            real |= set(f.getBestCmap())
            f.close()

        expected = source & per_weight[weight]   # 源里有、界面要用的
        missing = expected - declared       # 应覆盖却没覆盖
        extra = declared - expected         # 声明了但源里没有
        ok = (real == declared) and not missing and not extra
        problems += 0 if ok else 1
        print("  %-9s 文件 %3d  声明 %5d  文件实际 %5d  源可用 %5d  %s"
              % (weight, files, len(declared), len(real), len(expected),
                 "OK" if ok else "不一致!"))
        if missing:
            print("      漏掉 %d 个: %s" % (len(missing), sorted(missing)[:8]))
        if extra:
            print("      多声明 %d 个: %s" % (len(extra), sorted(extra)[:8]))
    print("自检结果：%s" % ("全部通过" if not problems else "有 %d 项不一致" % problems))


if __name__ == "__main__":
    main()
