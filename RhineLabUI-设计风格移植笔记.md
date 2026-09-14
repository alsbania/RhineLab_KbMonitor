# RhineLabUI 设计风格研究

> 对象：`E:\edge down\RhineLabUI-main`（Rhine Lab · ANALYSIS OS）
> 性质：**只读学习记录**。原项目未被修改。
> 方法：直接阅读 `DESIGN.md` / `AGENTS.md` / `src/*.css` / `src/*.ts` / `docs/media/*` 截图，逐项抄录真实数值。

---

## 1. 这是什么

一个用 TypeScript + Three.js + Vite 手写的「莱茵生命研究档案终端」交互界面。视觉母本是某段 1920×1080 / 25fps 的 5–40 秒企业动态图形片，项目按逐帧分析 + 原生实现来还原，**刻意不使用任何前端设计框架或动效 Skill**。

界面由两层叠合：

- **三维层**：一排排磨砂玻璃档案卡片组成无限循环阵列（真实 `MeshPhysicalMaterial` 透射、内部双环光学结构、RoomEnvironment 环境光）。
- **DOM 层**：绝对定位在 1920×1080 基准舞台上的排版界面 —— 左上品牌块、右上系统导航、右侧档案正文、底部计数与刻度、页脚会话信息。

主导气质：**暖灰纸面 + 近黑排字 + 琥珀信号**的编辑式极简；克制的细线、极大的字距、双语标签对、以及一层薄薄的胶片质感。

---

## 2. 色彩体系

### 2.1 单一真源：`src/theme-ui.ts`

明暗两套色板只在这一个文件里定义，其余全部走 CSS 变量：

| 变量 | 亮色（默认） | 暗色 | 角色 |
|---|---|---|---|
| `--theme-ink` | `#080a08` | `#e0e3dc` | 正文墨色（带一点点绿的近黑，不是纯黑） |
| `--theme-muted` | `#77756d` | `#a6b0b1` | 辅助文字 / 小标签 |
| `--theme-line` | `#aaa59a` | `#536166` | 分隔线、描边 |
| `--theme-paper` | `#eae5e1` | `#11181b` | 纸面底色 |
| `--theme-panel` | `#edebe4` | `#202a2f` | 弹窗 / 面板底 |
| `--theme-field` | `#e7e3d9` | `#2a363b` | 输入框 / 开关底 |
| `--theme-accent` | `#9b7247` | `#c5a16b` | 强调（暖棕 → 琥珀金） |

实现细节值得偷：`paintTheme(amount)` 在亮暗两色之间**逐通道插值**，把结果写成 `rgb(...)` 和裸通道 `"r, g, b"` 两份（后者供 `rgba(var(--theme-paper-rgb), .6)` 用）；当 `amount > .0001` 时同步把 `documentElement.dataset.darkSurface` 切为 `"true"`，整套暗色规则靠这个属性开关，而不是类名。

### 2.2 实际写死的色值（未走变量）

这些是页面上真正看到的颜色，散落在各 CSS 里：

