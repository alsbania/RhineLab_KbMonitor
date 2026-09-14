# -*- coding: utf-8 -*-
"""
课表变化监控 + 微信推送（正方教务系统 jwglxt）
=================================================
每次运行：
  1) 登录教务系统（学号 + 密码）或复用 Cookie
  2) 抓取指定学期课表
  3) 与上次结果对比
  4) 只有"发生变化 / 首次建基线 / --test / 出错"时才推送到微信（Server酱 / PushPlus）
  5) 保存状态(kb_state.json)与日志(monitor.log)

使用界面：直接运行 KbMonitor.exe（或 python kbapp/app.py）。首次启动会在同目录
自动生成 config.json 模板，界面把配置面板推到前台引导填写。

命令行用法：
  python monitor_kb.py            # 单次运行（配合 Windows 任务计划程序）
  python monitor_kb.py --test     # 不管有没有变化都推一条测试消息
  python monitor_kb.py --debug    # 打印登录/抓取细节，便于排错
  python monitor_kb.py --loop     # 常驻进程，每天 10:00 / 17:00 自动跑
  python monitor_kb.py --xnm 2025-2026 --xqm 3   # 临时指定学年学期

依赖：pip install requests（微信推送为可选的纯 ctypes 本地自动化，无额外依赖）

配置：同目录 config.json，首次运行自动生成模板。学号与密码只存在本机这一个文件里，
不会被上传到任何地方 —— 该文件已在 .gitignore 中，切勿提交或放进网盘。
仅用于抓取"自己账号登录后可见的自己的课表"，不做任何越权/绕过操作。
"""
import argparse
import base64
import datetime as dt
import json
import os
import re
import sys
import time
import traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

def app_dir():
    """配置/状态存放目录：打包成 exe 后为 exe 所在目录，开发时为脚本目录。
    同时把 exe 目录加入 sys.path，使同目录模块可覆盖内置版本（改微信模块等无需重新打包）。"""
    if getattr(sys, "frozen", False):
        d = os.path.dirname(sys.executable)
        if d not in sys.path:
            sys.path.insert(0, d)
        return d
    return os.path.dirname(os.path.abspath(__file__))


HERE = app_dir()
CONFIG_PATH = os.path.join(HERE, "config.json")
STATE_PATH = os.path.join(HERE, "kb_state.json")
LOG_PATH = os.path.join(HERE, "monitor.log")
# 界面侧的两个状态文件（与 config.json 并排，用户可直接查看/备份）：
#   ui_prefs.json        外观与阵列画质
#   schedule_cache.json  上次看到的课表
UI_PREFS_PATH = os.path.join(HERE, "ui_prefs.json")
SCHEDULE_CACHE_PATH = os.path.join(HERE, "schedule_cache.json")
XQM_NAME = {"3": "第一学期(秋季)", "12": "第二学期(春季)", "16": "第三学期(暑期)"}


def sem_label(xqm):
    """学期代码 → 人类可读名称（避免"第3学期/第一学期"混用造成困惑）。"""
    return XQM_NAME.get(str(xqm), "第{}学期".format(xqm))

import requests

try:
    import wechat_ui  # 微信电脑版本地自动化推送（可选，纯 ctypes 无依赖）
except Exception:
    wechat_ui = None

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


# ---------------- 基础工具 ----------------

