# 构建 KbMonitor.exe（单文件、无控制台窗口）
# 用法：右键“使用 PowerShell 运行”，或在 PowerShell 中执行 .\build_exe.ps1
#       .\build_exe.ps1 -SkipDeps     仅重打包界面 / 图标时用，跳过依赖安装
#       .\build_exe.ps1 -SkipThree    跳过 three.global.js 的重新打包
# 依赖装到 .pydeps（兼容 Anaconda Python 无法建 venv 的情况）
param([switch]$SkipDeps, [switch]$SkipThree)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Deps = Join-Path $Root ".pydeps"

if (-not $SkipDeps) {
    python -m pip install --quiet --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --target $Deps --upgrade requests pywebview pyinstaller pillow
    if ($LASTEXITCODE -ne 0) { Write-Error "依赖安装失败"; exit 1 }
}

$env:PYTHONPATH = $Deps

# 界面字体：由 build_fonts.py 从 RhineLabUI 的 MiSans 网页分包子集化而来。
# 单独重建字体用：python kbapp\build_fonts.py
if (-not (Test-Path (Join-Path $Root "kbapp\web\fonts\manifest.json"))) {
    Write-Host "未找到字体子集，正在生成…"
    python (Join-Path $Root "kbapp\build_fonts.py")
    if ($LASTEXITCODE -ne 0) { Write-Error "字体子集生成失败"; exit 1 }
}

# 图标：栅格化原始品牌 SVG（需要本机 Edge）
python (Join-Path $Root "kbapp\gen_icon.py")
if ($LASTEXITCODE -ne 0) { Write-Error "图标生成失败"; exit 1 }

# 页面自身也引用同一枚图标。pywebview 没有标签栏，但预览壳与端到端跑在真浏览器里，
# 页面不声明 favicon 会让每次控制台都带上一条 /favicon.ico 404，把真正的资源错误淹掉。
Copy-Item (Join-Path $Root "kbapp\icon.ico") (Join-Path $Root "kbapp\web\favicon.ico") -Force

# 阵列 bundle 的陈旧检查。
# rhine-scene-host.js 与 web\rhine\*.js 都是 build-rhine.mjs 的输入，而页面实际加载的
# 是它的产物 vendor\rhine.global.js。改了输入却带 -SkipThree 打包，bundle 不会重新生成，
# exe 里跑的还是旧逻辑，而且**不报任何错** —— 曾栽在这上面：改了入场落点，
# 界面毫无反应，查了半天才发现那个文件根本没进包。
$bundle = Join-Path $Root "kbapp\web\vendor\rhine.global.js"
$bundleInputs = @(Join-Path $Root "kbapp\web\rhine-scene-host.js")
$rhineDir = Join-Path $Root "kbapp\web\rhine"
if (Test-Path $rhineDir) {
    $bundleInputs += (Get-ChildItem $rhineDir -Filter *.js | ForEach-Object { $_.FullName })
}
$needBundle = $true
if (Test-Path $bundle) {
    $built = (Get-Item $bundle).LastWriteTime
    $stale = @($bundleInputs | Where-Object { (Test-Path $_) -and ((Get-Item $_).LastWriteTime -gt $built) })
    $needBundle = $stale.Count -gt 0
    if ($needBundle) {
        Write-Host "阵列 bundle 比输入旧，强制重建（即使带了 -SkipThree）："
        $stale | ForEach-Object { Write-Host ("  " + (Split-Path $_ -Leaf)) }
    }
}
# 带 -SkipThree 时也要把过期的 bundle 补上：这条链只依赖已有的 three.global.js，
# 几秒钟的事，比打进一份旧逻辑强。
if ($SkipThree -and $needBundle) {
    node (Join-Path $Root "kbapp\build-rhine.mjs")
    if ($LASTEXITCODE -ne 0) { Write-Error "阵列 bundle 重建失败"; exit 1 }
}

# three.js：源码是 ESM，而 pywebview 以 file:// 加载页面（Chromium 在 file:// 下
# 禁止 module import），所以必须打成经典脚本。单独重建用：
#     node kbapp\build-three.mjs
if (-not $SkipThree) {
    node (Join-Path $Root "kbapp\build-three.mjs")
    if ($LASTEXITCODE -ne 0) { Write-Error "three.js 打包失败"; exit 1 }
}