| 色值 | 出现位置 | 角色 |
|---|---|---|
| `#e8e5e1` | `#viewport` / `#stage` 背景、竖屏渐变终点 | 主纸面（比 `--theme-paper` 略冷） |
| `#eae5e1` | Three.js `scene.background`、雾色、查看器背景 | 三维与 DOM 共用的纸面 |
| `#080a08` | 全局 `color`、实心按钮、SVG 描边 | 正文墨色 |
| `#090a08` | `.powered i`（右下角那根 25×6 的短横） | 品牌终结符 |
| `#77756d` | `.eyebrow`、`.wb-muted` | 小标签 |
| `#66645f` `#666257` `#726f67` `#726f67` `#78776e` `#858077` `#8f8a80` `#989184` `#9a9487` `#807b70` `#888074` `#8b8f75` | 各种 9–16px 的次级文字 | **一整套暖灰梯级**，每个标签一个色阶 |
| `#aaa59a` | `.file-ticks button:before`、页脚 | 刻度 / 线 |
| `#bdb8ad` | 面板分隔线、页签底线 | 稍浅的线 |
| `#a6a49c` | 按钮描边、`.key`、勾选框 | 控件描边 |
| `#c2bdb1` `#c9c1b2` `#bcb6ac` `#f7f5ee` `#969183` | 弹窗顶栏线、kbd、查看器分段控件、弹窗高光边 | 控件层级 |
| **`#9b7247`** | `button:hover`、`.wb-storage`、链接 | **琥珀强调（悬停）** |
| **`#a27849`** | `.file-ticks button:hover:before`、`.wb-nav button:hover::before` | **琥珀强调（刻度）** |
| `#a67d48` | `outline: 2px solid`（所有 `:focus-visible`） | **焦点环 —— 全站唯一焦点色** |
| `#cbb397` | `::selection` 背景（文字 `#151713`） | 选中文本 |
| `#e4d5c1` | `.archive-navigation button:hover` | 箭头按钮悬停底 |
| `#24261f` `#282a24` `#20221d` `#25281e` `#191c16` `#171713` | 选中的刻度 / 分隔线 / 激活页签 | 近黑信号 |
| `#252820` → hover `#4b4a3b` | `.solid-button`（SAVE ARCHIVE 主按钮） | 实心按钮 |
| `#f0eee5` `#ece9e4` `#f5f2e9` | 实心按钮文字、开关滑块、查看器激活项 | 反转文字 |
| `#565c46` | `input:checked + .toggle`、`accent-color` | **橄榄绿 —— 开关「已开启」态** |
| `#353b30` `#30362a` `#67634c` | 查看器分层按钮激活、PWA 提示条 | 深橄榄 |
| `#ed821b` | 开场扫描 SVG 的两个轨道圆点 | **唯一的高饱和橙** |
| `#8b8f75` `#777b60` `#7a8163` | `metadata dd i` 方点、状态灯 | 灰橄榄「在线」信号 |

**关键观察：琥珀不是一个颜色，而是一个色族。** 悬停用 `#9b7247` / `#a27849`，焦点环用 `#a67d48`，暗色强调换成 `#c5a16b`。它们都落在同一段暖棕–琥珀区间里，所以看起来统一，但实际有 4 个不同的值。

**另一个观察：还有一条隐性的橄榄绿支线**（`#565c46` / `#353b30` / `#8b8f75`），只用于「状态开 / 就绪」这一语义，不参与强调。

### 2.3 暗色主题

暗色**不做全屏反色**。做法是：

- 正文/纸面/线/辅助色四个变量整体换掉（见上表）。
- `theme.css` 里用一个巨大的 `:is(...)` 选择器清单，把每个组件映射到变量；所有规则都以 `[data-dark-surface="true"]` 前缀开头。
- 三维场景单独走 `theme-material.ts`：每张卡片材质按「表面名」查一张表换色，环境强度 → `.32`、曝光 → `.98`、所有灯光强度 ×(1 − .35·amount)，雾色 → `#263136`，背景 → `#11181b`，地面 → `#192125`。
- 暗色雾距更近（预览为相机距离 +1 / +16，亮色为 +5 / +25），并额外加顶部和底部渐隐，让阵列边缘溶进背景。

---

## 3. 字体与文字尺度

### 3.1 字体栈

```css
:root {
  font-family: "MiSans", "Mi Sans", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  font-synthesis: none;
}
```

- **MiSans**（小米开源字体）是唯一主字体，经 `misans-webfont@4.3.1` 分包按 `unicode-range` 加载，提供 **300 / 400 / 600 / 700** 四个字重，`font-display: swap`。刻意移除上游 CSS 的 `local()`，避免设备字体覆盖固定版本。
- 开场中央文案另用 **Novecento Sans Wide**（Normal / DemiBold / Bold），授权文件不入 Git，无授权时回退到项目内固定轮廓图形。

### 3.2 字阶（真实数值，全部来自 1920×1080 基准）

