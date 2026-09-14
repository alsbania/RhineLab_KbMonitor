# -*- coding: utf-8 -*-
"""
抓取【本人】课表脚本 —— 正方教务系统 (jwglxt)
================================================================
只用于抓取"自己账号登录后可见的自己的课表"，不绕过任何权限校验。

用法（二选一准备凭证，推荐 curl 方式）：
  方式 A（推荐，最稳）：
    1) 用浏览器登录你学校的教务系统，进入"我的课表"页面
    2) F12 打开开发者工具 → Network(网络) 面板 → 在课表页上点一次"查询"或刷新页面
    3) 找到名为 xskbcx_cxXsKb 的请求（类型 xhr）
    4) 右键该请求 → Copy → Copy as cURL (bash)
    5) 把整行内容粘贴保存到本脚本同目录的 curl.txt
  方式 B：
    在上述同一个请求的 Headers → Request Headers 里找到 Cookie 一行，
    把 "Cookie: " 之后的值整段复制，保存为 cookie.txt

运行：
  pip install requests
  python fetch_kb.py                 # 默认抓"当前学期"
  python fetch_kb.py --base https://jwglxt.example.edu.cn/jwglxt
  python fetch_kb.py --xnm 2025-2026 --xqm 3     # 指定学年学期 (3=第一学期 12=第二学期)
  python fetch_kb.py --xnm 2025-2026 --xqm 12

教务系统根地址取用顺序：--base 参数 > 同目录 config.json 的 base 字段 > 内置占位。
（config.json 由 KbMonitor 首次启动时自动生成，直接改那里也可以。）

输出（生成在当前目录）：
  kb_<学年>_<学期>.json  原始接口数据（完整保留所有字段）
  kb_<学年>_<学期>.csv   Excel 可直接打开的课表
  kb_<学年>_<学期>.md     Markdown 表格
  同时终端会打印一份按星期排好的课表

注意：
  - 必须在能访问学校教务系统的网络环境（校园网/VPN）下运行
  - Cookie 会过期；提示"未登录/会话无效"时回浏览器刷新课表页后重新复制
  - 仅限抓取本人数据，不要尝试用它查别人的信息
"""
import argparse
import csv
import datetime as _dt
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests

DEFAULT_BASE = "https://jwglxt.example.edu.cn/jwglxt"


def resolve_base(cli_base=None):
    """教务系统根地址：命令行 > config.json 的 base > 内置占位。

    原先这里是一个写死的学校地址常量 —— 换个学校就得改源码，也把具体学校
    钉进了公开仓库。改为读 KbMonitor 生成的那份 config.json，与主程序共用一处配置。
    """
    if cli_base:
        return cli_base.rstrip("/")
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
    try:
        with open(cfg, encoding="utf-8") as f:
            base = str(json.load(f).get("base", "")).strip()
        if base.startswith("http"):
            return base.rstrip("/")
    except Exception:
        pass
    return DEFAULT_BASE


BASE = DEFAULT_BASE
KB_PAGE_URL = BASE + "/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default"
KB_API_URL = BASE + "/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151&layout=default"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

XQM_NAME = {"3": "第一学期(秋季)", "12": "第二学期(春季)", "16": "第三学期(暑期)"}
WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def default_term():
    """按当前日期推断所在学期。9-12月/1-2月→第一学期，其余→第二学期。"""
    now = _dt.date.today()
    m = now.month
    if 9 <= m <= 12:
        return f"{now.year}-{now.year + 1}", "3"
    if 1 <= m <= 2:
        return f"{now.year - 1}-{now.year}", "3"
    return f"{now.year - 1}-{now.year}", "12"


# ---------- 凭证解析 ----------

def parse_curl(path):
    text = open(path, encoding="utf-8", errors="ignore").read()
    headers = {}
    for m in re.finditer(r"""-H\s+(['"])(.*?)\1""", text, re.S):
        name, _, value = m.group(2).partition(":")
        headers.setdefault(name.strip(), value.strip())
    m = re.search(r"""-b\s+(['"])(.*?)\1""", text, re.S)
    if m:
        headers["Cookie"] = m.group(2)
    m = re.search(r"""-A\s+(['"])(.*?)\1""", text, re.S)
    if m:
        headers.setdefault("User-Agent", m.group(2))
    datas = re.findall(r"""(?:--data(?:-raw|-urlencode)?|-d)\s+(['"])(.*?)\1""", text, re.S)
    data = "&".join(d[1] for d in datas) if datas else None
    m = re.search(r"https?://[^\s'\"]+", text)
    url = m.group(0) if m else None
    if data:
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    headers.setdefault("User-Agent", UA)
    return url, data, headers


