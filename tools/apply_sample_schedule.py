# -*- coding: utf-8 -*-
"""把示例课表装进 config.json，让界面一打开就有课表可看（无需联网、无需账号）。

同时把 auth / push 里的个人凭据复位成占位符 —— 这个目录的 config.json 虽然被
.gitignore 忽略，但用户准备把整个目录推到 GitHub，宁可多一道保险。

用法:
  python tools/apply_sample_schedule.py                 # 装示例课表
  python tools/apply_sample_schedule.py --clear         # 卸载，回到联网查询
"""
import argparse
import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = os.path.join(ROOT, "config.json")
XLSX = os.path.join(ROOT, "example.xlsx")

PLACEHOLDERS = {
    ("auth", "username"): "<你的学号>",
    ("auth", "password"): "<你的密码>",
    ("push", "wechat_contact"): "<你的微信联系人>",
    ("push", "sendkey"): "",
    ("push", "pushplus_token"): "",
}


def load_parser():
    """借 app.py 的 Api.import_schedule_xlsx 解析，保证与界面导入的结果完全一致。"""
    sys.path.insert(0, os.path.join(ROOT, "kbapp"))
    spec = importlib.util.spec_from_file_location("kbapp_app", os.path.join(ROOT, "kbapp", "app.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clear", action="store_true", help="卸载示例课表，恢复为联网查询")
    ap.add_argument("--keep-credentials", action="store_true", help="不把凭据复位成占位符")
    args = ap.parse_args()

    if not os.path.exists(CFG):
        print("找不到 config.json，请先启动一次 KbMonitor.exe 让它自举")
        return 1
    with open(CFG, encoding="utf-8") as f:
        cfg = json.load(f)

    if args.clear:
        cfg.pop("manual_schedule", None)
        cfg["use_manual"] = False
        print("已卸载示例课表：use_manual=false，下次启动会联网查询")
    else:
        if not os.path.exists(XLSX):
            print("找不到 %s，先跑 tools/make_sample_schedule.py" % XLSX)
            return 1
        mod = load_parser()
        r = mod.Api.import_schedule_xlsx(mod.Api(), XLSX)
        if not r.get("ok"):
            print("解析失败：%s" % r.get("error"))
            return 1
        rows = r["rows"]
        cfg["manual_schedule"] = rows
        cfg["use_manual"] = True
        print("已装入示例课表：%d 门课，use_manual=true（启动即显示，不再联网查询）" % len(rows))
        days = "一二三四五六日"
        for x in rows:
            print("   %s 周%s 第%d-%d节  %-14s %s"
                  % (x["name"], days[x["day"] - 1], x["start"], x["end"], x["teacher"], x["room"]))

    if not args.keep_credentials:
        n = 0
        for (sec, key), val in PLACEHOLDERS.items():
            cfg.setdefault(sec, {})[key] = val
            n += 1
        cfg.setdefault("push", {})["provider"] = "none"
        print("已将 %d 项凭据复位为占位符，push.provider=none" % n)

    with open(CFG, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print("已写回：%s" % CFG)
    return 0


if __name__ == "__main__":
    sys.exit(main())