| 角色 | font-size | line-height | letter-spacing | weight | 备注 |
|---|---|---|---|---|---|
| 品牌第一行 RHINE LAB | 50.75px（后置覆盖，原 44px） | 48px | 1px | 750 | `.brand h1`，容器 270px 宽 |
| 品牌第二行 SYNTHESIZE INFORMATION | 19px | 23px | 0.587px | 600 | |
| 品牌第三行 ANALYSIS OS | 35px | 40px | 0（逐字母校准） | 750 | OS 在 270px 容器右对齐，字距 3px |
| 档案主标题 `.file-title` | 28px | — | 0.2px | **750** | |
| 详情标题 `.detail-content h2` | 40px | 1.12 | **−1.3px** | 400 | 负字距是标题感的来源 |
| 详情中文名 `.detail-title-cn` | 23px | — | — | 400 | 与 11px 的英文类型标签 gap 23px |
| 正文 `.tab-panel p` | 18px（后置覆盖，原 15px） | 1.8（原 1.95） | — | 400 | `text-align: justify` |
| 元数据值 `.metadata dd` | 17px（原 14px） | — | — | 400 | |
| 元数据标签 `.metadata dt` | 11px | — | 0.7px | 400 | 色 `#807b70` |
| 微型标签 `.tiny-label` | 11px | — | **1.7px** | 400 | |
| 「眉标」`.eyebrow` | 12px | — | **1.3px** | 400 | 色 `#77756d` |
| 提示行 `.archive-hint` | 10px | — | 0.9px | 400 | |
| 页脚 `.system-footer` | 10px | — | 0.9px | 400 | |
| 面板标签 `.panel-label` | 11px（原 9px） | — | 1px | 400 | |
| 大数字 `.archive-counter > div` | 58px | 1.1 | — | 400 | 配 300 weight 的 `/ 08` |
| 弹窗标题 `.terminal-modal h2` | 38px | — | **−0.6px** | 400 | |
| 按钮 `.solid-button` | 11px | — | 1px | 400 | 内部中文 11px / `#bcbfb1` |
| 键盘提示 `.key` | 11px | — | — | 400 | 19×21px 描边框 |

**两条铁律：**

1. **大写英文小标签一律加宽字距（0.7–1.7px），大号标题一律收紧字距（−0.6 至 −1.3px）。** 这是这套排版最容易被识别的特征。
2. **数字永远是 `tabular-nums`。** `#selected-number`、`#column-index`、`#clock`、`.wb-clock`、`.wb-large`、`.audio-volume output` 全部声明了 `font-variant-numeric: tabular-nums`。项目里连数字滚动都交给 `@kitlangton/rolling-number`（460ms、向上、轻微运动模糊、两位数补零 / `X-` 前缀三位补零）。

> 注意 `style.css` 末尾有一段「Reading sizes for the extended research workspace」的**后置覆盖**，把 `metadata`、`tab-panel p`、`research-notes li`、`panel-label`、`detail-tabs button span` 的字号统一调大。原值是给 16:9 影片构图用的，后置值才是实际阅读尺寸。

---

## 4. 布局与空间

### 4.1 舞台

```css
#stage { position:absolute; left:50%; top:50%; width:1920px; height:1080px;
         transform-origin:center; isolation:isolate; background:#e8e5e1; }
```

`src/viewport-layout.ts` 计算 `scale` 并写成 `--stage-scale`，四种布局模式：

| kind | 触发条件 | scale | 含义 |
|---|---|---|---|
| `cinematic` | 显式逐帧对照 | `min(w/1920, h/1080)` | 完整 16:9 等比 |
| `opening` | 开场 | `min(h/1080, w/1280)` | 铺满视口，中央图形保持局部坐标 |
| `desktop` | `!portrait && w ≥ 1100` | `h/1080` | 高度对齐，宽度延展（超宽屏露出更多阵列） |
| `compact` | `w < 1100` 或粗指针矮屏 | **1** | 真实 CSS 像素，文字不整体缩小 |
| `portrait` | `w/h < 1.05` | **1** | 同上，正文改到屏幕下方独立滚动 |

**关键决策：窄屏不缩放，改用真实像素 + 换布局。** Desktop 下的定位大量写成百分比（`.archive-callout { left: 50.520833% }`、`.detail-content { left: 60.104167%; width: min(636px, 33.125%) }`），只有 16:9 时才精确落在原片坐标（`left: 970px`、`top: 471px`）。

