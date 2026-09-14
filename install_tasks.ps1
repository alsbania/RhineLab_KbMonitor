# 注册 Windows 任务计划：每天 10:00 与 17:00 各跑一次课表监控
# 用法：右键“使用 PowerShell 运行”，或在 PowerShell 里执行
#   .\install_tasks.ps1
# 2026-09-14 清理：$Script 原本写死一个绝对路径（指向被清理掉的旧目录）。
# 目录一挪就注册到不存在的路径（schtasks 不做校验，任务会静默失败）。
# 现改为相对本脚本定位 monitor_kb.py。
#
# 注意：默认值必须写在 param() 之外。PowerShell 的参数绑定先于脚本体执行，
# 此时 $PSScriptRoot 还没有值、也不能调用 Join-Path —— 写在 param() 里是语法错误。
param(
    [string]$Python = "python",
    [string]$Script
)

if (-not $Script) { $Script = Join-Path $PSScriptRoot "monitor_kb.py" }

if (-not (Test-Path $Script)) {
    Write-Error "找不到脚本: $Script"
    exit 1
}
$Script = (Resolve-Path $Script).Path
$tr = "$Python `"$Script`""

schtasks /Create /F /SC DAILY /ST 10:00 /TN "课表监控_10点" /TR $tr
schtasks /Create /F /SC DAILY /ST 17:00 /TN "课表监控_17点" /TR $tr

Write-Host ""
Write-Host "已创建两个定时任务。查看："
Write-Host "  schtasks /Query /TN 课表监控_10点"
Write-Host "  schtasks /Query /TN 课表监控_17点"
Write-Host "删除：schtasks /Delete /TN 课表监控_10点 /F （17点同理）"
Write-Host ""
Write-Host "提示：任务默认在你登录 Windows 时运行；若需电脑休眠/未登录也能跑，"
Write-Host "请到 任务计划程序 里把任务的“常规→安全选项”改为‘不管用户是否登录都要运行’并填入 Windows 密码。"