def clean_cookie(path):
    c = open(path, encoding="utf-8", errors="ignore").read().strip()
    if c.lower().startswith("cookie:"):
        c = c[c.index(":") + 1:].strip()
    return c


# ---------- 课表字段解析（不同版本字段名略有差异，做兼容） ----------

def pick(item, *keys, default=""):
    for k in keys:
        v = item.get(k)
        if v not in (None, ""):
            return v
    return default


def parse_day(item):
    xq = pick(item, "xqjmc", "xqj", "xingqi")
    if xq is None:
        return None
    if isinstance(xq, int) or str(xq).isdigit():
        return int(xq)
    s = str(xq)
    m = re.search(r"[一二三四五六日天1-7]", s)
    if m:
        g = m.group(0)
        if g.isdigit():
            return int(g)
        return "一二三四五六日天".index(g) + 1
    return None


def parse_period(item):
    """返回 (开始节次, 结束节次)。"""
    m = re.search(r"(\d+)\s*[-—~至]?\s*(\d*)", str(pick(item, "jcs", "jc")))
    if m:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        return start, end
    try:
        return int(pick(item, "jcor", "ksjc")), int(pick(item, "jcel", "jsjc"))
    except (TypeError, ValueError):
        return None, None


def to_rows(kb_list):
    rows = []
    for item in kb_list or []:
        day = parse_day(item)
        start, end = parse_period(item)
        if day is None or start is None:
            continue
        rows.append({
            "day": day,
            "start": start,
            "end": end,
            "name": str(pick(item, "kcmc", "kcm")),
            "teacher": str(pick(item, "skr", "jsxm", "xm")),
            "room": str(pick(item, "jxdd", "jxcdmc", "cdmc")),
            "weeks": str(pick(item, "zcd", "zcs")),
            "detail": item,
        })
    rows.sort(key=lambda r: (r["day"], r["start"]))
    return rows


# ---------- 输出 ----------