### 4.2 边距系统

```css
#stage { --edge: 59px; }
```

- **59px 是全局唯一边距常量。** 品牌左下、系统导航右上、页脚左右、Powered 右下全部锚在 59px。
- 紧凑/竖屏时改为 `--edge: max(20px, env(safe-area-inset-*))`，并新增 `--top-edge` / `--bottom-edge` 读取刘海与手势区。
- 页脚距底 35px，`.powered` 距底 108px。

### 4.3 主要区域（1920×1080 坐标）

| 区域 | 位置 | 尺寸 |
|---|---|---|
| `.brand` | left 59, top 114 | 270px 宽，三行 |
| `.system-nav` | right 59, top 124, gap 43px | 右上三个入口 + 键位提示 |
| `.archive-callout` | left 970, top 471 | 950px 宽（眉标 / 标题 / 横线 / 摘要 / ACCESS FILE） |
| `.archive-counter` | left 60, bottom 115 | 「01 / 08」大号计数 |
| `.archive-navigation` | left 504, bottom 131, gap 33px | 上下箭头 + 8 个刻度 |
| `.column-navigation` | left 1005, bottom 131 | 左右箭头 + 列名 |
| `.archive-hint` | left 505, bottom 60 | 「← → 切换列 / ↑ ↓ 前后档案 / ENTER 读取」 |
| `.detail-content` | left 1154, top 289 | 636px 宽 |
| `.system-footer` | left/right 59, bottom 35 | 会话信息 |

详情页的右侧正文位置由 `archiveFraming()` 算出 `detailX = 550/1920`、`detailY = 560/1080`（桌面），与相机推进同步。

### 4.4 真实 media query 只有 4 个

响应式几乎**不靠 media query**，靠 JS 打上的 `data-layout` 属性。全部 `@media` 只有：

- `(display-mode: standalone)` → `body { overscroll-behavior: none }`
- `(max-width: 370px)` → 竖屏极窄微调
- `(max-height: 440px) and (orientation: landscape)` → 矮横屏隐藏眉标
- `(max-width: 740px) and (max-height: 440px) and (orientation: landscape)`

`workbench.css` 额外有 `max-width: 1000px` / `max-height: 650px` / `max-width: 700px` 三档。

---

## 5. 线条、边框与几何语言

这是整套设计的骨架。**没有圆角，没有阴影卡片，没有填充色块。** 全部靠线：

| 元素 | 规格 | 说明 |
|---|---|---|
| 主分隔线 `.callout-rule` | `height:1px; background:#504b41` | 入场时 `scaleX(0) → 1`，`1.3s cubic-bezier(.22,1,.36,1)`，`transform-origin:right` |
| 线上的方点 `.callout-rule i` | `6×6px; background:#282a24; left:-61px` | 线左端外挂一个小方块 |
| 详情重线 `.detail-rule` | `height:2px; background:#20221d` | 比正文线更重，用于标题下 |
| 页签底线 `.detail-tabs` | `border-bottom:1px solid #bdb8ad` | |
| 页签指示器 `.tab-indicator` | `1×2px` 起，`transform:scaleX()` 拉伸 | `180ms cubic-bezier(.22,1,.36,1)`，`transform-origin:left center` |
| 档案刻度 `.file-ticks button:before` | `2×12px; background:#aaa59a` | 默认 12px 高 |
| 刻度 · 选中 | `2×33px; top:3px; background:#24261f` | `transition: height .4s, background .4s, top .4s` |
| 刻度 · 悬停 | `2×24px; top:8px; background:#a27849` | 琥珀 |
| 工作台导航刻度 `.wb-nav button::before` | `2×12px` → 选中 `2×33px` | 与档案刻度**完全同构** |
| 计分条 `.wb-rule` | `height:2px; background:#bdb8ad`，内 `i` 为 `#080a08` | 进度条 |
| 品牌终结符 `.powered i` | `25×6px; background:#090a08` | RHINE LAB 后面那根横杠 |
| 状态灯 `.status-light` | `5×5px; background:#777b60` | 页脚方形亮点 |
| 元数据方点 `.metadata dd i` | `5×5px; background:#8b8f75` | 值前的小方块 |
| 关闭按钮 × | 两条 `14×2px` 伪元素旋转 ±45° | 纯 CSS，不用字符 |
| 键盘提示 `.key` | `min-width:19px; height:21px; border:1px solid #a6a49c; opacity:.6` | |
| 勾选框 `.wb-check` | `18×18px; border:1px solid #a6a49c` | 选中填充近黑 |

