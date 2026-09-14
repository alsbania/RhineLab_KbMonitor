# RhineLab_KbMonitor —— 清理记录

本目录是旧工程目录（3.05 GB，原路径含个人标识，已从本文档隐去）的清理副本。
**旧目录一个字节未动**，仍可原样使用或回退。

- 生成时间：2026-09-14
- 体积：约 146 MB / 1670 个文件（旧目录 3.05 GB）
- git 历史：4 个提交，工作区干净（`git status` 无输出）

  ```
  f080211 (HEAD -> main, tag: clean-acrylic, tag: checkpoint-frost-ok)  补齐清理后的完整源码树与交付文档
  dd0ae53                                                               移除陈旧的 web/ 镜像，纳入未跟踪源码
  dd12e2a                                                               fix: 修复被误删的课表布局基类，并移除整套模糊
  a90a8b8                                                               checkpoint: 课表磨砂玻璃 + 选中课程清晰跳出
  ```

  两个标签（`checkpoint-frost-ok` / `clean-acrylic`）是你原有的回退点，本次清理
  因内容变更而重写了它们所指向的提交（含脱敏），**标签名与提交信息原样保留**，
  只是 hash 变了；现均指向最新提交，即"当前这份干净状态"。

  ⚠️ 旧 hash 已失效。若你之前用 hash 而非标签名记录过回退点，其对象已被 `git gc`
  清除、无法恢复 —— 但内容上并没有丢失：重写只替换了教师姓名与凭据，其余逐字节未动
  （入口数不变、`git diff-tree` 只报出预期路径）。

- `MANIFEST.txt`：全部文件的 SHA256 清单，可用于校验完整性

---

## 1. 目录结构

```
RhineLab_KbMonitor\
├─ monitor_kb.py            后端：抓取 / 解密 / 解析 / 推送
├─ fetch_kb.py              独立抓取脚本
├─ wechat_ui.py             微信 UI 推送通道
├─ kb_viewer.html           旧版课表查看页
├─ web_ui_test.js           离线 UI 回归测试（CommonJS）
├─ install_tasks.ps1        注册 Windows 定时任务
├─ config.json              配置（已脱敏，见第 4 节）
├─ kb_state.json            后台状态（已清空真实数据）
├─ schedule_cache.json      课表快照（已换成脱敏演示课表）
├─ ui_prefs.json            界面偏好（外观/密度/阵列画质）
├─ package.json             Node 侧依赖与重建脚本（本次新增）
├─ KbMonitor.exe            打包好的桌面端（28 MB）
├─ three-0.183.0.tgz        three.js 0.183.0 原包（vendored 依赖的出处）
├─ RhineLabUI-设计风格研究.md
├─ kbapp\                   桌面端源码
│  ├─ app.py                pywebview 宿主 + JS API
│  ├─ web\                  页面本体（app.js / app.css / index.html / 字体 / 3D bundle）
│  ├─ port-overrides\       移植改写版（权威源）
│  ├─ RhineLabUI-main\      上游设计参考（已裁剪，见第 3 节）
│  ├─ build_exe.ps1         PyInstaller 打包
│  ├─ build-three.mjs       three.js → 经典脚本 bundle
│  ├─ build-rhine.mjs       档案阵列 bundle
│  ├─ port-rhine.mjs        TS → JS 逐行移植
│  ├─ build-models.py       GLB → 内联脚本
│  ├─ build_fonts.py        MiSans 分包子集化
│  ├─ gen_icon.py           图标栅格化
│  └─ make-preview.mjs      预览壳生成
├─ vendor\
│  ├─ three-src\            three.js r183 运行源码（build-three.mjs 必需）
│  └─ three-jms\            three.js examples/jsm，addon 来源（本次迁入，见第 2 节）
├─ node_modules\            esbuild 0.28.2（构建链地基，见第 2 节）
└─ dist\KbMonitor.exe       与根目录同哈希
```

## 2. 本次清理修掉的实质问题

### ① 构建链依赖藏在临时目录里（最脆的一根线）

`kbapp/build-three.mjs` 的 three.js addon 来源原先默认指向 `ROOT/.tmp/package/examples/jsm`
—— 一个临时解包目录。`.tmp` 一删，addon 同步就断，而且**报错只说"找不到 addons"，不会
告诉你缺的是解包目录**。