def save_outputs(rows, kb_list, xnm, xqm, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tag = f"kb_{xnm.replace('-', '')}_{xqm}"

    with open(os.path.join(out_dir, tag + ".json"), "w", encoding="utf-8") as f:
        json.dump({"xnm": xnm, "xqm": xqm, "kbList": kb_list}, f,
                  ensure_ascii=False, indent=2)

    with open(os.path.join(out_dir, tag + ".csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["星期", "节次", "课程", "教师", "教室", "周次"])
        for r in rows:
            w.writerow([WEEKDAYS[r["day"] - 1],
                        f"{r['start']}-{r['end']}" if r["end"] != r["start"] else str(r["start"]),
                        r["name"], r["teacher"], r["room"], r["weeks"]])

    md_lines = ["| 星期 | 节次 | 课程 | 教师 | 教室 | 周次 |",
                "|---|---|---|---|---|---|"]
    for r in rows:
        jc = f"{r['start']}-{r['end']}" if r["end"] != r["start"] else str(r["start"])
        md_lines.append(f"| {WEEKDAYS[r['day'] - 1]} | {jc} | {r['name']} | "
                        f"{r['teacher']} | {r['room']} | {r['weeks']} |")
    with open(os.path.join(out_dir, tag + ".md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"\n===== 课表 {xnm} 学年 {XQM_NAME.get(xqm, xqm)} ({len(rows)} 条) =====")
    for r in rows:
        jc = f"{r['start']}-{r['end']}" if r["end"] != r["start"] else str(r["start"])
        print(f"  {WEEKDAYS[r['day'] - 1]} 第{jc}节  {r['name']}  "
              f"[{r['teacher']}] [{r['room']}] [{r['weeks']}]")
    print(f"\n已保存: {os.path.join(out_dir, tag + '.json')} / .csv / .md")


def request_json(url, data, headers):
    resp = requests.post(url, data=data, headers=headers, timeout=20) if data \
        else requests.get(url, headers=headers, timeout=20)
    if "login_slogin" in resp.url:
        raise RuntimeError("会话无效：请求被重定向到登录页，Cookie 可能已过期")
    try:
        return resp.json()
    except Exception:
        raise RuntimeError("返回内容不是 JSON（可能未登录、被校园网拦截或已失效）：\n"
                           + resp.text[:300])


def main():
    ap = argparse.ArgumentParser(description="抓取本人课表（正方教务 jwglxt）")
    ap.add_argument("--xnm", help="学年，如 2025-2026（默认按当前日期推断）")
    ap.add_argument("--xqm", choices=sorted(XQM_NAME), help="学期代码：3 第一学期 / 12 第二学期 / 16 第三学期")
    ap.add_argument("--cookie-file", default="cookie.txt", help="方式B：Cookie 文本文件")
    ap.add_argument("--curl-file", default="curl.txt", help="方式A：curl 命令文本文件")
    ap.add_argument("--out-dir", default=".", help="输出目录")
    ap.add_argument("--base", help="教务系统根地址（默认读同目录 config.json 的 base）")
    args = ap.parse_args()

    # 根地址在解析参数后才能定，所以 KB_PAGE_URL / KB_API_URL 在这里重算，
    # 不能用模块级那份常量。
    global BASE, KB_PAGE_URL, KB_API_URL
    BASE = resolve_base(args.base)
    KB_PAGE_URL = BASE + "/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default"
    KB_API_URL = BASE + "/kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151&layout=default"
    print("教务系统：{}".format(BASE))

    curl_path = args.curl_file if os.path.exists(args.curl_file) else None
    cookie_path = args.cookie_file if os.path.exists(args.cookie_file) else None
    if not curl_path and not cookie_path:
        print("找不到凭证文件。请先二选一准备（详见本文件头部注释）：")
        print("  A) 登录课表页后，F12 → Network 找到 xskbcx_cxXsKb 请求 → Copy as cURL → 存为 curl.txt")
        print("  B) 复制该请求头中的 Cookie 值 → 存为 cookie.txt")
        return 1

    xnm, xqm = default_term()
    if args.xnm:
        xnm = args.xnm
    if args.xqm:
        xqm = args.xqm

    kb_list = None
    if curl_path:
        print(f"[凭证] 使用 {curl_path}（完整重放浏览器请求）")
        url, data, headers = parse_curl(curl_path)
        if not url:
            print("curl.txt 解析失败：没找到 URL")
            return 1
        payload = data if data else {"xnm": xnm, "xqm": xqm, "kzlx": "ck"}
        j = request_json(url, payload, headers)
        kb_list = (j or {}).get("kbList")
        if kb_list is None:
            print("接口返回里没有 kbList，原始返回：")
            print(json.dumps(j, ensure_ascii=False, indent=2)[:2000])
            return 3
    else:
        cookie = clean_cookie(cookie_path)
        print(f"[凭证] 使用 {cookie_path}（登录会话 Cookie）")
        probe = requests.get(KB_PAGE_URL,
                             headers={"User-Agent": UA, "Cookie": cookie}, timeout=20)
        if "login_slogin" in probe.url or "用户名" in probe.text[:2000]:
            print("Cookie 无效或已过期：请重新登录教务系统，打开课表页刷新后再次复制。")
            return 2
        headers = {"User-Agent": UA,
                   "Referer": KB_PAGE_URL,
                   "X-Requested-With": "XMLHttpRequest",
                   "Cookie": cookie}
        j = request_json(KB_API_URL,
                         {"xnm": xnm, "xqm": xqm, "kzlx": "ck"}, headers)
        kb_list = (j or {}).get("kbList")
        if not kb_list:
            print(f"{xnm} 学年 {XQM_NAME.get(xqm)} 没有查到课表（可能确实没课，或该学期不在选课结果中）。")
            print("如果确认有课，可尝试指定其它学期：--xnm 2025-2026 --xqm 3 / 12")
            kb_list = []

    rows = to_rows(kb_list)
    save_outputs(rows, kb_list, xnm, xqm, args.out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