**几何母题总结：**

- **2px 宽的短竖线**做刻度，选中时**变长**（12 → 33px）而不是变色块。
- **1px / 2px 横线**做层级，颜色深浅区分主次（`#504b41` → `#bdb8ad` → `#c2bdb1`）。
- **小方块（5–6px）**做信号点，出现在线的端点、数据值前、页脚。
- **箭头不是字符**：`→` 用 `transform: translateX(9px)` 表示推进，圆角箭头 `↗` 用于外链。

---

## 6. 动效与过渡

### 6.1 时长与缓动的实际用法

| 场景 | 时长 | 缓动 | 属性 |
|---|---|---|---|
| 「眉标」淡入 | 700ms | linear | opacity |
| 主横线展开 | 1300ms | `cubic-bezier(.22,1,.36,1)` | `scaleX` |
| 摘要上浮 | 700ms + **400ms delay** | linear | opacity + `translateY(8px)` |
| ACCESS FILE 淡入 | 700ms + 400ms delay | linear | opacity |
| 详情进入 | 按 `detailEnter` keyframes：`translateY(23px) → 0` | — | opacity + transform |
| 弹窗进入 | 300ms，`modalEnter`: `translateY(25px) scale(.99) → 0/1` | — | |
| 弹窗退出 | 200ms，位移 8px | — | |
| 页签正文 | **150ms** 淡入 | — | |
| 页签下划线 | **180ms** | `cubic-bezier(.22,1,.36,1)` | `scaleX` |
| 收藏反馈 | **220ms** 颜色 | — | |
| 详情层进出 | **180ms** | — | |
| 三维查看器进入 | **320ms** 淡入 | — | 载入后 **380ms** 从 `.97` 展开 |
| 三维查看器退出 | **220ms** 淡出 + 轻微收拢 | — | |
| 相机复位 | **560ms** 减速曲线 + 球面短路径 | — | |
| 数字/文字滚动 | **460ms** | — | rolling 库 |
| 系统导航淡入 | 800ms | — | |
| `.archive-ui` 淡入 | 800ms + **300ms delay** | — | |
| 悬停抬起（3D） | ~200ms 显现 | — | 竖直 +0.28 世界单位 |
| 明暗切换（每张卡） | **580ms**，背景 **850ms** | — | 每行延迟 34ms、每列 110ms，最远 600ms |
| 呼吸起伏 | 8s / 13s 周期叠加 | — | 最大单向位移 0.102 世界单位 |
| 玻璃清晰度揭示 | 原片 38.84–39.56s 映射 | — | 羽化宽度 = 高度的 24% |

**可辨识的模式：所有入场都用 `opacity` + 小幅 `translateY`（8–25px）+ 递增 delay，而不是弹性或缩放。**唯一出现 `scale` 的是弹窗（`.99`）和查看器（`.97`），且幅度都极小。

### 6.2 keyframes（全文只有 5 个）

```css
@keyframes orbit   { to { transform: rotate(360deg) } }        /* 开场扫描圆点 */
@keyframes blink   { 50% { opacity: 0 } }                       /* 光标闪动 */
@keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes detailEnter { from { opacity:0; transform:translateY(23px) }
                         to   { opacity:1; transform:translateY(0) } }
@keyframes modalEnter  { from { opacity:0; transform:translateY(25px) scale(.99) }
                         to   { opacity:1; transform:translateY(0) scale(1) } }
@keyframes loading { from { transform:translateX(-60px) } to { transform:translateX(180px) } }
```

### 6.3 减少动态效果