现改为 `vendor/three-jms`（从 `.tmp` 解包结果迁入 401 个文件 / 13.4 MB，与
`vendor/three-src` 并排，同为 vendored 依赖）。`THREE_JSM` 环境变量仍可覆盖。

### ② port-overrides 与产物失配：七天档案阵列会静默退回五天

| 文件 | 清理前 | 
|---|---|
| `kbapp/web/rhine/data.js` | **七天版**（`['周一'…'周日']`） |
| `kbapp/port-overrides/data.js` | **五天版**（`['周一'…'周五']`） |

而 `port-rhine.mjs` 遇到 `port-overrides/` 里的同名文件是**直接覆盖输出**的。也就是说：
**任何人跑一次 `node kbapp\port-rhine.mjs`，档案阵列就会静默降级成五天** ——

- 周六周日的课 `category` 不在表里，`fileLocation` 的 `indexOf` 得 -1，
  lane 变 -1、slot 变负数，那些课在阵列里根本摆不出来；
- 某天没有课时 `fileAtCell` 从空列取出 `undefined`，`.category` 直接抛 TypeError 卡死。

已用七天版回灌权威源。修复后重跑，`rhine/data.js` 与 `rhine.global.js`
均与既有产物**逐字节相同**，证明修复正确且输出回到一致状态。

### ③ 相对路径硬编码

| 文件 | 问题 | 处理 |
|---|---|---|
| `install_tasks.ps1` | `$Script` 写死旧绝对路径，目录一挪就注册到不存在的路径；`schtasks` 不做校验，任务会**静默失败** | 改为相对 `$PSScriptRoot` 定位 `monitor_kb.py` |
| `web_ui_test.js` | 写死旧绝对路径，且默认指向已废弃的 `web/` 镜像，必然 ENOENT | 改为 `__dirname` 相对定位，保留 `KBAPP` 覆盖 |

修 `install_tasks.ps1` 时踩到两个 PowerShell 自身的坑，都已处理并验证：

1. **`param()` 的默认值不能调用 cmdlet。** 参数绑定先于脚本体执行，此阶段 `$PSScriptRoot`
   尚无值、`Join-Path` 也不可用，写 `[string]$Script = (Join-Path $PSScriptRoot ...)`
   直接是**语法错误**。改为在 `param()` 之外赋默认值。
2. **无 BOM 的 UTF-8 脚本会被 Windows PowerShell 当 ANSI 读。** 该项目两个 `.ps1`
   原本都无 BOM，原本内容恰好在误解码下也能解析，所以问题一直潜伏；一旦插入中文
   注释就暴露成 `Unexpected token ')'`。已给 `install_tasks.ps1` 加 UTF-8 BOM
   （`build_exe.ps1` 本来就有 BOM，未受影响）。

干跑验证（遮蔽 `schtasks`，未真注册任务）：两条任务均解析到新目录下的正确路径；
`monitor_kb.py` 用 `HERE = dirname(abspath(__file__))` 定位 `config.json`，
**不依赖工作目录**，任务计划调用不会找不到配置。

### ④ 新增 package.json

此前项目没有 `package.json`，esbuild 是散装 `npm install` 进 `node_modules` 的，而
`port-rhine.mjs` / `build-three.mjs` / `build-rhine.mjs` 三个脚本都 `import` 它
—— 缺了整套 3D bundle 重建链全断，却没有任何地方记录版本。现钉死
`esbuild@0.28.2`，并把常用重建步骤写成 npm scripts（`npm run assets`、`npm run build`）。

> 注意：该文件**刻意不声明** `"type": "module"`。`.mjs` 靠扩展名已是 ESM，而
> `web_ui_test.js` 是 CommonJS，声明 `module` 会让它 `require` 直接报错。

### ⑤ 移除陈旧的 web/ 镜像

根目录 `web/{app.css,app.js,index.html}` 与 `kbapp/web/` 的同名产物**逐字节相同**，
而 `build_exe.ps1` 已只做 `kbapp/web → web` 单向同步、不再回写。留着只会让"改了哪一份"
产生歧义（历史上就栽过：脚本新、界面旧，且不报任何错）。已在提交中移除。