def log(msg):
    line = "[{}] {}".format(dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 1024 * 1024:
            # 日志超过 1MB 自动裁剪，只保留最近 500 行，避免无限增长
            with open(LOG_PATH, encoding="utf-8", errors="ignore") as f:
                tail = f.readlines()[-500:]
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                f.writelines(tail)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def write_default_config(path):
    """写一份可直接启动的配置模板（凭据留空，由界面引导填写）。

    优先复制随源码分发的 config.example.json —— 那份是仓库里的模板，与本函数
    内置的兜底内容一致。exe 里未必带得到它（PyInstaller 只收 kbapp/web），
    所以两条路都要能用：拿不到就落内置的一份。
    """
    tpl = os.path.join(HERE, "config.example.json")
    if os.path.exists(tpl):
        try:
            with open(tpl, encoding="utf-8") as f:
                cfg = json.load(f)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            return cfg
        except Exception as e:
            log("复制 config.example.json 失败，改用内置模板：{}".format(e))
    cfg = {
        "base": "请填教务系统根地址，例如 https://jwglxt.example.edu.cn/jwglxt",
        "auth": {
            "mode": "login",
            "username": "在这里填学号",
            "password": "",
            "encrypt": "auto",
            "cookie": "",
            "cookie_file": "",
        },
        "term": {"auto": True, "xnm": "", "xqm": "3", "start_date": ""},
        "push": {"provider": "none", "sendkey": "", "pushplus_token": "", "wechat_contact": ""},
        "notify": {"on_start": True, "on_waiting": True, "on_change": True, "on_error": True},
        "schedule": {"times": ["10:00", "11:00", "12:00", "14:00", "17:00"]},
        "monitor": {"enabled": True},
        "ui": {"density": "standard"},
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


def load_config(path):
    """读配置。文件不存在时按「尚未配置」处理，而不是直接退出。

    原先这里是 raise SystemExit —— 双击 exe 会立刻闪退，用户看不到任何界面，
    只能自己去猜要手抄一份 config.json，这与「开箱即用」正好相反。
    现在首次启动会落一份模板，界面读取 auth.username 里的"在这里填学号"标记为
    未配置状态，自动把配置面板推到前台。
    """
    if not os.path.exists(path):
        try:
            return write_default_config(path)
        except Exception as e:      # 目录只读等：不阻断启动，交给界面提示
            log("写入配置模板失败：{}".format(e))
            return {"base": "", "auth": {}, "term": {"auto": True},
                    "push": {"provider": "none"}, "notify": {}}
    if os.path.getsize(path) == 0:  # 被截断/写坏的 0 字节文件
        return write_default_config(path)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def default_term():
    now = dt.date.today()
    m = now.month
    if 9 <= m <= 12:
        return "{}-{}".format(now.year, now.year + 1), "3"
    if 1 <= m <= 2:
        return "{}-{}".format(now.year - 1, now.year), "3"
    return "{}-{}".format(now.year - 1, now.year), "12"


def _retry_call(fn, tries=2, delay=8):
    """网络请求自动重试（仅连接失败/超时类），默认再试 1 次，避免长时间反复轰炸。"""
    last = None
    for i in range(tries):
        try:
            return fn()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last = e
            if i < tries - 1:
                log("网络请求失败（{}），{} 秒后重试 {}/{}".format(
                    repr(e)[:80], delay, i + 2, tries))
                time.sleep(delay)
    raise last


# ---------------- 登录 ----------------

def rsa_encrypt(modulus_hex, exponent_hex, message):
    """RSA PKCS#1 v1.5 加密，返回小写 hex（正方登录 mm 字段的常见形式）。"""
    n = int(modulus_hex, 16)
    e = int(exponent_hex, 16)
    k = (n.bit_length() + 7) // 8
    mb = message.encode("utf-8")
    if len(mb) > k - 11:
        raise ValueError("待加密内容过长")
    ps = bytes(b if b != 0 else 1 for b in os.urandom(k - len(mb) - 3))
    em = b"\x00\x02" + ps + b"\x00" + mb
    return format(pow(int.from_bytes(em, "big"), e, n), "x")


def find_rsa_key(html):
    m = re.search(r"""(?:modulus|mod)\s*[:=]\s*["']([0-9A-Fa-f]{16,})["']""", html)
    if m:
        e = re.search(r"""(?:exponent|exp|publicExponent)\s*[:=]\s*["']([0-9A-Fa-f]{2,})["']""", html)
        if e:
            return m.group(1), e.group(1)
    return None, None


def _fetch_public_key(session, base, debug):
    """部分正方部署（ZFTAL v5）：RSA 公钥由接口动态下发，modulus/exponent 为 base64。
    返回 (modulus_hex, exponent_hex)；不可用时返回 (None, None)。"""
    try:
        r = session.get(base + "/xtgl/login_getPublicKey.html?time=" + str(int(time.time() * 1000)),
                        timeout=15)
        j = r.json()
        mb, eb = j.get("modulus", ""), j.get("exponent", "")
        if mb and eb:
            n = base64.b64decode(mb).hex()
            e = base64.b64decode(eb).hex()
            if debug:
                log("[debug] 动态公钥接口 OK，n {} 字节, e {}".format(len(n) // 2, e))
            return n, e
    except Exception as ex:
        if debug:
            log("[debug] 动态公钥接口不可用：{}".format(repr(ex)[:100]))
    return None, None


def login(session, cfg, debug, retries=True):
    base = cfg["base"].rstrip("/")
    login_url = base + "/xtgl/login_slogin.html"
    # retries=False（界面手动查询）：单次尝试、超时更短，学校不通时快速失败不刷屏
    if retries:
        r = _retry_call(lambda: session.get(login_url, headers={"User-Agent": UA}, timeout=20))
    else:
        r = session.get(login_url, headers={"User-Agent": UA}, timeout=15)
    html = r.text

    csrf = ""
    m = re.search(r"""(?:name|id)=["']csrftoken["'][^>]*value=["']([^"']+)["']""", html)
    if not m:
        m = re.search(r"""value=["']([^"']+)["'][^>]*(?:name|id)=["']csrftoken["']""", html)
    if m:
        csrf = m.group(1)
    if not csrf:
        csrf = session.cookies.get("csrftoken", "")

    # 登录页隐藏开关：mmsfjm=0 → 明文提交；非 0 → RSA（公钥走接口，密文 base64）
    mmsfjm = "0"
    mm = re.search(r'name="mmsfjm"[^>]*value="?([0-9])', html)
    if mm:
        mmsfjm = mm.group(1)

    username = cfg["auth"].get("username", "")
    password = cfg["auth"].get("password", "")
    encrypt = cfg["auth"].get("encrypt", "auto")

    if encrypt == "none":
        mode = "none"
    elif encrypt in ("rsa_username_password",):
        mode = "rsa_username_password"  # 兼容旧版：页面内嵌公钥 + %%% + hex
    else:  # auto / rsa_password
        mode = "none" if mmsfjm == "0" else "rsa"
    if debug:
        log("[debug] csrftoken: {} mmsfjm: {} → 模式: {}".format(
            csrf[:16] + ("..." if len(csrf) > 16 else ""), mmsfjm, mode))

    if mode == "none":
        mm_field = password
        if debug:
            log("[debug] 明文提交密码")
    elif mode == "rsa":
        n_hex, e_hex = _fetch_public_key(session, base, debug)
        if n_hex:
            cipher = rsa_encrypt(n_hex, e_hex, password)
            mm_field = base64.b64encode(bytes.fromhex(cipher)).decode()
            if debug:
                log("[debug] RSA(b64) 密文长度: {}".format(len(mm_field)))
        else:
            mm_field = password  # 取不到公钥时退回明文
    else:  # rsa_username_password（旧版内嵌公钥）
        modulus, exponent = find_rsa_key(html)
        if modulus:
            mm_field = rsa_encrypt(modulus, exponent, username + "%%%" + password)
        else:
            mm_field = password

    data = {"csrftoken": csrf, "language": "zh_CN", "yhm": username, "mm": mm_field}
    headers = {
        "User-Agent": UA,
        "Referer": login_url,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
    }
    if retries:
        r2 = _retry_call(lambda: session.post(login_url, data=data, headers=headers, timeout=20))
    else:
        r2 = session.post(login_url, data=data, headers=headers, timeout=15)
    if debug:
        log("[debug] 登录 POST status: {} url: {}".format(r2.status_code, r2.url[:120]))
    return session


def build_session(cfg):
    s = requests.Session()
    s.headers["User-Agent"] = UA
    auth = cfg.get("auth", {})
    if auth.get("mode") == "cookie":
        ck = auth.get("cookie", "").strip()
        if not ck and auth.get("cookie_file"):
            p = auth["cookie_file"]
            if os.path.exists(p):
                ck = open(p, encoding="utf-8", errors="ignore").read().strip()
        s.headers["Cookie"] = ck
    return s


def parse_curl(text):
    """解析浏览器 Copy as cURL 命令，返回 (url, data, headers)。"""
    headers = {}
    for m in re.finditer(r"""-H\s+(['"])(.*?)\1""", text, re.S):
        name, _, value = m.group(2).partition(":")
        headers.setdefault(name.strip(), value.strip())
    m = re.search(r"""-b\s+(['"])(.*?)\1""", text, re.S)
    if m:
        headers["Cookie"] = m.group(2)
    datas = re.findall(r"""(?:--data(?:-raw|-urlencode)?|-d)\s+(['"])(.*?)\1""", text, re.S)
    data = "&".join(d[1] for d in datas) if datas else None
    m = re.search(r"https?://[^\s'\"]+", text)
    url = m.group(0) if m else None
    if data:
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    headers.setdefault("User-Agent", UA)
    return url, data, headers


def replay_kb(cfg, debug):
    """用 curl.txt（浏览器真实请求）重放课表查询，用于定位接口差异。"""
    p = cfg.get("kb", {}).get("replay_file") or os.path.join(HERE, "curl_kb.txt")
    if not os.path.exists(p):
        raise RuntimeError("重放模式需要 curl_kb.txt（见 kb.replay_file）")
    url, data, headers = parse_curl(open(p, encoding="utf-8", errors="ignore").read())
    if not url:
        raise RuntimeError("curl_kb.txt 解析失败：没找到 URL")
    s = requests.Session()
    s.headers.update(headers)
    r = s.post(url, data=data, headers=headers, timeout=20) if data \
        else s.get(url, headers=headers, timeout=20)
    if debug:
        log("[debug] 重放 {} status {} len {}".format(url[:80], r.status_code, len(r.text)))
    try:
        j = r.json()
    except Exception:
        raise RuntimeError("重放返回非 JSON：" + r.text[:200])
    kb = _extract_kb_list(j)
    if debug:
        log("[debug] 重放提取课表 {} 条".format(len(kb)))
    return kb


# ---------------- 抓课表 ----------------

def _extract_kb_list(j):
    """从接口 JSON 中尽力找出课表数组；null / 无数据 → []（视为"该学期课表未开放"，不是错误）。"""
    if not isinstance(j, dict):
        return []
    for k in ("kbList", "xskbList", "kblist", "list", "kbRows"):
        v = j.get(k)
        if isinstance(v, list):
            return v
    for v in j.values():
        if isinstance(v, list) and v and isinstance(v[0], dict) and (
                "kcmc" in v[0] or "kcm" in v[0] or "xqjmc" in v[0] or "jcs" in v[0]):
            return v
    return []


def fetch_kb(session, cfg, xnm, xqm, debug, retries=True):
    """抓课表（此部署已验证：cxXsgrkb + xnm=起始年 + xqh_id=1）。
    null / kbList 为空 = 课表未开放，返回 []（正常态）；仅真正的会话/网络问题才抛异常。"""
    base = cfg["base"].rstrip("/")
    kb_cfg = cfg.get("kb", {})
    apis = kb_cfg.get("apis") or ["xskbcx_cxXsgrkb.html"]
    xqh_id = str(kb_cfg.get("xqh_id", "1"))
    # 此部署 xnm 只填学年起始年（如 2025），兼容 "2025-2026" 写法
    xnm_start = xnm.split("-")[0]
    headers = {
        "User-Agent": UA,
        "Referer": base + "/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }
    last_err = None
    for api_name in apis:
        api = base + "/kbcx/" + api_name
        if "?" not in api_name:
            api += "?gnmkdm=N2151"
        data = {"xnm": xnm_start, "xqm": xqm, "xqh_id": xqh_id,
                "kzlx": "ck", "xsdm": "", "kclbdm": "", "kclxdm": ""}
        try:
            if retries:
                r = _retry_call(lambda: session.post(api, data=data, headers=headers, timeout=20))
            else:
                r = session.post(api, data=data, headers=headers, timeout=15)
        except Exception as ex:
            last_err = ex
            continue
        if "login_slogin" in r.url:
            raise RuntimeError("会话无效（被跳转到登录页）——账号密码错误或 Cookie 过期")
        try:
            j = r.json()
        except Exception:
            if api_name != apis[-1]:
                last_err = RuntimeError("非 JSON 响应")
                continue
            raise RuntimeError("返回不是 JSON（未登录/网络问题/被拦截）：" + r.text[:200])
        kb = _extract_kb_list(j)
        if debug:
            log("[debug] {} xnm={} xqm={} → 课表条目 {} 条".format(
                api_name.split("?")[0], xnm_start, xqm, len(kb)))
        if kb or api_name == apis[-1]:
            return kb
        last_err = None
    if last_err is not None:
        raise RuntimeError("抓取失败：" + repr(last_err))
    return []


# ---------------- 解析 / 对比 ----------------

def parse_day(it):
    xq = it.get("xqjmc", it.get("xqjm", it.get("xqj", it.get("xingqi", ""))))
    if xq is None:
        return None
    if isinstance(xq, int) or (isinstance(xq, str) and xq.isdigit()):
        n = int(xq)
        return n if 1 <= n <= 7 else None
    m = re.search(r"[一二三四五六日天1-7]", str(xq))
    if not m:
        return None
    g = m.group(0)
    if g.isdigit():
        return int(g)
    return "一二三四五六日天".index(g) + 1


def parse_period(it):
    raw = str(it.get("jcs", it.get("jc", "")))
    if not raw.strip():
        raw = str(it.get("jcor", it.get("ksjc", "")))
    m = re.search(r"(\d{1,2})\s*[-–—~至到]?\s*(\d{1,2})?", raw)
    if not m:
        return None
    s = int(m.group(1))
    e = int(m.group(2)) if m.group(2) else s
    if not m.group(2):
        j2 = str(it.get("jcel", it.get("jsjc", "")))
        if j2.isdigit():
            e = int(j2)
    return (min(s, e), max(s, e))


def normalize(kb):
    """宽容解析：星期缺失(dep=0)仍保留；同课重复排课段去重。返回排序后的行。

    去重键必须带 day：同一门课一周上两次（比如「数学建模A」周二、周五同节次、
    同教师、同教室、同周次）在教务数据里是两条独立记录，
    键里不带 day 就会把后一条当"重复排课段"删掉 —— 表现就是周五整列少课。
    """
    rows = []
    seen = set()
    for it in kb or []:
        if not isinstance(it, dict):
            continue
        day = parse_day(it) or 0
        p = parse_period(it)
        name = str(it.get("kcmc") or it.get("kcm") or "").strip()
        if not name:
            continue
        teacher = str(it.get("skr") or it.get("jsxm") or it.get("xm") or "").strip()
        room = str(it.get("jxdd") or it.get("jxcdmc") or it.get("cdmc") or "").strip()
        weeks = str(it.get("zcd") or it.get("zcs") or it.get("qsjsz") or "").strip()
        start, end = (p[0], p[1]) if p else (0, 0)
        key = (day, name, teacher, room, start, end, weeks)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"day": day, "start": start, "end": end,
                     "name": name, "teacher": teacher, "room": room, "weeks": weeks})
    rows.sort(key=lambda r: (r["day"], r["start"], r["name"]))
    return rows


def sig(r):
    return "|".join([str(r["day"]), "{}-{}".format(r["start"], r["end"]),
                     r["name"], r["teacher"], r["room"], r["weeks"]])


def fmt_row(r):
    parts = []
    if r.get("day"):
        parts.append(WEEKDAYS[r["day"] - 1])
    if r.get("start"):
        jc = "{}-{}".format(r["start"], r["end"]) if r.get("end") != r["start"] else str(r["start"])
        parts.append("第{}节".format(jc))
    parts.append(r["name"])
    if r["teacher"]:
        parts.append(r["teacher"])
    if r["room"]:
        parts.append(r["room"])
    if r["weeks"]:
        parts.append(r["weeks"])
    return " · ".join(parts)


def schedule_text(rows):
    """把课表按星期排成适合微信阅读的文本行；星期未知的行归入课程清单。"""
    lines = []
    flat = []
    for d in range(1, 8):
        day_rows = sorted([r for r in rows if r["day"] == d], key=lambda x: x["start"])
        if not day_rows:
            continue
        lines.append("【{}】".format(WEEKDAYS[d - 1]))
        for r in day_rows:
            lines.append("  " + fmt_row(r))
    unknown = [r for r in rows if not r["day"]]
    if unknown:
        lines.append("【课程】")
        for r in sorted(unknown, key=lambda x: (x["start"], x["name"])):
            lines.append("  " + fmt_row(r))
    return lines


def diff(old_rows, new_rows):
    old_map = {sig(r): r for r in old_rows}
    new_map = {sig(r): r for r in new_rows}
    added = [new_map[s] for s in new_map if s not in old_map]
    removed = [old_map[s] for s in old_map if s not in new_map]

    def summary(rs):
        return set("{}-{}-{} {}".format(r["day"], r["start"], r["end"], r["room"], r["weeks"]) for r in rs)

    old_key, new_key = {}, {}
    for r in old_rows:
        old_key.setdefault((r["name"], r["teacher"]), []).append(r)
    for r in new_rows:
        new_key.setdefault((r["name"], r["teacher"]), []).append(r)
    changed = []
    for k in set(old_key) & set(new_key):
        if summary(old_key[k]) != summary(new_key[k]):
            changed.append((k, old_key[k], new_key[k]))
    return added, removed, changed


# ---------------- 推送 ----------------

def push(cfg, title, desp):
    p = cfg.get("push", {})
    provider = p.get("provider", "none")
    if provider == "none":
        log("[push] 未配置推送通道，跳过：{}".format(title))
        return False
    try:
        if provider == "serverchan":
            key = p.get("sendkey", "").strip()
            if not key:
                raise ValueError("config.json 缺少 push.sendkey")
            url = ("https://sctapi.ftqq.com/" if key.upper().startswith("SCT")
                   else "https://sc.ftqq.com/") + key + ".send"
            requests.post(url, data={"title": title[:32], "desp": desp}, timeout=15)
        elif provider == "pushplus":
            tok = p.get("pushplus_token", "").strip()
            if not tok:
                raise ValueError("config.json 缺少 push.pushplus_token")
            requests.post("http://www.pushplus.plus/send",
                          json={"token": tok, "title": title[:100], "content": desp},
                          timeout=15)
        elif provider == "wechat_ui":
            if wechat_ui is None:
                raise ValueError("wechat_ui 模块不可用")
            contact = p.get("wechat_contact", "文件传输助手")
            ok, msg = wechat_ui.send_to_wechat(contact, title + "\n" + desp)
            if not ok:
                raise RuntimeError(msg)
        else:
            raise ValueError("未知推送 provider：" + provider)
        log("[push] 已发送：{}".format(title))
        return True
    except Exception as e:
        log("[push] 发送失败：{}".format(e))
        return False


# ---------------- 主流程 ----------------

def decide_term(cfg, args):
    term = cfg.get("term", {})
    xnm = args.xnm or term.get("xnm")
    xqm = args.xqm or term.get("xqm")
    if term.get("auto", False) or not xnm or not xqm:
        xnm, xqm = default_term()
    return xnm, xqm


def run(cfg, args):
    try:
        xnm, xqm = decide_term(cfg, args)
        now_min = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        # 跨进程分钟级去重：同一分钟内若已有一次运行（系统任务/应用内调度/重复双击）则跳过，
        # 避免同一条消息发两次。手动测试（--test / 完整流程测试）不受此限制。
        if not getattr(args, "test", False):
            st0 = {}
            if os.path.exists(STATE_PATH):
                try:
                    st0 = json.load(open(STATE_PATH, encoding="utf-8"))
                except Exception:
                    st0 = {}
            if st0.get("last_run_minute") == now_min:
                log("跳过：本分钟（{}）已有一次检查，避免重复通知".format(now_min))
                return
            try:
                st0["last_run_minute"] = now_min
                json.dump(st0, open(STATE_PATH, "w", encoding="utf-8"),
                          ensure_ascii=False, indent=2)
            except Exception:
                pass
        log("开始：{} 学年{}".format(xnm, sem_label(xqm)))
        if cfg.get("kb", {}).get("replay"):
            kb = replay_kb(cfg, args.debug)
        else:
            s = build_session(cfg)
            if cfg.get("auth", {}).get("mode") == "login":
                login(s, cfg, args.debug)
            kb = fetch_kb(s, cfg, xnm, xqm, args.debug)
        rows = normalize(kb)

        state = {}
        if os.path.exists(STATE_PATH):
            try:
                state = json.load(open(STATE_PATH, encoding="utf-8"))
            except Exception:
                state = {}
        old_rows = normalize(state.get("kbList") or [])
        added, removed, changed = diff(old_rows, rows)
        now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        notify = cfg.get("notify", {})
        first_run = "kbList" not in state
        had_data_old = bool(old_rows)
        has_now = bool(rows)
        title, desp_lines, do_push = "", [], False

        if args.test:
            # 「完整流程测试」：与定时任务完全相同的真实流程，但无论结果如何都发一条现状消息
            title, do_push = "✅ 完整流程自检（真实查询）", True
            times = load_times(cfg)
            sem = sem_label(xqm)
            desp_lines.append("刚刚真实执行：登录教务系统 → 查询课表 → 发送本条消息。")
            desp_lines.append("查询学期：{} 学年{}".format(xnm, sem))
            if has_now:
                desp_lines.append("📗 现状：课表已开放，共 {} 门课：".format(len(rows)))
                desp_lines += schedule_text(rows[:40])
                if len(rows) > 40:
                    desp_lines.append("…其余 {} 门请在 KbMonitor 界面查看或导出 CSV".format(len(rows) - 40))
            else:
                desp_lines.append("📭 现状：课表尚未开放（0 门课），监控继续等待，开放后立即通知你。")
            desp_lines += ["", "检查时间表：{}".format(" / ".join(times)),
                           "下次检查：{}".format(
                               next_run_at(times, dt.datetime.now()).strftime("%H:%M"))]
        elif first_run and notify.get("on_start", True):
            title, do_push = "课表监控已启动", True
            if has_now:
                desp_lines.append("{} 学年{}：课表已开放，共 {} 门课（基线已建立，之后只在变化时提醒）。".format(xnm, sem_label(xqm), len(rows)))
            else:
                desp_lines.append("正在等待 {} 学年{} 课表开放。".format(xnm, sem_label(xqm)))
                desp_lines.append("每天 10:00 / 17:00 自动检查，课表一开放立即通知你。")
        elif (not had_data_old) and has_now and notify.get("on_change", True):
            title, do_push = "🎉 课表出啦！", True
            desp_lines.append("{} 学年{} 课表已开放，共 {} 门课：".format(xnm, sem_label(xqm), len(rows)))
            desp_lines += schedule_text(rows)
        elif had_data_old and (not has_now) and notify.get("on_change", True):
            title, do_push = "⚠️ 课表变成空了", True
            desp_lines.append("上次有 {} 门课，这次接口返回空——可能课表被撤回或仍未正式开放，建议到教务系统里确认。".format(len(old_rows)))
        elif (added or removed or changed) and notify.get("on_change", True):
            title, do_push = "课表有更新", True
            if added:
                desp_lines.append("**新增**")
                desp_lines += ["- " + fmt_row(r) for r in added]
            if removed:
                desp_lines.append("**取消/移除**")
                desp_lines += ["- " + fmt_row(r) for r in removed]
            if changed:
                desp_lines.append("**变更**")
                for k, olds, news in changed:
                    desp_lines.append("- {}（{}）: {} → {}".format(
                        k[0], k[1], "；".join(fmt_row(r) for r in olds),
                        "；".join(fmt_row(r) for r in news)))
        else:
            do_push = False

        if do_push:
            desp_lines += ["", "查询时间：{}".format(now),
                           "学期：{} {} · 当前 {} 门课".format(xnm, sem_label(xqm), len(rows))]
            push(cfg, title, "\n".join(desp_lines))

        # 「课表还没出」提醒：每次定时检查（每个设定的时间点）都发一条（可在设置里关闭）
        if (not args.test) and (not do_push) and (not rows) and (not first_run) \
                and notify.get("on_waiting", True):
            sem = sem_label(xqm)
            push(cfg, "📭 课表还没出",
                 "{} 学年{} 的课表本次检查仍未开放。\n"
                 "监控正常：按设定时间继续自动检查，课表一开放立即微信通知你。\n"
                 "本次检查时间：{}".format(xnm, sem, now))
            log("已发送『课表还没出』提醒")

        # 保留去重/错误节流等附加字段，只更新课表相关部分
        state["xnm"] = xnm
        state["xqm"] = xqm
        state["kbList"] = kb
        state["updated_at"] = now
        if not getattr(args, "test", False):
            state["last_run_minute"] = now_min
        json.dump(state, open(STATE_PATH, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        if not has_now:
            log("完成：该学期课表尚未开放（空数据），继续监控等待")
        else:
            log("完成：共 {} 门课，新增 {} 取消 {} 变更 {}".format(
                len(rows), len(added), len(removed), len(changed)))
    except Exception as e:
        msg = repr(e)
        is_net = any(k in msg for k in ("ConnectTimeout", "ConnectionError", "timed out",
                                        "Max retries", "Failed to establish", "Connection reset"))
        log("运行失败：" + msg)
        # 同类错误 2 小时内只推送一次（网络波动时避免每个时间点轰炸）
        state2 = {}
        if os.path.exists(STATE_PATH):
            try:
                state2 = json.load(open(STATE_PATH, encoding="utf-8"))
            except Exception:
                state2 = {}
        now_ts = dt.datetime.now()
        sig = "net" if is_net else msg[:120]
        last = state2.get("last_error") or {}
        try:
            recent_same = (last.get("sig") == sig and
                           (now_ts - dt.datetime.fromisoformat(last.get("ts", ""))).total_seconds() < 7200)
        except Exception:
            recent_same = False
        if cfg.get("notify", {}).get("on_error", True) and not recent_same:
            if is_net:
                times = load_times(cfg)
                nxt = next_run_at(times, now_ts).strftime("%H:%M")
                push(cfg, "课表监控异常（网络问题）",
                     "连接学校教务服务器超时/失败，本次检查未完成。\n"
                     "已自动重试 3 次仍失败；下一检查点（{}）会继续自动执行，网络恢复后照常监控。\n"
                     "时间：{}".format(nxt, now_ts.strftime("%Y-%m-%d %H:%M:%S")))
            else:
                push(cfg, "课表监控异常",
                     "监控运行出错：{}\n（完整堆栈见 monitor.log）".format(msg[:200]))
        try:
            state2["last_error"] = {"ts": now_ts.isoformat(timespec="seconds"), "sig": sig}
            json.dump(state2, open(STATE_PATH, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=2)
        except Exception:
            pass
        raise


DEFAULT_TIMES = ["10:00", "17:00"]


def load_times(cfg):
    """读取配置的检查时间列表（"HH:MM"，可任意增删），缺省 10:00/17:00。"""
    times = (cfg.get("schedule") or {}).get("times") or DEFAULT_TIMES
    out = []
    for t in times:
        s = str(t).strip()
        if len(s) == 4 and ":" in s:
            out.append(s)
        elif len(s) == 5 and ":" in s:
            out.append(s)
    if not out:
        out = list(DEFAULT_TIMES)
    return sorted(set(out))


def next_run_at(times, now):
    """给定时间列表，返回 (今天内) 下一个触发时刻。"""
    cands = []
    for t in times:
        try:
            hh, mm = t.split(":")
            cand = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
            if cand > now:
                cands.append(cand)
        except Exception:
            continue
    if cands:
        return min(cands)
    cands = []
    for t in times:
        try:
            hh, mm = t.split(":")
            cands.append(now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
                         + dt.timedelta(days=1))
        except Exception:
            continue
    return min(cands) if cands else now + dt.timedelta(hours=1)


def loop(cfg, args):
    """常驻模式：每 20 秒轮询，命中配置的检查时间（可自定义增删）时各跑一次，同日同时刻不重复。"""
    fired = set()  # "YYYY-MM-DD:HH:MM"
    last_log = ""
    while True:
        now = dt.datetime.now()
        key = now.strftime("%Y-%m-%d") + ":" + now.strftime("%H:%M")
        if now.strftime("%H:%M") in load_times(cfg) and key not in fired:
            try:
                run(cfg, args)
            except Exception:
                pass
            finally:
                fired.add(key)
        if len(fired) > 200:
            keep = {dt.date.today().isoformat(),
                    (dt.date.today() - dt.timedelta(days=1)).isoformat()}
            fired = {k for k in fired if k[:10] in keep}
        nxt = next_run_at(load_times(cfg), dt.datetime.now()).strftime("%Y-%m-%d %H:%M")
        if nxt != last_log:
            last_log = nxt
            log("检查时间：{}｜下次运行：{}".format(" / ".join(load_times(cfg)), nxt))
        time.sleep(20)


def main():
    ap = argparse.ArgumentParser(description="课表变化监控 + 微信推送")
    ap.add_argument("--test", action="store_true", help="发送一条测试消息")
    ap.add_argument("--debug", action="store_true", help="打印登录/抓取细节")
    ap.add_argument("--loop", action="store_true", help="常驻进程，每天 10:00/17:00 运行")
    ap.add_argument("--config", default=CONFIG_PATH, help="配置文件路径")
    ap.add_argument("--xnm", help="强制指定学年，如 2025-2026")
    ap.add_argument("--xqm", help="强制指定学期：3 第一学期 / 12 第二学期")
    args = ap.parse_args()

    cfg = load_config(args.config)
    # 首次运行会落一份空模板。命令行下没有界面可引导，必须直接说清楚缺什么，
    # 否则会一路跑到登录才失败，报错还指向网络层。
    if not str(cfg.get("base", "")).startswith("http") or not cfg.get("auth", {}).get("username"):
        raise SystemExit(
            "配置尚未填写：{}\n"
            "请填入教务系统根地址（base）、学号（auth.username）与密码（auth.password）。\n"
            "图形界面下可直接在配置面板里改，无需手工编辑 JSON。".format(args.config))
    if args.loop:
        loop(cfg, args)
    else:
        try:
            run(cfg, args)
        except SystemExit:
            raise
        except Exception:
            sys.exit(1)


if __name__ == "__main__":
    main()