```css
.reduce-motion * {
  animation-duration: .01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: .01ms !important;
  transition-delay: 0s !important;
}
```

用一个类名一网打尽。同时 JavaScript 侧还有完整的一套：跳过 3D 相机插值、跳过主题波浪、冻结颗粒、停止鼠标追踪、直接显示滚动文字终值、不发选中波浪、拆解直接切换。

值得一提：**站点自己的设置优先于系统偏好**，正文解密遮罩也遵循同一开关，避免用户主动开启完整动效后被系统 media query 再关掉。

---

## 7. 阴影、模糊、滤镜与质感

### 7.1 阴影极少且极软

```css
.terminal-modal      { box-shadow: 0 26px 95px #63513a20; }   /* 7% 不透明暖棕 */
[data-dark-surface] .terminal-modal { box-shadow: 0 26px 95px #0003; }
```

全站基本只有这一处阴影。三维卡片的深度感全部来自真实光照和透射，不靠 CSS 加投影。

### 7.2 玻璃与磨砂

```css
.modal-backdrop { background: rgba(227,224,215,.45); backdrop-filter: blur(18px); }
.terminal-modal { background: rgba(237,235,228,.97); border: 1px solid #f7f5ee; }
```

弹窗是「几乎不透明的暖白纸 + 一层极淡的 1px 高光边 + 大面积模糊背景」，不是常见的玻璃拟态。

局部磨砂底（可选）：

```css
.frost-surface::after {
  inset: -12px -16px; border-radius: 3px;
  background: rgba(var(--theme-paper-rgb), var(--frost-tint, .35));
  backdrop-filter: blur(var(--frost-blur, 13px)) saturate(.8);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 1px 0 rgba(0,0,0,.08);
}
```

### 7.3 氛围渐变（三维与 DOM 之间的过渡）

亮色：

```css
background:
  linear-gradient(180deg, rgba(234,231,226,.35), transparent 38%),
  radial-gradient(ellipse at 42% 47%, transparent 32%, rgba(232,229,225,.19) 85%);
```

详情态在右侧叠一条硬渐隐，把三维模型「推」到左侧：

```css
background: linear-gradient(90deg,
  transparent 40%,
  rgba(232,229,225,.2) 59%,
  rgba(232,229,225,.92) 68%,
  #e8e5e1 100%);
```

两者用 `opacity: calc(1 - var(--detail-shade))` / `var(--detail-shade)` 交叉淡入，由相机进度驱动。

### 7.4 全局屏幕合成滤镜（`src/screen-finish.ts`）

一个挂在 `#stage` 上的 SVG filter，`color-interpolation-filters="sRGB"`，作用于 WebGL + DOM + 弹窗的合成结果：

1. **色散**：程序生成一张 384px 宽的位移贴图（边缘 2% 内用 smoothstep 衰减到 0，避免采样越界彩框），用 `feDisplacementMap` 正负各一次分离红/蓝通道，再 `feBlend mode="screen"` 合回原绿通道。
2. **颗粒**：`feTurbulence type="fractalNoise"`，`baseFrequency = .95 - size*.85`，`numOctaves="1"`，去饱和后经 `feComponentTransfer` 只调 alpha，再以 `soft-light` 混合。**`seed` 以 12Hz 更新**（`Math.floor(time*12) % 97`），减少动态效果时冻结为 0。
3. **暗角**：程序生成的径向遮罩，`shade = 255 * (1 - .85 * radius^1.6)`，用 `feComposite operator="arithmetic"` 做 `k1*i1*i2 + k2*i1`。

三项默认值统一为 **20**，三个总开关默认关闭。

### 7.5 HUD 曲面视差

UI 各区块按四角计算投影矩阵投到同一个径向曲面上，左右与上下产生**相反斜率**。纵深默认 20%，曲率系数 = 纵深 × 0.08，鼠标追踪的切向项系数 0.0075、平滑速率 7。三维镜头不跟随被动鼠标。

---

## 8. 三维与 DOM 如何结合

这是整个项目最核心的机制，值得完整理解：

