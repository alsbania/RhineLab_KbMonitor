/**
 * 生成 KbMonitor 的浏览器预览壳（开发验证用，不属于产品）。
 *
 * 把 kbapp/web/index.html 的 body 内联进来（去掉它的 script 标签），
 * 注入一份假的 pywebview API，再挂上生产用的 app.js —— 这样不用启动 exe
 * 也能在真实浏览器里核对界面与三维阵列。
 *
 *   node kbapp/make-preview.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, 'web');

const src = readFileSync(join(WEB, 'index.html'), 'utf8');

/**
 * 取出 head 里的 vendor 脚本（阵列运行时）与 body 结构。
 * 必须在剥 <script> 之前把 vendor 引用捞出来 —— 它们正是阵列能跑起来的前提。
 */
const vendorScripts = [...src.matchAll(/<script\s+src="(vendor\/[^"]+)"\s*><\/script>/g)]
  .map((m) => m[1]);

/**
 * 样式表也一并继承（app.css 与 fonts/misans-*.css）。
 * 这里曾经写死成只有 app.css，于是预览壳里从来没有 @font-face ——
 * 生产页面吃 MiSans，预览却吃回退字，所有在预览里做的视觉核对都偏了。
 * 改成从 index.html 提取，避免再出现「产品有、预览没有」的漂移。
 */
const styleLinks = [...src.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g)]
  .map((m) => m[1]);
if (!styleLinks.includes('app.css')) {
  console.warn('警告：index.html 里没有找到 app.css 引用');
}
const body = src.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

if (!vendorScripts.length) {
  console.warn('警告：index.html 里没有找到 vendor 脚本引用，预览壳将无法加载阵列');
}

