<div align="center">

# KbMonitor

**课表监控 + 微信推送** —— 挂在后台盯着教务系统，课表一变就推给你

Python 后端 · pywebview 桌面端 · three.js 3D 档案阵列

</div>

---

## 这是什么

一个**只读取自己账号课表**的小工具。它定时登录教务系统，把课表与你上次看到的对比，
**只在真的有变化时**推一条微信消息给你 —— 不必自己天天刷。

界面用 three.js 把课程列表渲染成一排可拖动的"档案阵列"，风格参考
[RhineLabUI](https://github.com/LBEILC/RhineLabUI)（MIT）。也提供常规的周课表视图。

> **适用前提**：后端对接的是**正方教务系统（`jwglxt`）**。其他厂商的教务系统不适用。
> 具体地址因学校而异，需要自己填。

## 功能

- **变化监控**：登录 → 抓取 → 与上次快照对比 → 有变化才推送（首次运行建基线不推送）
- **推送通道**：微信电脑版本地自动化（纯 `ctypes`，无需额外依赖）／Server酱／PushPlus
- **周课表**：单双周、跨周段、相邻节次自动合并、同格重叠并排显示
- **两种视图**：常规周课表 + three.js 档案阵列（可拖拽、有入场与聚焦动效）
- **手工课表**：支持从 Excel 导入，或手动增删改课程
- **内置示例课表**：没配账号也能看到完整界面（见下）
- **定时任务**：一键注册 Windows 任务计划（每天 10:00 / 17:00）
- **离线优先**：查不到网络时显示上次的课表快照，而不是清空

## 先看看长什么样（不用账号）

仓库里带了一张**虚构的示例课表**，导入后界面立刻有内容，全程不联网、不需要学号密码：

```bash
python tools/apply_sample_schedule.py      # 装入示例课表（13 门虚构课程）
python tools/apply_sample_schedule.py --clear   # 卸载，恢复联网查询
```

不想用脚本的话，直接在界面上点「导入 Excel」选 `example.xlsx` 也一样。

示例课表的课程名、教师、教室全部虚构，覆盖了单周 / 双周 / 跨周段 / 同日换老师 /
两教师合上 / 连堂课这几种容易出问题的情形，方便验证界面。想改内容就编辑
`tools/make_sample_schedule.py` 顶部的 `ROWS` 再重新生成。

> 装入示例课表会把 `config.json` 的 `use_manual` 置为 `true`，其语义是
> **以手工课表为准、不再联网查询** —— 这正是它不需要账号就能显示的原因。

## 快速开始

### 方式一：直接下载运行（推荐给只想用的）

1. 到 [Releases](../../releases) 下载 `KbMonitor.exe`
2. 双击运行 —— **首次启动会自动生成 `config.json` 并弹出配置面板**
3. 填写三样东西：教务系统根地址、学号、密码
4. 保存后即可查询课表；定时推送在配置面板里开启

凭据只存在 exe 同目录的 `config.json` 里，不会上传到任何地方。

### 方式二：从源码运行

```bash
pip install requests pywebview
python kbapp/app.py
```

### 方式三：自己打包成单文件 exe

```bash
python -m pip install --target .pydeps requests pywebview pyinstaller pillow
npm install          # 只为 esbuild（三个 kbapp/*.mjs 构建脚本依赖它）
npm run build        # 产出 dist/KbMonitor.exe，并同步到工程根目录
```

`npm run build:ui` 用于只改了界面的场合，跳过 Python 依赖安装与 three bundle 重打包。

## 配置

首次启动自动落盘 `config.json`（模板见 [`config.example.json`](config.example.json)）：

| 字段 | 说明 |
|---|---|
| `base` | 教务系统根地址，如 `https://jwglxt.example.edu.cn/jwglxt` |
| `auth.username` / `auth.password` | 学号与密码 |
| `auth.mode` | `login` 每次登录；改用 Cookie 可填 `cookie` / `cookie_file` |
| `term.auto` | `true` 按当天日期自动判断学期；`false` 时用手填的 `xnm`/`xqm` |
| `push.provider` | `wechat_ui` / `serverchan` / `pushplus` / `none` |
| `schedule.times` | 每天检查的时刻 |
| `ui.density` | 课表格子疏密 |

**`config.json` 已在 `.gitignore` 中** —— 里面是明文密码，切勿提交或放进网盘。

## 命令行

```bash
python monitor_kb.py                  # 单次检查
python monitor_kb.py --test           # 发一条测试推送
python monitor_kb.py --debug          # 打印登录/抓取细节
python monitor_kb.py --loop           # 常驻，按 schedule.times 自动跑
python monitor_kb.py --xnm 2025-2026 --xqm 3
```

`install_tasks.ps1` 可把定时任务注册进 Windows 任务计划程序。

## 开发

```bash
npm test             # 离线 UI 回归（121 项：周次解析 / 块几何 / 重叠 / 疏密 / 样式契约）
npm run assets       # 重建 3D 资产链（移植 → three bundle → 阵列 bundle → GLB 内联）
npm run preview      # 生成开发预览壳 kbapp/web/_shell.html

python tools/make_sample_schedule.py --out example.xlsx   # 重新生成示例课表（会自检能否被导入）
```

`make_sample_schedule.py` 只用标准库写 xlsx（`inlineStr`，不需要 `openpyxl`），
生成后会调用 `app.py` 的导入解析器自检一遍 —— 避免造出一张导不进去的表。

目录结构与模块职责：

```
monitor_kb.py        后端核心：登录 / 抓取 / 解析 / 对比 / 推送 / 状态
kbapp/app.py         pywebview 宿主与 JS API（含 xlsx 导入解析）
kbapp/web/           页面本体（app.js / app.css / index.html / 字体 / 3D bundle）
kbapp/*.mjs          three.js 与阵列 bundle 的构建脚本（依赖 esbuild）
kbapp/port-overrides/ 对上游移植件的改写版（权威源，port-rhine 直接取用）
vendor/three-src     three.js r183 运行源码
vendor/three-jms     three.js examples/jsm（构建 addon 的来源）
tools/               示例课表生成与装入脚本（虚构数据，供预览界面用）
```

几条踩过坑的设计约束，改代码前值得一读：

- **`package.json` 刻意不声明 `"type": "module"`**：`kbapp/*.mjs` 靠扩展名已是 ESM，
  而 `web_ui_test.js` 是 CommonJS，声明 `module` 会让它 `require` 直接报错。
- **`web_ui_test.js` 的样式契约段不要删**：JS 断言只验证生成的 HTML，界面塌成纯文字流
  时它能全绿 —— 曾经整套布局基类被误删而无人察觉，那一段就是为此立的。
- **`kbapp/web/` 是界面的唯一源**：早期还有一份根目录 `web/` 镜像，两份同名产物逐字节
  相同却各自演进，出现过"脚本新、界面旧且不报错"。镜像已移除。
- **`port-overrides/` 与 `kbapp/web/rhine/` 必须同步**：前者是权威源，后者是产物。
  只改产物的话，下次跑 `npm run port` 会被源的旧版本静默覆盖回去。
- **页面由 `file://` 加载**，Chromium 在该协议下禁止 ES module，所以 three.js 必须打成
  经典脚本（IIFE），不能用 `<script type="module">`。

## 已知限制

- 仅支持正方教务系统（`jwglxt`）
- 3D 档案阵列需要 WebView2（Windows 10/11 自带）；`gen_icon.py` 需要本机 Edge 与 Pillow
- 微信推送走电脑版微信的本地自动化，需要微信已登录且窗口可用；无微信时可用 Server酱 / PushPlus
- 界面字体为 MiSans 子集，**不含**上游 24 MB 字体分片；重生成字体需自上游仓库取回（见 `.gitignore` 注释）

## 合规与免责

- 本工具只用**你自己的账号**登录，只读取**你自己可见的课表**，不做任何越权、绕过或批量抓取。
- 请遵守你所在学校的教务系统使用规定，并自行控制检查频率（默认每天 5 次）。
- 密码以明文存放在本机 `config.json`，这是本工具的设计取舍（纯本地、无服务端）。
  请自行确保该文件不被他人读取。

## 许可

本项目代码采用 MIT 许可（见 `LICENSE`）。

随仓库分发的第三方组件：

| 组件 | 许可 | 说明 |
|---|---|---|
| [three.js](https://threejs.org) r183 | MIT | `vendor/three-src`、`vendor/three-jms` |
| [RhineLabUI](https://github.com/LBEILC/RhineLabUI) | MIT | 风格参考与移植来源，见 `kbapp/RhineLabUI-main/LICENSE` |
| MiSans 字体子集 | MiSans 字体许可（小米） | 子集与许可原文见 `kbapp/web/fonts` 与 `kbapp/web/License/MiSans-license.pdf` |