1. **共用同一套纸面色。** `scene.background`、雾色、查看器背景都是 `#eae5e1`，DOM 是 `#e8e5e1`。三维模型没有「贴」在页面上，而是**站在同一张纸上**。
2. **相机进度驱动 DOM。** 详情正文随相机从预览位推进到特写位的进度渐显，而不是用 CSS 定时器。遮罩交叉淡入也由同一进度驱动。
3. **材质连续过渡。** 阵列卡片和抽取出的卡片是**同一份几何、同一个表面**：颜色、粗糙度、透光率随升降高度连续插值；内部结构用稳定的屏幕空间覆盖率（Bayer 4×4 hash `fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))))`）渐显，避免出现可见的开关跳变。
4. **磨砂盖板的自上而下揭示**在 shader 里按 `vArchiveHeight = position.y / 3.7` 插值 `roughness`，与 Vue/CSS 无关。
5. **标签文字是 Canvas 贴图**，`fillStyle = "#171713"`，直接生成中文/编号并贴到卡片上。
6. **开场是纯 DOM/SVG**（`boot.ts`），不依赖 CSS 动画的已播放时长 —— 用显式时间函数推进，所以正常播放、慢放、前后跳帧状态一致。

---

## 9. 内容与文案的语气

档案正文是**原创编目文章**，不冒充游戏内原文。每份包含「设定参考链接」。

信息层级固定为双语对：**大写的英文微标签 + 加宽字距 / 中文主体**。

| 英文（宽字距大写） | 中文 | 位置 |
|---|---|---|
| `ARCHIVE / SELECT` | — | 计数器上方 |
| `INTERNAL DATABASE` | `机构档案` | 主区眉标 |
| `FILE NUMBER: X-001` | — | 主标题 |
| `ACCESS FILE` | — | 主行动 |
| `COLUMN 03 / 05` | `机构档案` | 列导航 |
| `DEPARTMENT / 科室` | `总构件科` | 元数据 |
| `COLLECTION / 编目范围` | `跨期资料汇编` | 元数据 |
| `RELATED / 相关人物` | `Kristen Wright / Saria` | 元数据 |
| `STATUS / 状态` | `已归档 · 可读取` | 元数据（前置方点） |
| `ABSTRACT / 摘要` | — | 面板标签 |
| `RESEARCH NOTES / 研究记录` | — | 面板标签 |
| `+ SAVE ARCHIVE` | `收藏档案` | 实心按钮（左英右中） |
| `POWERED BY` **RHINE LAB** ▬ | — | 右下署名 |
| `SESSION AUTHORIZED` | — | 页脚（前置方点） |
| `JOYCE MOORE / 12:22:18` | `REINITIALIZE ↗` | 页脚右侧 |
| `ENTER SYSTEM ↗` | — | 开场 |

**编号约定：** 档案 `X-001`（固定 `X-` 前缀 + 三位补零），列内 `01 / 08`（两位数），列号 `COLUMN 03 / 05`。

**语气：** 全大写英文做系统语，中文做内容语。没有感叹号，没有营销词，动词都是祈使式且偏行政（`ACCESS FILE`、`READ`、`REINITIALIZE`、`EXPORT`）。

---

## 10. 交互模型

| 输入 | 行为 |
|---|---|
| `←` `→` | 切换五类档案列（工程研究 / 生命科学 / 机构档案 / 能量研究 / 特别项目） |
| `↑` `↓` | 切换同列前后档案（每列 8 份，共 40 份） |
| `Enter` | 读取档案 |
| `/` | 检索 |
| `Esc` | 返回 |
| 鼠标拖动 | 自由平面拖动：对两条投影轨道组成的 2×2 矩阵求逆，把屏幕位移分解到列/档两个轨道，可随时转弯反向 |
| 松手 | 保留实际速度持续减速（类网页惯性滚动），临近停止才吸附 |
| 滚轮 | 只用于列内切档 |
| 悬停卡片 | 额外竖直抬起 0.28，约 200ms，移开平滑回落 |
| 触摸 | 左滑下一列 / 上滑下一档案，需 > 36 CSS px、主方向 ≥ 次方向 1.3 倍、1.4s 内完成 |
| 360° 查看器 | 单指旋转、双指缩放平移；方向键平移、滚轮/±缩放、`Home` 复位 |
| 焦点 | 所有 `:focus-visible` 统一 2px `#a67d48`，offset 4–7px；弹窗退出期间保持输入隔离和焦点，结束后归还 |