# 阵列：three.js + 移植的 RhineLabUI scene.ts，以及内联的 GLB 模型。
# 三者都是生成物，单独重建用：
#     node kbapp\port-rhine.mjs     从上游源码逐行移植
#     node kbapp\build-three.mjs    打包 three.js（自动同步 addons）
#     node kbapp\build-rhine.mjs    打包阵列 bundle
#     python kbapp\build-models.py  GLB -> 内联经典脚本
$arrayScripts = @("port-rhine.mjs", "build-three.mjs", "build-rhine.mjs")
if (-not $SkipThree) {
    foreach ($s in $arrayScripts) {
        node (Join-Path $Root "kbapp\$s")
        if ($LASTEXITCODE -ne 0) { Write-Error "$s 失败"; exit 1 }
    }
    python (Join-Path $Root "kbapp\build-models.py")
    if ($LASTEXITCODE -ne 0) { Write-Error "模型内联失败"; exit 1 }
}

# 必须显式排除的重量级依赖。
# Anaconda 环境里装着 PyQt5 / PySide6，pywebview 的钩子会经 qtpy 选中 PyQt5，
# 再把整个 QtWebEngine 拖进包里（实测 exe 从 23 MB 涨到 320 MB）。
# 本应用用 EdgeChromium 后端（WebView2），完全不需要 Qt。
$Excludes = @(
    "PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "shiboken2", "shiboken6",
    "numpy", "scipy", "pandas", "matplotlib", "yaml", "PIL", "psutil",
    "tkinter", "sqlite3", "streamlit", "IPython", "pytest", "setuptools"
)
$ExcludeArgs = $Excludes | ForEach-Object { "--exclude-module"; $_ }

python -m PyInstaller --noconfirm --clean --onefile --noconsole `
    --name KbMonitor `
    --icon (Join-Path $Root "kbapp\icon.ico") `
    --add-data "$(Join-Path $Root 'kbapp\web');web" `
    --paths $Deps `
    @ExcludeArgs `
    --collect-all pywebview --collect-all pythonnet --collect-all clr_loader `
    --distpath (Join-Path $Root "dist") `
    --workpath (Join-Path $Root "build") `
    --specpath (Join-Path $Root "build") `
    (Join-Path $Root "kbapp\app.py")
if ($LASTEXITCODE -ne 0) { Write-Error "PyInstaller 打包失败"; exit 1 }

# 体积护栏：漏掉 excludes 会让 QtWebEngine 混进来，这里直接拦住。
$size = (Get-Item (Join-Path $Root "dist\KbMonitor.exe")).Length
$limit = 90MB
if ($size -gt $limit) {
    Write-Error ("打包体积 {0:N1} MB 超过上限 {1:N0} MB —— 检查 --exclude-module 是否生效（Qt 是否被打进来）" -f ($size / 1MB), ($limit / 1MB))
    exit 1
}
Write-Host ("包体积 {0:N1} MB" -f ($size / 1MB))

# exe 同目录的 web\ 是运行时覆盖目录（见 app.py 的 resource_path：打包后优先读它，
# 读不到才用内置资源），所以这里必须同步**全部**顶层文件。
#
# 曾经只同步 *.js，于是 index.html / app.css 一直靠上一次留下的旧副本顶着：
# 改了界面样式，exe 里却是旧的那份（脚本新、界面旧），而且不报任何错。
# 目录只同步 fonts/License/vendor/rhine，其余顶层文件一律按名字覆盖。
#
# 含三维档案阵列：vendor（three.js + 阵列 bundle + 内联模型）与 rhine（移植件），
# 课程列表就是靠它们渲染的，约 9 MB。
Copy-Item (Join-Path $Root "dist\KbMonitor.exe") (Join-Path $Root "KbMonitor.exe") -Force
foreach ($d in @("fonts", "License", "vendor", "rhine")) {
    $dest = Join-Path $Root "web\$d"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Copy-Item (Join-Path $Root "kbapp\web\$d") $dest -Recurse -Force
}
foreach ($f in (Get-ChildItem (Join-Path $Root "kbapp\web") -File |
                Where-Object { $_.Name -notlike "_*" })) {
    Copy-Item $f.FullName (Join-Path $Root ("web\" + $f.Name)) -Force
}
Write-Host ""
Write-Host "构建完成：$(Join-Path $Root 'KbMonitor.exe')"
Write-Host "运行时界面目录已同步：$(Join-Path $Root 'web')"