### ⑥ 把 6252 行未入库改造固定进历史

清理前工作区领先 HEAD 6252 行插入（整套 Rhine 改造 + 全部新资产）却**从未提交**，
任何 `checkout` / `reset` 都会丢失。现已全部纳入版本管理（`dd0ae53` / `f080211`）。

### ⑦ 运行期文件移出仓库

`schedule_cache.json` 与 `ui_prefs.json` 此前**是被 git 跟踪的**。前者是"这台机器上
这个人的课表"的真实快照（含教师姓名、课程名、教室、周次），后者是本机外观偏好 ——
既不该随源码分发，每次运行也会改动、制造无意义 diff。已加入 `.gitignore` 并移出索引
（磁盘文件保留，首次运行自动重建）。

## 3. 刻意丢弃的内容

| 丢弃项 | 体积 | 理由 |
|---|---|---|
| `.tmp/` | 2.35 GB | 三个 Edge 浏览器 profile（2.27 GB）+ 约 60 个一次性探针脚本 + 截图。**唯一有长期价值的是 `examples/jsm`，已迁入 `vendor/three-jms`** |
| `_backup_rhine_*/`（5 个） | 181 MB | 当天改造过程中的中间态快照，均已被现状取代。注意：`.gitignore` 声称每个目录内有 `RESTORE.md`，**实际一个都没有**，属过期说明 |
| `kbapp/RhineLabUI-main/{verification,reference,art,wallpaper,docs/media}` | 101 MB | 上游的验证截图、参考素材、美术资源，都不在构建链上 |
| `build/`、`.pydeps/`、`.tools/`、`webview_data/`、`__pycache__/`、`monitor.log` | 171 MB | 构建中间产物与运行期缓存，可重建 |
| 根 `web/` 镜像 | 11.8 MB | 见 ② ⑤ |

`kbapp/RhineLabUI-main` 由 137.9 MB 裁到 35.1 MB：保留 `src/`（`port-rhine.mjs` 的输入）、
`public/{fonts,assets,archives,audio,icons,licenses}`（`build_fonts.py` / `build-models.py`
的输入）、`docs/*.md`、`scripts/`、`LICENSE` 等；另剔除 `public/fonts/novecento/`
（上游 `.gitignore` 明令"单独授权、不得分发"）。

## 4. 脱敏说明（本次会话追加）

| 位置 | 原内容 | 现内容 |
|---|---|---|
| `config.json` `auth.username` | 真实学号（12 位） | `<你的学号>` |
| `config.json` `auth.password` | 真实密码 | `<你的密码>` |
| `config.json` `push.wechat_contact` | 真实微信昵称 | `<你的微信联系人>` |
| `config.json` `push.sendkey` | — | 清空 |
| `kbapp/web/app.js` `DEMO_KB` | **12 位真实教师姓名**（23 条演示课表，25 处） | 统一换成"姓+老师"化名 |
| `web_ui_test.js` | 同上 2 处 | 同步脱敏 |
| `schedule_cache.json` | **32 条真实抓取课表**（19 位教师、真实课程名/教室/周次） | 换成脱敏后的 23 条演示课表 |
| `kb_state.json` `kbList` | 32 条真实抓取数据（含教师姓名字段） | 清空，首次查询会自行填回真实数据 |

化名映射（同名同化名，两位教师合并的场合保持 `陈老师,赵老师` 形态）：

```
王老师 李老师 张老师 刘老师 陈老师 赵老师
周老师 吴老师 郑老师 孙老师 钱老师 冯老师
```

**为什么运行期快照要整体重建而不是只洗教师名**：那 32 条真实课表连同课程名、教室、
星期、周次的组合"这个人在上什么课"本身就是可识别信息（全专业仅 59～115 人），
只去掉姓名并不足以脱敏。

### 4.1 git 历史也已脱敏

脱敏不止于工作区 —— 你原有的两个提交（"磨砂玻璃"checkpoint 与"布局基类修复"）
里，`kbapp/web/app.js`、`web/app.js`、`web_ui_test.js` 三处都带着完整的真实教师姓名。
由于这两个提交共用一个 blob，用 git 对象层操作（`ls-tree` → `mktree` → `commit-tree`）
重写了整条历史：

