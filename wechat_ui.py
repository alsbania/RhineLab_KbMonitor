# -*- coding: utf-8 -*-
"""通过 Windows 桌面自动化，把消息发给微信电脑版的指定会话（默认"文件传输助手"）。

纯 ctypes 实现，无第三方依赖。只用于给"你自己已登录的微信"发通知。

前置条件：
  1. 微信电脑版已登录，并停留在主界面（未锁屏）
  2. 微信「设置」里保持默认：按 Enter 键发送消息
原理：找到微信窗口 → 前台激活 → Ctrl+F 搜索 → 粘贴会话名 → 回车打开会话
      → 粘贴消息 → 回车发送 → Esc 收起。
"""
import ctypes
import os
import subprocess
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# ---- 显式声明 64 位安全签名（windll 默认按 32 位 c_int 返回，句柄会被截断） ----
user32.FindWindowW.restype = ctypes.c_void_p
user32.FindWindowW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p]
user32.OpenClipboard.restype = ctypes.c_int
user32.OpenClipboard.argtypes = [ctypes.c_void_p]
user32.EmptyClipboard.restype = ctypes.c_int
user32.SetClipboardData.restype = ctypes.c_void_p
user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
user32.CloseClipboard.restype = ctypes.c_int
user32.ShowWindow.restype = ctypes.c_int
user32.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
user32.SetForegroundWindow.restype = ctypes.c_int
user32.SetForegroundWindow.argtypes = [ctypes.c_void_p]
user32.GetForegroundWindow.restype = ctypes.c_void_p
user32.keybd_event.restype = None
user32.keybd_event.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_uint, ctypes.c_void_p]
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalUnlock.restype = ctypes.c_int
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
kernel32.GlobalFree.restype = ctypes.c_void_p
kernel32.GlobalFree.argtypes = [ctypes.c_void_p]

CF_UNICODETEXT = 13
SW_RESTORE = 9
VK_MENU = 0x12
VK_CONTROL = 0x11
VK_F = 0x46
VK_V = 0x56
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B
KEYEVENTF_KEYUP = 0x0002


def _set_clipboard_ctypes(text):
    for _ in range(6):
        if not user32.OpenClipboard(None):
            time.sleep(0.4)
            continue
        try:
            user32.EmptyClipboard()
            buf = ctypes.create_unicode_buffer(text)
            h = kernel32.GlobalAlloc(0x0042, ctypes.sizeof(buf))  # GMEM_MOVEABLE|GMEM_ZEROINIT
            if not h:
                return False
            p = kernel32.GlobalLock(h)
            if not p:
                kernel32.GlobalFree(h)
                return False
            ctypes.memmove(p, buf, ctypes.sizeof(buf))
            kernel32.GlobalUnlock(h)
            if user32.SetClipboardData(CF_UNICODETEXT, h):
                return True  # 成功后系统接管内存，不可再释放
            kernel32.GlobalFree(h)
            return False
        finally:
            user32.CloseClipboard()
    return False


def _set_clipboard_pwsh(text):
    """兜底：经 PowerShell Set-Clipboard（原始字节进 stdin + 显式 UTF-8 解码，
    杜绝系统 GBK 代码页导致的 emoji 编码失败）。静默启动，不弹窗口。"""
    try:
        r = subprocess.run(
            ["pwsh", "-NoProfile", "-Command",
             "$ErrorActionPreference='Stop'; $b=[Console]::OpenStandardInput().ReadToEnd(); "
             "$t=[Text.Encoding]::UTF8.GetString($b); Set-Clipboard -Value $t"],
            input=text.encode("utf-8"), capture_output=True, timeout=12,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.returncode == 0
    except Exception:
        return False


def _set_clipboard(text):
    return _set_clipboard_ctypes(text) or _set_clipboard_pwsh(text)


def _key(vk):
    user32.keybd_event(vk, 0, 0, 0)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def _hotkey(vk, mod):
    user32.keybd_event(mod, 0, 0, 0)
    user32.keybd_event(vk, 0, 0, 0)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
    user32.keybd_event(mod, 0, KEYEVENTF_KEYUP, 0)


def _find_wechat():
    h = user32.FindWindowW("WeChatMainWndForPC", None)
    if not h:
        h = user32.FindWindowW(None, "微信")
    return h


def _activate(hwnd):
    for _ in range(5):
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.3)
        if user32.GetForegroundWindow() == hwnd:
            return True
        # Windows 前台窗口锁：先空敲一下 Alt 释放焦点
        _key(VK_MENU)
        time.sleep(0.15)
    return False


def send_to_wechat(contact, text):
    """发送 text 到微信会话 contact。返回 (成功?, 说明文字)。"""
    try:
        return _send_to_wechat_impl(contact, text)
    except Exception:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "wechat_trace.txt"), "a", encoding="utf-8") as f:
                import traceback as _tb
                f.write("=== {}\n".format(time.strftime("%Y-%m-%d %H:%M:%S")))
                f.write(_tb.format_exc())
                f.write("\n")
        except Exception:
            pass
        raise


def _send_to_wechat_impl(contact, text):
    hwnd = _find_wechat()
    if not hwnd:
        return False, "未找到微信窗口：请先登录并打开微信电脑版"
    if not _activate(hwnd):
        return False, "无法把微信窗口调到前台（可能被锁定），请先解锁并手动点开微信后重试"
    time.sleep(0.5)

    if not _set_clipboard(contact):
        return False, "写入剪贴板失败"
    _hotkey(VK_F, VK_CONTROL)      # 打开搜索
    time.sleep(0.5)
    _hotkey(VK_V, VK_CONTROL)      # 粘贴会话名
    time.sleep(0.6)
    _key(VK_RETURN)                # 打开会话
    time.sleep(0.8)

    if not _set_clipboard(text):
        _key(VK_ESCAPE)
        return False, "写入剪贴板失败"
    _hotkey(VK_V, VK_CONTROL)      # 粘贴消息
    time.sleep(0.4)
    _key(VK_RETURN)                # 发送（需微信设置"按Enter发送"）
    time.sleep(0.5)
    _key(VK_ESCAPE)                # 收起搜索/关闭聊天浮层
    return True, "已发送到微信会话「{}」".format(contact)


if __name__ == "__main__":
    ok, msg = send_to_wechat("文件传输助手", "KbMonitor 测试消息 " + time.strftime("%H:%M:%S"))
    print(("OK: " if ok else "FAIL: ") + msg)
