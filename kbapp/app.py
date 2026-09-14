# -*- coding: utf-8 -*-
"""RhineLab_KbMonitor 桌面端 —— pywebview 宿主。
GUI 模式：展示课表 / 配置 / 日志 / 定时任务管理。
--silent-check：无窗口静默执行一次检查（供 Windows 任务计划调用）。
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import monitor_kb as core  # noqa: E402

APP_TITLE = "RhineLab_KbMonitor · 课表监控"
LEGACY_TASKS = ["课表监控_10点", "课表监控_17点"]


def task_name_for(hhmm):
    """"10:00" → "课表监控_1000"（系统任务名，与配置的检查时间一一对应）。"""
    return "课表监控_" + str(hhmm).replace(":", "")


def list_my_tasks():
    """列出当前已注册的本应用定时任务名（一次 schtasks 查询，避免逐个探测弹性能开销）。"""
    names = []
    try:
        r = _run_hidden(["schtasks", "/Query", "/FO", "CSV", "/NH"],
                        capture_output=True, timeout=15)
        out = r.stdout or b""
        text = None
        for enc in ("utf-8", "gbk"):
            try:
                text = out.decode(enc)
                break
            except Exception:
                continue
        if text is None:
            text = out.decode("utf-8", "ignore")
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            name = line.split(",")[0].strip().strip('"')
            if name.startswith("课表监控_"):
                names.append(name)
    except Exception:
        pass
    return names


def resource_path(rel):
    # 打包后：优先用 exe 同目录下的外部资源（改前端无需重新打包），否则用内置资源
    if getattr(sys, "frozen", False):
        ext = os.path.join(core.HERE, rel)
        if os.path.exists(ext):
            return ext
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def _run_hidden(args, **kw):
    """启动子进程且不弹出控制台窗口（CREATE_NO_WINDOW），避免黑框/PS 窗口闪烁。"""
    kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(args, **kw)


def _task_exists(name):
    try:
        r = _run_hidden(["schtasks", "/Query", "/TN", name],
                        capture_output=True, timeout=10)
        return r.returncode == 0
    except Exception:
        return False


def _acquire_single_instance():
    """GUI 单实例：已有一个界面在跑时不再开第二个（避免双重调度/重复通知/双倍内存）。"""
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.CreateMutexW.restype = ctypes.c_void_p
        handle = kernel32.CreateMutexW(None, False, "KbMonitorSingleInstance_v1")
        if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            return None
        return handle
    except Exception:
        return True  # 无法判断时不阻止启动


def _task_command():
    if getattr(sys, "frozen", False):
        return '"{}" --silent-check'.format(sys.executable)
    return '"{}" "{}" --silent-check'.format(
        sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py"))


class Api:
    def __init__(self):
        self._running = False
        self._tasks_cache = (0.0, True)

    def _tasks(self):
        """系统任务是否与当前配置的检查时间一致（缓存 5 分钟，单次 CSV 查询，降低子进程开销）。"""
        now = time.time()
        if now - self._tasks_cache[0] < 300:
            return self._tasks_cache[1]
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception:
            cfg = {}
        times = core.load_times(cfg)
        existing = set(list_my_tasks())
        needed = {task_name_for(t) for t in times}
        ok = needed.issubset(existing)
        self._tasks_cache = (now, ok)
        return ok

    @staticmethod
    def _net_error_recent(state, minutes=30):
        """最近 30 分钟内是否发生过网络类故障（用于启动时跳过自动查询，避免刚断网就狂查）。"""
        err = (state or {}).get("last_error") or {}
        if err.get("sig") != "net":
            return False
        try:
            ts = dt.datetime.fromisoformat(err.get("ts", ""))
            return (dt.datetime.now() - ts).total_seconds() < minutes * 60
        except Exception:
            return False

    # ---------- 状态 ----------
    def get_status(self):
        state = {}
        if os.path.exists(core.STATE_PATH):
            try:
                state = json.load(open(core.STATE_PATH, encoding="utf-8"))
            except Exception:
                state = {}
        rows = core.normalize(state.get("kbList") or [])
        cfg = {}
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception:
            pass
        times = core.load_times(cfg)
        nxt = core.next_run_at(times, dt.datetime.now())
        uname = str(cfg.get("auth", {}).get("username", "")).strip()
        configured = bool(uname and "在这里" not in uname and cfg.get("auth", {}).get("password"))
        tasks_ok = self._tasks()
        return {
            "running": self._running,
            "last_check": state.get("updated_at", "-"),
            "count": len(rows),
            "xnm": state.get("xnm") or "",
            "xqm": state.get("xqm") or "",
            "next_run": nxt.strftime("%H:%M"),
            "times": times,
            "tasks_ok": tasks_ok,
            "configured": configured,
            "monitor_enabled": cfg.get("monitor", {}).get("enabled", True) is not False,
            "net_error_recent": self._net_error_recent(state),
        }

    def get_state_rows(self):
        state = {}
        if os.path.exists(core.STATE_PATH):
            try:
                state = json.load(open(core.STATE_PATH, encoding="utf-8"))
            except Exception:
                state = {}
        return core.normalize(state.get("kbList") or [])

    # ---------- 配置 ----------
    # 首次运行（config.json 还不存在）时读随源码分发的模板，让配置面板带着
    # 模板结构显示，而不是一个空对象；模板读不到再退回内置默认。
    def get_config(self):
        for p in (core.CONFIG_PATH, os.path.join(core.HERE, "config.example.json")):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                continue
        return {"base": "", "auth": {}, "term": {"auto": True},
                "push": {"provider": "none"}, "notify": {}}

    def save_config(self, cfg):
        with open(core.CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return {"ok": True}

    # ---------- 两个配置文件 ----------
    # 外观/画质设置与课表缓存各存一个 JSON，放在 exe 同目录（与 config.json 并排）。
    #
    # 为什么不放 localStorage：pywebview 默认 private_mode=True，WebView2 会拿一个
    # 临时目录当用户数据目录、进程退出就删掉 —— 页面里写的 localStorage 下次启动
    # 全是空的。表现就是「设了阵列画质，下次打开又回去了」。写成文件既不受这个影响，
    # 也方便用户自己看/备份。
    def get_ui_prefs(self):
        return self._read_json(core.UI_PREFS_PATH, {})

    def save_ui_prefs(self, prefs):
        return self._write_json(core.UI_PREFS_PATH, prefs if isinstance(prefs, dict) else {})

    def get_schedule_cache(self):
        return self._read_json(core.SCHEDULE_CACHE_PATH, {})

    def save_schedule_cache(self, cache):
        return self._write_json(core.SCHEDULE_CACHE_PATH, cache if isinstance(cache, dict) else {})

    @staticmethod
    def _read_json(path, default):
        try:
            with open(path, encoding="utf-8") as f:
                v = json.load(f)
            return v if isinstance(v, (dict, list)) else default
        except Exception:
            return default

    @staticmethod
    def _write_json(path, obj):
        """先写 .tmp 再 os.replace —— 断电或崩溃不会留下半个文件把设置读坏。"""
        try:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
            return {"ok": True, "path": path}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ---------- 课表导入（xlsx） ----------
    # xlsx 本身就是一个 zip，里面是若干 XML，标准库 zipfile + ElementTree 足够，
    # 不引 openpyxl（打包体积与依赖都会涨，而这里只需要读几个单元格）。
    SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    def pick_schedule_file(self):
        """弹系统文件框选一个 Excel 课表，返回其路径（取消返回空）。"""
        try:
            import webview
            wins = getattr(webview, "windows", None) or []
            if not wins:
                return {"ok": False, "error": "窗口还没准备好"}
            res = wins[0].create_file_dialog(
                webview.OPEN_DIALOG, allow_multiple=False,
                file_types=("Excel 课表 (*.xlsx;*.xlsm)", "所有文件 (*.*)"))
            if not res:
                return {"ok": False, "cancel": True}
            path = res[0] if isinstance(res, (list, tuple)) else res
            return {"ok": True, "path": path}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @classmethod
    def _xlsx_grid(cls, path, max_rows=2000, max_cols=40):
        """把第一个工作表读成二维字符串表。"""
        import zipfile
        import xml.etree.ElementTree as ET

        ns = cls.SHEET_NS
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            shared = []
            if "xl/sharedStrings.xml" in names:
                root = ET.fromstring(z.read("xl/sharedStrings.xml"))
                for si in root.findall(ns + "si"):
                    shared.append("".join(t.text or "" for t in si.iter(ns + "t")))
            # 取第一张工作表（workbook.xml 里的 r:id 映射这里用不上，按序号取）
            sheets = sorted(n for n in names if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
            if not sheets:
                raise ValueError("这个文件里没有工作表，可能不是 xlsx")
            root = ET.fromstring(z.read(sheets[0]))

        grid = []
        for row in root.iter(ns + "row"):
            cells = {}
            for c in row.findall(ns + "c"):
                ref = c.get("r") or ""
                col = 0
                for ch in ref:
                    if ch.isalpha():
                        col = col * 26 + (ord(ch.upper()) - 64)
                    else:
                        break
                col -= 1
                if col < 0 or col >= max_cols:
                    continue
                t = c.get("t")
                if t == "inlineStr":
                    is_el = c.find(ns + "is")
                    val = "".join(x.text or "" for x in is_el.iter(ns + "t")) if is_el is not None else ""
                else:
                    v = c.find(ns + "v")
                    val = v.text if v is not None and v.text is not None else ""
                    if t == "s":
                        try:
                            val = shared[int(val)]
                        except Exception:
                            val = ""
                cells[col] = (val or "").strip()
            if cells:
                width = max(cells) + 1
                grid.append([cells.get(i, "") for i in range(width)])
            if len(grid) >= max_rows:
                break
        return grid

    HEADER_ALIASES = {
        "name": ("课程名称", "课程名", "课程", "科目", "教学班", "name", "course"),
        "teacher": ("教师", "老师", "任课教师", "授课教师", "teacher"),
        "room": ("教室", "上课地点", "地点", "教室名称", "room", "classroom"),
        "day": ("星期", "周几", "星期几", "weekday", "day"),
        "start": ("开始节次", "起始节次", "开始节", "起节", "start"),
        "end": ("结束节次", "结束节", "止节", "end"),
        "section": ("节次", "上课节次", "时间", "section"),
        "weeks": ("周次", "上课周次", "周数", "weeks", "week"),
    }

    @staticmethod
    def _match_header(text):
        t = re.sub(r"[\s()（）:：]", "", text or "").lower()
        if not t:
            return None
        # 先精确、再包含，避免「开始节次」被「节次」抢走
        for field, alias in Api.HEADER_ALIASES.items():
            for a in alias:
                if t == a.lower():
                    return field
        for field, alias in Api.HEADER_ALIASES.items():
            for a in alias:
                if a.lower() in t:
                    return field
        return None

    @staticmethod
    def _parse_section(text):
        """'第1-2节' / '1-2' / '3' / '1,2,3' → (start, end)"""
        nums = [int(n) for n in re.findall(r"\d+", str(text or ""))]
        if not nums:
            return None, None
        return nums[0], nums[-1]

    @staticmethod
    def _parse_day(text):
        """'星期一' / '周一' / '一' / '1' / 'Sunday' → 1..7"""
        s = str(text or "").strip()
        if not s:
            return None
        if s.isdigit():
            n = int(s)
            return n if 1 <= n <= 7 else None
        table = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7,
                 "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7}
        low = s.lower()
        for key, val in table.items():
            if key in low:
                return val
        return None

    @staticmethod
    def _clean_weeks(text):
        """规整成 '1-16' / '1,3,5' 这种前端 parseWeeks 认的形式。"""
        s = str(text or "").replace("周", "").replace("，", ",").strip()
        s = re.sub(r"\s+", "", s)
        return s

    def import_schedule_xlsx(self, path):
        """解析课表 xlsx，返回 {ok, rows, grid, header, columns}。

        支持「一行一门课」的表格：表头里出现 课程/教师/教室/星期/节次/周次 之类的字样。
        表头认不出来时不猜，把前几行原样返回，让界面提示用户需要哪些列。
        """
        try:
            grid = self._xlsx_grid(path)
        except Exception as e:
            return {"ok": False, "error": "读取失败：" + str(e)}
        if not grid:
            return {"ok": False, "error": "工作表是空的"}

        # 表头不一定在第一行，往下找最多 8 行，取认得出最多列的那一行
        best = None
        for i, row in enumerate(grid[:8]):
            cols = {}
            for j, cell in enumerate(row):
                f = self._match_header(cell)
                if f and f not in cols:
                    cols[f] = j
            if len(cols) >= 2 and (best is None or len(cols) > len(best[1])):
                best = (i, cols)
        if not best or "name" not in best[1]:
            return {"ok": False, "code": "no-header", "grid": grid[:6],
                    "error": "没认出表头。请让第一行包含「课程名称」等列名，"
                             "并至少有「星期」和「节次」或「开始节次/结束节次」。"}

        head_row, cols = best
        rows, skipped = [], 0
        for raw in grid[head_row + 1:]:
            def cell(field):
                j = cols.get(field)
                return raw[j].strip() if (j is not None and j < len(raw)) else ""
            name = cell("name")
            # 只跳过"又一行表头"，判据必须收紧到「课程名」这一列本身，
            # 不能拿 _match_header 泛匹配 —— 那会把「星期一讲座」这类课名当表头丢掉。
            if not name or self._match_header(name) == "name":
                continue
            day = self._parse_day(cell("day"))
            if "start" in cols or "end" in cols:
                start = self._parse_section(cell("start"))[0]
                end = self._parse_section(cell("end"))[1] or start
            else:
                start, end = self._parse_section(cell("section"))
            if not day or not start:
                skipped += 1
                continue
            rows.append({
                "name": name,
                "teacher": cell("teacher"),
                "room": cell("room"),
                "day": day,
                "start": int(start),
                "end": int(end or start),
                "weeks": self._clean_weeks(cell("weeks")),
            })
        if not rows:
            return {"ok": False, "code": "no-rows", "grid": grid[:6],
                    "error": "认出了表头但一行有效数据都没有（星期与节次必须能解析）。"}
        return {"ok": True, "rows": rows, "skipped": skipped,
                "columns": sorted(cols.keys())}

    # ---------- 动作 ----------
    def run_check(self, force_notify=False):
        self._running = True
        try:
            cfg = core.load_config(core.CONFIG_PATH)
            args = argparse.Namespace(test=bool(force_notify), debug=False,
                                      xnm=None, xqm=None)
            core.run(cfg, args)
            state = {}
            if os.path.exists(core.STATE_PATH):
                state = json.load(open(core.STATE_PATH, encoding="utf-8"))
            rows = core.normalize(state.get("kbList") or [])
            return {"ok": True, "count": len(rows),
                    "xnm": state.get("xnm"), "xqm": state.get("xqm"), "rows": rows}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            self._running = False

    def test_push(self):
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        sent = core.push(cfg, "RhineLab_KbMonitor 测试",
                         "这是一条来自 RhineLab_KbMonitor 的测试推送。\n时间："
                         + dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        return {"ok": sent, "error": "" if sent else "发送失败，请检查推送通道与网络（详见日志）"}

    def preview_push(self):
        """发送一条"课表出啦"同款排版的预览消息（示例课表），让用户提前看到通知样式。"""
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        sent = core.demo_push(cfg)
        return {"ok": sent, "error": "" if sent else "发送失败，请检查推送通道与网络（详见日志）"}

    # ---------- 学期浏览（只读，不写状态不推送） ----------
    def get_term_options(self):
        """学年下拉选项与默认（监控/自动）学期。"""
        now = dt.date.today()
        y = now.year
        watch = core.default_term()
        try:
            cfg = core.load_config(core.CONFIG_PATH)
            t = cfg.get("term", {})
            if not t.get("auto", True) and t.get("xnm"):
                watch = (str(t["xnm"]), str(t.get("xqm") or "3"))
        except Exception:
            pass
        # 学年下拉：当年前后各 20 年，共 41 项。
        # 界面上一次只露 5 年、旁边是可拖的滚动条（见 index.html 的 .year-pick），
        # 所以条目多也不会变成一条长长的列表。
        years = ["{}-{}".format(y - k, y - k + 1) for k in range(20, -21, -1)]
        # 配置里存的学年可能比这个范围还旧（跨年很久没改配置），不在选项里的话
        # 下拉会显示空白、当前监控目标也选不中 —— 补进列表。
        if watch and str(watch[0]) and str(watch[0]) not in years:
            years.insert(0, str(watch[0]))
        return {"years": years, "watch": list(watch)}

    def view_term(self, xnm, xqm):
        """只读查询指定学期课表（不写状态、不推送），供 GUI 切换学期浏览。
        手动查询不重试、超时更短：学校网络不通时快速失败，不在日志里反复刷重试记录。"""
        try:
            cfg = core.load_config(core.CONFIG_PATH)
            s = core.build_session(cfg)
            if cfg.get("auth", {}).get("mode") == "login":
                core.login(s, cfg, False, retries=False)
            kb = core.fetch_kb(s, cfg, str(xnm), str(xqm), False, retries=False)
            rows = core.normalize(kb)
            return {"ok": True, "raw_count": len(kb), "rows": rows}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ---------- 日志 ----------
    def get_logs(self, lines=300):
        try:
            with open(core.LOG_PATH, encoding="utf-8", errors="ignore") as f:
                return f.readlines()[-lines:]
        except Exception:
            return []

    def clear_logs(self):
        try:
            open(core.LOG_PATH, "w", encoding="utf-8").close()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ---------- 定时任务（跟随配置的自定义检查时间） ----------
    def tasks_status(self):
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception:
            cfg = {}
        times = core.load_times(cfg)
        return {"ok": self._tasks(), "times": times}

    def install_tasks(self):
        """按配置的检查时间重建全部系统任务，并清掉旧任务（含 10点/17点 遗留）。"""
        try:
            cfg = core.load_config(core.CONFIG_PATH)
        except Exception:
            cfg = {}
        times = core.load_times(cfg)
        needed = {task_name_for(t) for t in times}
        detail = {}
        for t in times:
            name = task_name_for(t)
            try:
                r = _run_hidden(["schtasks", "/Create", "/F", "/SC", "DAILY",
                                 "/ST", t, "/TN", name, "/TR", _task_command()],
                                capture_output=True, timeout=25)
                detail[name] = r.returncode == 0
            except Exception:
                detail[name] = False
        # 清理：旧遗留任务 + 已不在配置列表里的任务
        for name in set(list_my_tasks()) | set(LEGACY_TASKS):
            if name not in needed:
                _run_hidden(["schtasks", "/Delete", "/F", "/TN", name],
                            capture_output=True, timeout=25)
        self._tasks_cache = (0.0, True)
        return {"ok": all(detail.values()), "detail": detail, "times": times}

    def uninstall_tasks(self):
        detail = {}
        for name in set(list_my_tasks()) | set(LEGACY_TASKS):
            try:
                r = _run_hidden(["schtasks", "/Delete", "/F", "/TN", name],
                                capture_output=True, timeout=25)
                detail[name] = r.returncode == 0
            except Exception:
                detail[name] = False
        self._tasks_cache = (0.0, False)
        return {"ok": all(detail.values()), "detail": detail}


_api = Api()


def scheduler_loop():
    """GUI 打开期间的应用内调度：命中配置的检查时间时各自动查一次（可在设置里总开关关闭）。"""
    fired = set()
    while True:
        time.sleep(20)
        try:
            try:
                cfg = core.load_config(core.CONFIG_PATH)
            except Exception:
                cfg = {}
            now = dt.datetime.now()
            key = now.strftime("%Y-%m-%d") + ":" + now.strftime("%H:%M")
            enabled = cfg.get("monitor", {}).get("enabled", True) is not False
            if enabled and now.strftime("%H:%M") in core.load_times(cfg) and key not in fired:
                fired.add(key)
                # 系统定时任务已覆盖该时间点时，应用内不再重复触发（避免同一分钟收两条）
                if not _api._tasks():
                    _api.run_check(False)
            if len(fired) > 200:
                keep = {dt.date.today().isoformat(),
                        (dt.date.today() - dt.timedelta(days=1)).isoformat()}
                fired = {k for k in fired if k[:10] in keep}
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--silent-check", action="store_true",
                    help="静默执行一次检查（配合 Windows 任务计划）")
    ap.add_argument("--version", action="store_true")
    ap.add_argument("--smoke", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.version:
        print("RhineLab_KbMonitor 1.0.0")
        return 0
    if args.silent_check:
        try:
            cfg = core.load_config(core.CONFIG_PATH)
            core.run(cfg, argparse.Namespace(test=False, debug=False, xnm=None, xqm=None))
        except Exception:
            pass  # 失败时 monitor_kb 已写日志并推送异常通知，静默退出（不弹窗）
        return 0

    _mutex = _acquire_single_instance()
    if _mutex is None:
        # 已有界面在运行：不重复启动（后台监控由已开界面或系统任务负责）
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None, "RhineLab_KbMonitor 已经在运行了。\n\n请使用已打开的窗口；"
                      "关闭界面不影响后台定时监控（由系统任务负责）。",
                "RhineLab_KbMonitor", 0x40)
        except Exception:
            pass
        return 0

    import webview  # noqa: E402
    threading.Thread(target=scheduler_loop, daemon=True).start()

    win = webview.create_window(
        APP_TITLE,
        resource_path(os.path.join("web", "index.html")),
        js_api=_api,
        width=1200, height=800,
        min_size=(1000, 660),
    )
    if args.smoke:
        threading.Timer(4.0, win.destroy).start()
    # storage_path + private_mode=False：让 WebView2 的用户数据目录固定在 exe 旁边，
    # 不然 pywebview 默认用临时目录，退出即删（localStorage、cookie 全留不住）。
    # 界面设置本身另外存成 ui_prefs.json / schedule_cache.json，不依赖这里。
    try:
        store = os.path.join(core.HERE, "webview_data")
        os.makedirs(store, exist_ok=True)
        webview.start(debug=False, private_mode=False, storage_path=store)
    except TypeError:
        webview.start(debug=False)          # 老版本 pywebview 没这两个参数
    print("SMOKE_OK")
    return 0


if __name__ == "__main__":
    main()