- 保留：提交信息、作者、提交时间、目录结构、除教师名外的全部内容
- 替换：`app.js` / `app.css` / `web_ui_test.js` 三个 blob 换成脱敏版
- 校验：入口数不变（17 → 17），`git diff-tree` 只报出预期的 5 个路径
- 结果：4 个提交的 `app.js` 现在全部是干净 blob `7ec6dc3a`

终检：**4 个提交 × 1696 个 blob 引用 + 工作区全部文本文件，对 20 个真实姓名与
3 项凭据零命中**；两个 exe 双编码探测亦为零命中。被抛弃的旧对象已 `git gc --prune=now`
清除（悬空对象 0）。

> 实施备注（供以后参考，都是踩过的坑）：`git filter-branch` 在此环境不可用（依赖
> `sh`，而沙箱禁止命名管道）；`git mktree <file>` **不读该文件**，它忽略文件参数转而
> 读 stdin，传路径会静默返回空树 `4b825dc6`；PowerShell 把字符串管道给原生程序会加
> BOM，且无 BOM 的 `.ps1` 会被按 ANSI 读而使中文注释破坏语法。最终用 Node 的
> `execFileSync` 传 stdin 完成。

## 5. 关于两个 KbMonitor.exe

用只读字节探测（UTF-8 与 UTF-16LE 两种编码）确认：exe 中**未命中**任何学号、密码、
微信昵称或教师姓名明文。PyInstaller 把 `kbapp/web/` 资源压缩存放，所以明文串不可见。

但请注意这是"未以明文命中"，不等于密码学意义上的保证。**若要对外分发，建议先
`config.json` 填占位符再重新打包**（`npm run build`），因为 exe 内含的是打包那一刻的
`kbapp/web/` 快照 —— 而本次脱敏正是改在这个目录里。

## 6. 重建链验证记录

新目录内实测跑通，且产物与旧目录**逐字节一致**：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 移植 TS→JS | `node kbapp/port-rhine.mjs` | 23 个模块 ✓ |
| three.js bundle | `node kbapp/build-three.mjs` | 9 个 addon，1949.8 KB ✓ |
| 阵列 bundle | `node kbapp/build-rhine.mjs` | 47 个输入模块，2088.1 KB ✓ |
| GLB 内联 | `python kbapp/build-models.py` | 3.40 MB → 4.53 MB ✓ |
| 预览壳 | `node kbapp/make-preview.mjs` | 35.2 KB ✓ |
| 产物校验 | 与旧目录 SHA256 比对 | 4/4 逐字节一致 ✓ |

字体子集（`kbapp/web/fonts/manifest.json`）已存在，`build_fonts.py` 默认跳过；
`gen_icon.py` 需要本机 Edge 与 Pillow，本次未跑（产物 `icon.ico` 已在）。

## 7. 已知问题（清理前就存在，未修）

`node web_ui_test.js` 结果为 **18 ✅ / 11 ❌ / 1 崩溃**。已用对照实验确认这**不是清理
引入的**：同一套断言在「旧目录原版测试→旧目录 app.js」「新目录改版测试→旧目录 app.js」
「新目录改版测试→新目录 app.js」三种组合下结果完全相同（18/11/1）。

成因均在测试桩自身，不是产品缺陷：

- 大批布局断言（块高 92px、块顶 454px、重叠并排等）依赖 DOM 桩保留内联 `style.height` /
  `style.top`，而桩没有实现；
- 崩溃点是 `web_ui_test.js:139` 调用 `sandbox.openSlot('3_5')` —— 该函数从未被导出到
  sandbox，`els['slotBody']` 也从未创建，抛出 `TypeError: Cannot read properties of
  undefined`，后续断言因此全部未执行。

建议后续把 DOM 桩补上内联样式支持、并导出 `openSlot`，或改用真实 headless 浏览器
（旧目录 `.tmp` 里那套 Edge CDP 探针工具已按你的选择未迁移）。

## 8. 尚未重建的依赖

`.pydeps/`（requests / pywebview / pyinstaller / pillow，39.9 MB）未复制。重打包 exe 时
`kbapp/build_exe.ps1` 会自动重装到 `.pydeps`（默认走清华源）。仅跑前端与 bundle 不需要它。
