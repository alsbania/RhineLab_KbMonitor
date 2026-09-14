# -*- coding: utf-8 -*-
"""把 GLB 模型转成「经典脚本」，供 file:// 页面直接读取。

为什么要这一步：
  pywebview 以 file:// 加载页面，而 Chromium 在 file:// 下**禁止 fetch/XHR**
  （只放行经典脚本与样式表）。GLTFLoader 内部用 fetch 取 .glb，一定会被
  CORS 拦掉：

      Access to fetch at 'file://…/archive-cassette.glb' from origin 'null'
      has been blocked by CORS policy

  所以把模型 base64 塞进一个普通 <script>，暴露全局变量，
  再由 port-overrides/asset-url.js 把它包成 data: URL 交给 GLTFLoader。

输出：
  kbapp/web/vendor/models/archive-cassette.js

   python kbapp/build-models.py
"""
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# 源项目就在 kbapp\RhineLabUI-main（2026-09-14 由用户剪切过来）
SRC = os.environ.get(
    "RHINE_ASSETS", os.path.join(HERE, "RhineLabUI-main", "public", "assets")
)
OUT_DIR = os.path.join(HERE, "web", "vendor", "models")

# 变量名 -> 源文件。RhineLab_KbMonitor 只用单体档案匣；拆解用的 assembly 暂不需要。
MODELS = {
    "archiveCassette": "archive-cassette.glb",
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}

    for var, filename in MODELS.items():
        path = os.path.join(SRC, filename)
        if not os.path.exists(path):
            print("找不到模型：%s" % path, file=sys.stderr)
            return 1

        raw = open(path, "rb").read()
        # GLB 必须是标准容器：magic "glTF"
        if raw[:4] != b"glTF":
            print("不是有效的 GLB：%s（前 4 字节 %r）" % (filename, raw[:4]), file=sys.stderr)
            return 1

        b64 = base64.b64encode(raw).decode("ascii")
        dest = os.path.join(OUT_DIR, filename.replace(".glb", ".js"))
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(
                "/*\n"
                " * %s —— 由 kbapp/build-models.py 从上游 public/assets 生成。\n"
                " * 上游许可 MIT（RhineLabUI）。\n"
                " *\n"
                " * 以 base64 内联在经典脚本里：file:// 下 fetch 会被 CORS 拦掉，\n"
                " * 只有经典脚本能加载，所以模型只能这样带进来。\n"
                " */\n" % filename
            )
            fh.write("window.__RHINE_MODELS__ = window.__RHINE_MODELS__ || {};\n")
            fh.write("window.__RHINE_MODELS__[%s] = {\n" % json.dumps(filename))
            fh.write("  mime: 'model/gltf-binary',\n")
            fh.write("  bytes: %d,\n" % len(raw))
            fh.write("  base64: '%s'\n" % b64)
            fh.write("};\n")

        manifest[filename] = {
            "script": os.path.basename(dest),
            "var": var,
            "bytes": len(raw),
            "scriptBytes": os.path.getsize(dest),
        }
        print(
            "  %-26s %7.2f MB -> %7.2f MB  %s"
            % (filename, len(raw) / 1048576, os.path.getsize(dest) / 1048576,
               os.path.basename(dest))
        )

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(
            {
                "source": "RhineLabUI public/assets（Blender MCP 生成）",
                "builtBy": "kbapp/build-models.py",
                "because": "file:// 下 fetch 被 CORS 拦，模型需内联为经典脚本",
                "models": manifest,
            },
            fh,
            ensure_ascii=False,
            indent=2,
        )
        fh.write("\n")

    total = sum(m["scriptBytes"] for m in manifest.values())
    print("合计 %.2f MB" % (total / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
