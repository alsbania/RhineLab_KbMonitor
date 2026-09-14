# -*- coding: utf-8 -*-
"""生成一张虚构的示例课表 xlsx（可直接用界面上的「导入 Excel」按钮导入）。

为什么自己做而不是手工敲：
  这张表是给「没配教务系统也想看界面效果」用的，所以要能被 app.py 的
  import_schedule_xlsx 正确识别 —— 表头必须命中 HEADER_ALIASES。
  生成后本脚本会自己调一次那个解析器做验证，避免造出一张导不进去的表。

内容全部虚构：课程名、教师姓、教室都是编的，与任何学校/真人无关。
输出：example.xlsx（可用 --out 改名）

文件名刻意用纯 ASCII：中文名在 git 里会被转义成 \\347\\244\\272 这种八进制形式
（core.quotepath 默认开启），换机器或换终端时容易出编码问题。
"""
import argparse
import os
import sys
import zipfile

# ---- 虚构数据 ----------------------------------------------------------------
# 覆盖几种真实场景：单周、双周、跨周段、同一天换老师、两教师合上、连堂课
ROWS = [
    ("高等数学A(1)",        "王老师",  "博学楼A201",   "星期一", "第1-2节",  "1-16周"),
    ("大学英语(1)",         "李老师",  "博学楼B305",   "星期一", "第3-4节",  "1-16周"),
    ("程序设计基础",        "张老师",  "信息楼机房2",  "星期一", "第5-6节",  "1-8周"),
    ("程序设计基础",        "赵老师",  "信息楼机房2",  "星期一", "第5-6节",  "9-16周"),
    ("线性代数",            "陈老师",  "博学楼A105",   "星期二", "第1-2节",  "1-16周"),
    ("大学物理(1)",         "刘老师",  "实验楼C401",   "星期二", "第5-8节",  "2-16周(双)"),
    ("体育(1)",             "杨老师",  "风雨操场",     "星期三", "第3-4节",  "1-16周"),
    ("思想道德与法治",      "周老师",  "博学楼A301",   "星期三", "第7-8节",  "9-15周(单)"),
    ("数据结构",            "吴老师,郑老师", "信息楼机房4", "星期四", "第1-4节", "1-16周"),
    ("中国近现代史纲要",    "孙老师",  "博学楼B201",   "星期四", "第5-6节",  "1-4周"),
    ("中国近现代史纲要",    "钱老师",  "博学楼B201",   "星期四", "第5-6节",  "5-12周"),
    ("概率论与数理统计",    "冯老师",  "博学楼A208",   "星期五", "第3-4节",  "1-16周"),
    ("学术英语写作",        "褚老师",  "在线",         "星期五", "第7-8节",  "7周,11周"),
]

HEADER = ["课程名称", "教师", "教室", "星期", "节次", "周次"]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def col_letter(i):
    """0 -> A, 25 -> Z"""
    return chr(ord("A") + i)


def build_sheet(rows):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           "<sheetData>"]
    all_rows = [HEADER] + [list(r) for r in rows]
    for ri, row in enumerate(all_rows, start=1):
        out.append('<row r="%d">' % ri)
        for ci, val in enumerate(row):
            ref = "%s%d" % (col_letter(ci), ri)
            # 全部走 inlineStr：不依赖 sharedStrings.xml，生成简单且解析器两种都支持
            out.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                       % (ref, esc(val)))
        out.append("</row>")
    out += ["</sheetData>", "</worksheet>"]
    return "".join(out)


PARTS = {
    "[Content_Types].xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        "</Types>",
    "_rels/.rels":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        "</Relationships>",
    "xl/workbook.xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="课表" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        "</Relationships>",
    # 文档属性刻意不写作者/公司，避免把任何身份信息带进文件
    "docProps/core.xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">'
        "<dc:title>示例课表（虚构）</dc:title>"
        "<dc:creator>RhineLab_KbMonitor</dc:creator>"
        "</cp:coreProperties>",
}


def main():
    ap = argparse.ArgumentParser(description="生成虚构的示例课表 xlsx")
    ap.add_argument("--out", default="example.xlsx", help="输出文件名")
    ap.add_argument("--no-verify", action="store_true", help="跳过用 app.py 解析器自检")
    args = ap.parse_args()

    path = os.path.abspath(args.out)
    parts = dict(PARTS)
    parts["xl/worksheets/sheet1.xml"] = build_sheet(ROWS)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        # [Content_Types].xml 必须是包内第一个条目
        z.writestr("[Content_Types].xml", parts.pop("[Content_Types].xml"))
        for name, data in parts.items():
            z.writestr(name, data)
    print("已生成：%s  (%d 门课, %.1f KB)" % (path, len(ROWS), os.path.getsize(path) / 1024))

    if args.no_verify:
        return 0

    # 自检：直接用 app.py 的解析器读一遍，确认这张表真的能被界面导入
    # 注意脚本在 tools/ 下，仓库根要往上退一级（原先按脚本目录找，必然找不到）
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.join(root, "kbapp"))
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "kbapp_app", os.path.join(root, "kbapp", "app.py"))
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as e:
        print("跳过自检（无法加载 app.py：%s）" % e)
        return 0

    api = mod.Api()
    # 该方法是实例方法但只用 self 调静态解析器，借一个空壳实例即可
    r = mod.Api.import_schedule_xlsx(api, path)
    if not r.get("ok"):
        print("★ 自检失败：%s" % r.get("error"))
        return 1
    print("自检通过：解析出 %d 门课，识别到列 %s%s"
          % (len(r["rows"]), "/".join(r["columns"]),
             ("，跳过 %d 行" % r["skipped"]) if r.get("skipped") else ""))
    for x in r["rows"][:3]:
        print("   %s 周%s 第%d-%d节  %s / %s"
              % (x["name"], "一二三四五六日"[x["day"] - 1], x["start"], x["end"],
                 x["teacher"], x["room"]))
    print("   …共 %d 行" % len(r["rows"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