const STUB = `
<script>
(function () {
  var ROWS = [
    { name: '医学影像处理', teacher: '陈立群', room: 'A-302', day: 1, start: 1, end: 2, weeks: '1-16' },
    { name: '生物医学信号', teacher: '王思远', room: 'B-115', day: 1, start: 3, end: 4, weeks: '1-16' },
    { name: '临床工程导论', teacher: '李慕白', room: 'C-201', day: 2, start: 1, end: 2, weeks: '1-8' },
    { name: '放射物理基础', teacher: '赵宁', room: 'A-410', day: 2, start: 5, end: 6, weeks: '1-16' },
    { name: '医学统计学', teacher: '孙雅', room: 'D-108', day: 3, start: 3, end: 4, weeks: '1-12' },
    { name: '医疗器械法规', teacher: '周文渊', room: 'B-220', day: 3, start: 7, end: 8, weeks: '9-16' },
    { name: '数字电路实验', teacher: '吴桐', room: '实验楼305', day: 4, start: 1, end: 3, weeks: '1-16' },
    { name: '专业英语', teacher: 'Emily Shaw', room: 'C-105', day: 4, start: 5, end: 6, weeks: '1-16' },
    { name: '医学图像重建', teacher: '郑一鸣', room: 'A-508', day: 5, start: 3, end: 5, weeks: '1-16' }
  ];
  var CFG = { base: 'https://jwc.example.edu.cn/jwglxt', username: 'PREVIEW', password: 'preview',
              watch: ['2025', '3'], push: { on: true }, auth: { username: 'PREVIEW', password: 'preview' } };
  // 配置落盘到 localStorage：这样「导入课表 → 刷新 → 还在不在」在预览里也测得出来
  try {
    var saved = JSON.parse(localStorage.getItem('__preview_cfg') || 'null');
    if (saved && typeof saved === 'object') CFG = Object.assign(CFG, saved);
  } catch (e) {}
  function d(v, ms) { return new Promise(function (r) { setTimeout(function () { r(v); }, ms || 20); }); }
  window.pywebview = { api: {
    get_config: function () { return d(CFG); },
    save_config: function (c) {
      Object.assign(CFG, c || {});
      try { localStorage.setItem('__preview_cfg', JSON.stringify(CFG)); } catch (e) {}
      return d({ ok: true });
    },
    // 两个状态文件：真机上是 exe 同目录的 ui_prefs.json / schedule_cache.json
    // （见 app.py）。预览里用 localStorage 模拟"落盘"，这样「设了 → 刷新 → 还在不在」
    // 在预览里也测得到。
    get_ui_prefs: function () {
      try { return d(JSON.parse(localStorage.getItem('__preview_ui_prefs') || '{}')); }
      catch (e) { return d({}); }
    },
    save_ui_prefs: function (v) {
      try { localStorage.setItem('__preview_ui_prefs', JSON.stringify(v || {})); } catch (e) {}
      return d({ ok: true });
    },
    get_schedule_cache: function () {
      try { return d(JSON.parse(localStorage.getItem('__preview_schedule') || '{}')); }
      catch (e) { return d({}); }
    },
    save_schedule_cache: function (v) {
      try { localStorage.setItem('__preview_schedule', JSON.stringify(v || {})); } catch (e) {}
      return d({ ok: true });
    },
    // 导入：真解析在 Python 侧（app.py 的 import_schedule_xlsx），这里只当接线用的桩
    pick_schedule_file: function () { return d({ ok: true, path: 'X:/fake-schedule.xlsx' }); },
    import_schedule_xlsx: function () { return d({ ok: true, skipped: 0,
      columns: ['day', 'end', 'name', 'room', 'start', 'teacher', 'weeks'],
      rows: [
        { name: '导入的课 A', teacher: '导A', room: 'Z-101', day: 1, start: 1, end: 2, weeks: '1-16' },
        { name: '导入的课 B', teacher: '导B', room: 'Z-202', day: 3, start: 5, end: 6, weeks: '1-8' }
      ] }, 60); },
    get_status: function () { return d({ state: 'idle', running: false, next_run: '今天 21:30',
      last_check: '2026-09-14 06:20', net_error_recent: false, configured: true, monitor_enabled: true,
      watched: '2025 第一学期(秋季)' }); },
    // 与 app.py 的 get_term_options 对齐：±20 年共 41 项，并且必须带 watch ——
    // 早先这里只写死两项、且漏了 watch，于是预览里学年按钮永远是「—」、
    // 「一次露 5 行 / 可滚动」这些也测不出来（假象，不是产品问题）。
    get_term_options: function () {
      var yy = 2026, ys = [];
      for (var k = 20; k >= -20; k--) ys.push((yy - k) + '-' + (yy - k + 1));
      return d({ years: ys, watch: ['2026-2027', '3'],
        terms: [{ v: '3', t: '第一学期(秋季)' }, { v: '12', t: '第二学期(春季)' }],
        default: { year: '2026-2027', term: '3' }, first_week_monday: '2026-09-07' });
    },
    view_term: function () { return d({ ok: true, rows: ROWS }, 40); },
    run_check: function () { return d({ ok: true }); },
    preview_push: function () { return d({ ok: true }); },
    tasks_status: function () { return d({ installed: false, tasks: [] }); },
    install_tasks: function () { return d({ ok: true }); },
    uninstall_tasks: function () { return d({ ok: true }); },
    get_logs: function () { return d('[06:20:00] 启动 KbMonitor'); },
    clear_logs: function () { return d({ ok: true }); }
  } };
  window.dispatchEvent(new Event('pywebviewready'));
})();
</script>`;

const out = `<!doctype html>
<!-- 开发预览壳：kbapp/make-preview.mjs 生成，不属于产品 -->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>KbMonitor 预览</title>
${styleLinks.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
${vendorScripts.map((s) => `<script src="${s}"></script>`).join('\n')}
</head>
<body>
${body}
${STUB}
<script src="app.js"></script>
</body>
</html>
`;

writeFileSync(join(WEB, '_shell.html'), out);
console.log(`_shell.html 已生成（${(out.length / 1024).toFixed(1)} KB）`);