**重要约束（来自 AGENTS.md）：** 卡片从阵列升起进入特写时**只允许竖直升降**，不能用横向/纵深平移来重新构图 —— 靠近和转向必须由相机完成。背景卡片不能随特写进度额外下沉让位。

---

## 11. 值得复用的设计手法

按「最值得偷」排序：

1. **把边距做成一个变量。** `--edge: 59px` 全站锚点，一次改到位。
2. **双语标签对：宽字距大写英文 + 正常字距中文。** 一条规则就获得了「技术文档 / 官方系统」的质感。
3. **字号与字距反相关。** 大标题 −0.6 至 −1.3px 收紧；小标签 +0.7 至 +1.7px 放开。仅此一条就能把「默认排版」变成「设计过的排版」。
4. **刻度不用色块，用长度。** 2px 宽的竖线从 12px 变 33px 就是「选中」。同一套构件在档案导航和工作台导航里复用，形成系统感。
5. **小方块做信号。** 5–6px 的实心方块放在线段端点、数据值前、页脚状态前 —— 极低成本的技术感。
6. **零圆角 + 极少阴影。** 全站没有 border-radius（只有 `frost-surface` 的 3px），阴影只有弹窗一处。层级靠线和留白建立。
7. **纸面色在三层之间严格统一**（CSS 背景、Three.js 背景、雾色）。三维因此不像嵌进去的 canvas。
8. **相机进度驱动 DOM 透明度**，而不是定时器 —— 三维运动和文字揭示天然同步。
9. **单一焦点色。** `#a67d48` 贯穿所有 `:focus-visible`，用户永远知道「键盘焦点在哪」是同一件事。
10. **一个 `data-*` 属性切换整套主题**（`data-dark-surface`），而不是给每个组件加类名。
11. **`reduce-motion` 用一条通配规则兜底 + JS 侧显式分支。** 两者都要做：CSS 只管时长，JS 管相机/物理/颗粒。
12. **颗粒的 seed 以固定频率（12Hz）变化**，而不是每帧随机 —— 这是「胶片颗粒」和「电视雪花」的区别。
13. **入场动画统一为 opacity + 8–25px 位移 + 递增 delay**，不用弹性/回弹。克制是这套设计的一部分。
14. **可选的 SVG 全局合成滤镜**作用于 WebGL + DOM 的合成结果，让三维和文字获得同一层质感，而不是给三维单独加后期。
15. **琥珀是一个色族而非单色**：悬停 `#9b7247` / 刻度 `#a27849` / 焦点 `#a67d48` / 暗色 `#c5a16b`。
16. **另有独立的橄榄绿语义支线**（`#565c46` / `#353b30` / `#8b8f75`）专用于「开 / 就绪」状态，不参与强调。

---

## 12. 需要注意的边界

- 项目**明确禁止**使用前端设计 Skill 或动效 Skill，一切原生实现。若要在此基础上开发，须遵守该约束。
- 布局大量依赖 JS 打上的 `data-layout` / `data-mode` / `data-boot` 属性，纯 CSS 复现会丢失响应式行为。
- 字重 750 与 600 依赖 MiSans 分包；换字体后品牌三行的 270px 宽度校准会失效。
- Novecento Sans Wide 是授权字体，不入 Git；缺失时回退到项目内固定轮廓。
- `fonts.css` 有 587 KB / 753 条 `@font-face`，是人肉不该碰的生成文件。
- `style.css` 末尾存在**后置覆盖**段落（"Reading sizes..."），修改时容易与前面的原值冲突。
- 三维部分（`scene.ts` 75 KB、`main.ts` 61 KB）是项目主体，本记录只覆盖了与视觉/排版相关的接口。

---

*本文档由只读分析生成，未修改 `RhineLabUI-main` 中的任何文件。*
