'use strict';
const WEEKS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEK_HEADS = ['一', '二', '三', '四', '五', '六', '日'];
const XQM = { '3': '秋季学期', '12': '春季学期', '16': '暑期学期' };
const STATUS_ICON = '<svg class="ico"><use href="#i-dot"></use></svg>';

/* 课程块配色：浅色为低饱和纸面 + 深墨；深色另配深纸面 + 亮墨。
   2026-09 换过一轮：原来第 8 组是暖灰（#e7e5e0 / #4d4a43），
   在浅色底上糊成一团、跟纸面分不开；现在换成浅紫，
   八组色相拉得更开，最小对比度也从 4.88 提到 5.32（深色 6.54 → 7.20）。 */
const PALETTE = [
  ['#dfe4f2', '#3d4a76'], ['#dde8dd', '#396341'], ['#ece1cb', '#75541f'], ['#eedad9', '#783d39'],
  ['#d9e5e8', '#315a66'], ['#e5dcee', '#523d72'], ['#e9e5cd', '#5f5a26'], ['#e3ddec', '#4f4470']
];
const PALETTE_DARK = [
  ['#1a2136', '#9db0ea'], ['#19261e', '#96d6a8'], ['#2e2614', '#e2b971'], ['#2f1d1c', '#e9a59c'],
  ['#15282d', '#8ccfdb'], ['#261d34', '#c0a6e8'], ['#2a2915', '#d3ca80'], ['#231d33', '#b3a4e2']
];

let api = null;
let cfgObj = null;
let currentRows = [];
let timeList = ['10:00', '17:00'];
let logTimer = null;
let modalReset = null;       // 课程详情弹窗的倾斜复位

/* ---------------- 外观偏好（存在 exe 同目录的 ui_prefs.json） ----------------
   疏密 / 毛玻璃 / 悬浮漂移 / 阵列画质 / 超级性能 全部走这一个文件。

   为什么不是 localStorage：pywebview 默认 private_mode=True，WebView2 拿临时目录
   当用户数据目录、退出即删，页面里写的东西下次启动就是空的 —— 表现就是
   「设了阵列画质，下次打开又回去了」，而且异常被 try/catch 吞掉，连报错都没有。
   localStorage 只留一份镜像做兜底（开发预览 / 接口缺失时）。 */
const LOOK_KEY = 'kbmonitor.look.v1';
const UI_PREFS_KEY = 'kbmonitor.ui.v1';
const LOOK_DENSITIES = ['compact', 'standard', 'slim'];
const LOOK_LAYOUTS = ['duo', 'original'];
/* layout：课表布局
     duo      —— 左右并排两周（每天约 74px，右半边放下一周，不空）
     original —— 原版一周铺满（每天约 147px）
   listView：课程清单下面的表格怎么摆（外观 › 清单视图）
     split —— 默认。上阵列、下表格，各占一半。选它当默认是因为阵列区始终可见，
              空闲预热才有真实尺寸可用（表格档下舞台是 display:none，见 warmListArray）
     array —— 三维阵列占满面板，表格不显示
     table —— 表格占满面板，阵列让位 */
const LIST_VIEWS = ['array', 'split', 'table'];
const lookPrefs = { density: 'standard', frost: true, drift: true, layout: 'duo', listView: 'split' };

let uiPrefsDisk = null;      // 启动时从 ui_prefs.json 读到的内容
let scheduleDisk = null;     // 启动时从 schedule_cache.json 读到的内容

/** 启动时把两个状态文件读进来。必须在 fillForm 之前调用。 */
async function loadDiskPrefs() {
  if (!api) return;
  try { uiPrefsDisk = await api.get_ui_prefs(); } catch (e) { uiPrefsDisk = null; }
  try { scheduleDisk = await api.get_schedule_cache(); } catch (e) { scheduleDisk = null; }
}

/** 把磁盘里的外观/画质合并进来并应用（磁盘优先于 localStorage）。 */
function applyStoredPrefs() {
  const p = uiPrefsDisk;
  if (p && typeof p === 'object') {
    const a = p.array, l = p.look;
    if (a && typeof a === 'object') {
      if (ARRAY_QUALITY_NAMES.indexOf(a.quality) >= 0) arrayPerf.quality = a.quality;
      if (typeof a.superPerformance === 'boolean') arrayPerf.superPerformance = a.superPerformance;
    }
    if (l && typeof l === 'object') {
      if (LOOK_DENSITIES.indexOf(l.density) >= 0) lookPrefs.density = l.density;
      if (typeof l.frost === 'boolean') lookPrefs.frost = l.frost;
      if (typeof l.drift === 'boolean') lookPrefs.drift = l.drift;
      if (LOOK_LAYOUTS.indexOf(l.layout) >= 0) lookPrefs.layout = l.layout;
      if (LIST_VIEWS.indexOf(l.listView) >= 0) lookPrefs.listView = l.listView;
      else if (l.table === true) lookPrefs.listView = 'table';  // 兼容旧的布尔开关
    }
  }
  applyArrayPerf();
  /* 磁盘里的偏好是权威的，读完必须再刷一次界面状态 ——
     applyFx() 在更早的初始化里已经跑过一次，那次读到的还只是 localStorage 镜像。 */
  applyFx();
}

let uiSaveTimer = 0;
/** 外观 + 画质一起写盘（合并 300ms，避免连点按钮时反复写）。 */
function saveUiPrefs() {
  const payload = { array: { quality: arrayPerf.quality, superPerformance: arrayPerf.superPerformance }, look: lookPrefs };
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(payload)); } catch (e) { /* 只是镜像 */ }
  if (!api || typeof api.save_ui_prefs !== 'function') return;
  clearTimeout(uiSaveTimer);
  uiSaveTimer = setTimeout(() => {
    try { Promise.resolve(api.save_ui_prefs(payload)).catch(() => {}); } catch (e) { /* 忽略 */ }
  }, 300);
}

function loadLook() {
  // 先看磁盘（applyStoredPrefs 会覆盖），再退回 localStorage 镜像
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY) || localStorage.getItem(LOOK_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    const l = (v && v.look) || v;          // 兼容只有 look 的旧格式
    if (!l || typeof l !== 'object') return;
    if (LOOK_DENSITIES.indexOf(l.density) >= 0) lookPrefs.density = l.density;
    if (typeof l.frost === 'boolean') lookPrefs.frost = l.frost;
    if (typeof l.drift === 'boolean') lookPrefs.drift = l.drift;
    if (LOOK_LAYOUTS.indexOf(l.layout) >= 0) lookPrefs.layout = l.layout;
    if (LIST_VIEWS.indexOf(l.listView) >= 0) lookPrefs.listView = l.listView;
    else if (l.table === true) lookPrefs.listView = 'table';  // 兼容旧的布尔开关
  } catch (e) { /* 存储不可用就用默认 */ }
}
function saveLook() { saveUiPrefs(); }
loadLook();

function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function icon(id) { return '<svg class="ico"><use href="#' + id + '"></use></svg>'; }
function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || 'info');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3400);
}

/* ---------------- 状态指示 / 时钟 ---------------- */
function setPill(text, state) {
  const el = $('statusPill');
  if (!el || el.dataset.state === state) return;
  el.dataset.state = state;
  el.className = 'status-pill ' + state;
  el.innerHTML = STATUS_ICON + esc(text);
}
function tickClock() {
  const el = $('clock');
  if (!el) return;
  const now = new Date();
  const two = n => String(n).padStart(2, '0');
  el.innerHTML = two(now.getHours()) + ':' + two(now.getMinutes()) +
    '<i>' + two(now.getSeconds()) + '</i>';
}

/* ---------------- 标签页 ---------------- */
function showTab(name) {
  const btn = document.querySelector('.nav-item[data-tab="' + name + '"]');
  if (btn) btn.click();
}
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => {
      const on = b === btn;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab));
    const span = btn.querySelector('span');
    $('pageTitle').textContent = span ? span.textContent.trim() : '';
    manageLogPolling(btn.dataset.tab === 'logs');
    // 课程清单栏：进来时启动阵列（首次要载模型），离开时停掉逐帧渲染
    if (btn.dataset.tab === 'list') {
      renderList();
      startListArray();
    } else {
      stopListArray();
    }
  });
});

/* ---------------- 状态轮询 ---------------- */
let configuredWarned = false;
let netWarned = false;
let lastStatusKey = '';
async function refreshStatus() {
  if (!api) return;
  try {
    const st = await api.get_status();
    const timesKey = (st.times || []).join(',');
    const key = [st.running, st.last_check, st.next_run, timesKey,
      st.tasks_ok, st.configured, st.monitor_enabled].join('|');
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    setPill(st.running ? '查询中' : '空闲', st.running ? 'running' : 'idle');
    const dot = $('liveDot');
    if (dot) {
      const s = st.running ? 'running'
        : (st.net_error_recent ? 'warn' : (st.monitor_enabled === false ? 'off' : 'on'));
      dot.className = 'live-dot ' + s;
      dot.title = '监控状态：' + (st.running ? '正在查询'
        : st.net_error_recent ? '刚发生网络异常'
        : st.monitor_enabled === false ? '自动监控已关闭' : '监控中') +
        ' · 最近查询 ' + st.last_check;
    }
    $('statLast').textContent = st.last_check === '-' ? '--' : st.last_check;
    $('statLast').title = st.last_check;
    if (!st.configured) {
      $('nextRun').textContent = '⚠ 请先完成配置';
      if (!configuredWarned) {
        configuredWarned = true;   // 只提醒一次，不反复抢焦点
        showTab('settings');
        toast('请先在「设置」填写学号 / 密码 / 推送通道', 'err');
      }
    } else if (st.monitor_enabled === false) {
      configuredWarned = false;
      $('nextRun').textContent = '⏸ 自动监控已关闭';
    } else {
      configuredWarned = false;
      $('nextRun').textContent = '下次 ' + st.next_run + '｜' +
        (timesKey || '10:00,17:00').replace(/,/g, ' / ') +
        (st.tasks_ok ? '\n系统任务 ✓' : '');
      if (st.net_error_recent && !netWarned) {
        netWarned = true;
        toast('检测到最近网络异常，若刚断网可稍后重试', 'err');
      }
    }
  } catch (e) { /* ignore */ }
}

/* ---------------- 课表渲染 ---------------- */
function courseKey(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}
function dayLabel(d) { return (d >= 1 && d <= 7) ? WEEKS[d - 1] : '—'; }
const ROW_H = 50;   // 默认每节行高；与 app.css 的 --row-h 默认值保持一致

/* 每节行高。用户认为「瘦长」才是标准比例，把它又调高了一档（60 → 72）。
   行宽由 app.css 的 .kb 决定：原版铺满（7 列，每天约 147px），
   双周并排（14 列，每天约 74px）—— 正好用上右半边。 */
const DENSITIES = {
  compact: { rowH: 42, inset: 4, name: '11.5px', sub: '10px', meta: '9px', label: '紧凑' },
  standard: { rowH: 50, inset: 5, name: '12px', sub: '10.5px', meta: '9.5px', label: '标准' },
  slim: { rowH: 72, inset: 7, name: '12.5px', sub: '11px', meta: '10px', label: '瘦长' }
};
let density = 'standard';
function densityPreset() { return DENSITIES[density] || DENSITIES.standard; }
function applyDensityUI() {
  const D = densityPreset();
  document.querySelectorAll('[data-density]').forEach(b => {
    b.classList.toggle('active', b.dataset.density === density);
  });
  const hint = $('densityHint');
  if (hint) hint.textContent = '当前：' + D.label + '（每节 ' + D.rowH + 'px，11 节共 ' + (D.rowH * 11) + 'px）';
  const g = $('grid');
  if (g && g.style && g.style.setProperty) {
    g.style.setProperty('--row-h', D.rowH + 'px');
    g.style.setProperty('--blk-name', D.name);
    g.style.setProperty('--blk-sub', D.sub);
    g.style.setProperty('--blk-meta', D.meta);
  }
}

/* ---------------- 课表布局：双周并排 / 原版 ----------------
   只写一个 data-layout，宽度和列数由 renderGrid 与 app.css 决定。
   切换后要重绘（列数变了），并且要清掉残影：卡片节点整个重建。 */
function applyLayoutUI() {
  document.querySelectorAll('[data-layout]').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === lookPrefs.layout);
  });
  const g = $('grid');
  if (g && g.dataset) g.dataset.layout = lookPrefs.layout;
}
document.querySelectorAll('[data-layout]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (lookPrefs.layout === btn.dataset.layout) return;
    lookPrefs.layout = btn.dataset.layout;
    saveLook();
    applyLayoutUI();
    if (currentRows.length) renderGrid(currentRows);
    toast('课表布局：' + (lookPrefs.layout === 'duo' ? '双周并排（右边是下一周）' : '原版（一周铺满）') +
      '，下次启动仍然保留', 'ok');
  });
});

/* ---------------- 切周的滑动动画（真正的轮播） ----------------
   轨道上画了 4 组周，窗口（.kb-clip）只露出中间两组。
   往左滑一格 = 左边那组移出、右边那组顶上来，**右下那一组早就画好了**，
   直接显形即可，所以滑完那次重绘不能再播入场动画（否则就是"重新现形一次"）。
   滑完把窗口瞬时复位到基准位置（--pos: 1）：此时画面里是新的第 2、3 组，
   与刚才滑到的位置内容完全一致，看不到跳。
   三条轨道（周标签 / 星期 / 格子）共用 #grid 上的 --pos，所以永远对齐。 */
const SLIDE_MS = 320;
let suppressEntranceOnce = false;
let grCtx = null;   // renderGrid 的渲染上下文（week*Html / recycleDuo 共用）
function slideWeekTo(dir, nextWeek) {
  const g = $('grid');
  if (!g || !g.style || lookPrefs.layout !== 'duo' || !currentRows.length) return false;
  /* 窗口没动就别滑：最后一周往回退时，窗口仍是 [last-1, last]，
     硬滑一格会移到一组不该显示的内容上。交给普通重绘（只是高亮换一格）。 */
  if (duoWindowStart(nextWeek) === duoWindowStart(curWeek)) return false;
  g.style.setProperty('--slide-dur', SLIDE_MS + 'ms');
  g.style.setProperty('--pos', dir > 0 ? '2' : '0');   // 2 = 两组右移，0 = 两组左移
  setTimeout(() => {
    /* 滑完只"转一格"：把滑出视野的那组搬到另一端、重填成新的一周。
       可见的两组节点完全不动 —— 不重绘、不闪、也不清掉悬停与磨砂状态。 */
    if (!recycleDuo(nextWeek)) {
      curWeek = nextWeek;
      suppressEntranceOnce = true;
      renderGrid(currentRows);
    }
  }, SLIDE_MS);
  return true;
}

function dayKeyOf(r) { return (r.day >= 1 && r.day <= 7) ? r.day : 8; }

function mergeAdjacent(list) {
  // 同一门课（课名/教师/教室/周次全同）而节次相连的记录合并成一整块
  // 必须先按「星期 + 节次」排序，否则不同天的课会交错插进来导致漏合并
  const sorted = list.slice().sort((a, b) => (a.day || 0) - (b.day || 0) ||
    a.start - b.start || a.end - b.end);
  const out = [];
  sorted.forEach(r => {
    const last = out[out.length - 1];
    if (last && last.day === r.day && last.name === r.name && last.teacher === r.teacher &&
        last.room === r.room && last.weeks === r.weeks && last.end + 1 >= r.start) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push(Object.assign({}, r));
    }
  });
  return out;
}

function buildDayBlocks(list) {
  // 同一天内把重叠课程排到不同 lane（并排列），互不重叠的课程占满整宽
  const sorted = list.slice().sort((a, b) => a.start - b.start || a.end - b.end ||
    String(a.name).localeCompare(String(b.name)));
  const laneEnds = [];
  const placed = [];
  sorted.forEach(r => {
    let lane = laneEnds.findIndex(end => end < r.start);
    if (lane === -1) { lane = laneEnds.length; }
    laneEnds[lane] = r.end;
    placed.push({ r: r, lane: lane });
  });
  return { placed: placed, lanes: Math.max(1, laneEnds.length) };
}

function renderGrid(rows) {
  const grid = $('grid'), empty = $('emptyState');
  // 老节点在下面被换掉之前先让倾斜缓存失效 —— 否则缓存里留着的是一批
  // 已经脱离文档的死节点，反光会「看着像坏了」：指针再也命中不了任何一块。
  if (invalidateRects) invalidateRects();
  // 失焦是逐卡算的，重绘会把上一批带 --blur 的节点整个换掉；
  // 新节点从 initial-value 起算，这里不需要额外清理，但不能沿用旧的缓存表。
  if (resetBlur) resetBlur();
  if (!rows.length) {
    grid.style.display = 'none';
    empty.style.display = '';
    updateWeekBar(0);
    renderRuler();
    return;
  }
  empty.style.display = 'none';
  grid.style.display = '';
  const weekRows = rows.filter(r => weekActive(r, curWeek));
  const untimed = weekRows.filter(r => !(r.start > 0));
  // 行数按「整个学期最晚节次」固定（最低 8 行），翻周时表格高度不跳动
  let maxP = 8;
  rows.forEach(r => { if (r.end > maxP) maxP = r.end; });
  /* 双周并排：左 = 本周，右 = 下一周。
     到最后一周时把这一对整体往前挪一格（[maxWeek-1, maxWeek]），
     免得右边空着 —— 「右边放下一周不显得很空」正是这个布局的目的。 */
  const duo = lookPrefs.layout === 'duo' && maxWeek > 1;
  const groups = duo ? duoGroups(curWeek) : [curWeek];
  // 有课的星期（含"其它"）：各组合起来判断，所有组的列必须一致
  const hasUnknown = groups.some(w => rows.some(r => weekActive(r, w) && r.start > 0 && dayKeyOf(r) === 8));
  const daySel = [];
  for (let d = 1; d <= 7; d++) daySel.push(d);
  if (hasUnknown) daySel.push(8);
  const wd = new Date().getDay();
  const todayIdx = (wd === 0 ? 7 : wd);
  slotMap = {};
  const D = densityPreset();
  const rowH = D.rowH;
  const bodyH = maxP * rowH;
  /* 渲染上下文：weekLabelHtml / weekHeadHtml / weekBodyHtml 要用。
     它们同时被滑动回收复用（见 recycleDuo），所以不能把这些量关在 renderGrid 里。
     n 是全局块序号（--i 的入场错峰 + 课程序号）。 */
  grCtx = { rows, daySel, maxP, rowH, bodyH, D, todayIdx, n: 0 };

  let html = '';
  if (duo) {
    html += '<div class="kb-head kb-head-wk"><div class="kb-corner"></div>' +
      '<div class="kb-clip"><div class="kb-track">';
    groups.forEach(w => { html += '<div class="kb-group">' + weekLabelHtml(w) + '</div>'; });
    html += '</div></div></div>';
  }
  html += '<div class="kb-head"><div class="kb-corner">节次</div>' +
    '<div class="kb-clip"><div class="kb-track">';
  groups.forEach(w => { html += '<div class="kb-group">' + weekHeadHtml(w) + '</div>'; });
  html += '</div></div></div><div class="kb-body"><div class="kb-times">';
  for (let p = 1; p <= maxP; p++) html += '<div class="kb-time">' + p + '</div>';
  html += '</div><div class="kb-clip"><div class="kb-track">';

  groups.forEach(w => {
    html += '<div class="kb-group">' + weekBodyHtml(w) + '</div>';
  });
  html += '</div></div></div>';
  if (untimed.length) {
    html += '<div class="kb-untimed">未标注具体时段的课程：' +
      untimed.map(r => esc(r.name + (r.teacher ? '（' + r.teacher + '）' : ''))).join('、') + '</div>';
  }
  grid.innerHTML = html;
  grid.dataset.layout = lookPrefs.layout;
  // 每次重绘都把窗口归到基准位置（第 1、2 组）——滑动结束后靠这一步瞬时复位，
  // 因为此时画面内容与新的一组完全相同，看不到跳。
  grid.style.setProperty('--slide-dur', '0ms');
  grid.style.setProperty('--pos', duo ? '1' : '0');
  /* 滑动落地时的这次重绘不能再播入场错峰：那正是"重新现形一次"，
     而滑动时右边那组本来就已经画好了（见 slideWeekTo）。 */
  if (suppressEntranceOnce) suppressEntranceOnce = false;
  else playEntrance(grid);
  // 动画在播期间不许再切周（见 playWeekFx / WEEK_LOCK_MS）
  weekLockUntil = Date.now() + WEEK_LOCK_MS;
  updateWeekBar(weekRows.length);
  renderRuler();
}

/** 双周窗口的左格：第 w 周显示在左；到最后一周时窗口前移一格，右边不留空。 */
function duoWindowStart(w) {
  const last = Math.max(1, maxWeek);
  return Math.max(1, Math.min(w, Math.max(1, last - 1)));
}

/* ---------------- 一周一组的三段 HTML ----------------
   renderGrid 生成整块时用它们，滑动回收时只用其中一段（见 recycleDuo）。
   都依赖 grCtx，由 renderGrid 事先设好。 */
function weekLabelHtml(w) {
  const ok = w >= 1 && w <= maxWeek;
  return '<div class="kb-wk' + (w === curWeek ? ' now' : '') + '">' +
    (ok ? '第 ' + w + ' 周' + (w === curWeek ? '<i>本周</i>' : '') : '') + '</div>';
}
function weekHeadHtml(w) {
  const c = grCtx;
  if (!c) return '';
  let h = '';
  c.daySel.forEach(d => {
    const isToday = w === curWeek && d === c.todayIdx;
    const dt = isToday ? dayDateLabel(d) : '';
    h += '<div class="kb-hd' + (isToday ? ' today' : '') + '">' +
      '<span class="zh">' + (d === 8 ? '其它' : WEEKS[d - 1]) + '</span>' +
      (dt ? '<span class="dt">' + dt + '</span>' : '') + '</div>';
  });
  return h;
}
function weekBodyHtml(w) {
  const c = grCtx;
  if (!c) return '';
  const D = c.D;
  const rowH = c.rowH;
  const bodyH = c.bodyH;
  const maxP = c.maxP;
  let h = '';
  const timed = mergeAdjacent(c.rows.filter(r => weekActive(r, w) && r.start > 0));
  c.daySel.forEach(d => {
    const list = timed.filter(r => dayKeyOf(r) === d);
    const b = buildDayBlocks(list);
    const coverMap = {};
    for (let p = 1; p <= maxP; p++) {
      coverMap[p] = b.placed.filter(it => p >= it.r.start && p <= it.r.end).map(it => it.r);
    }
    const isToday = w === curWeek && d === c.todayIdx;
    h += '<div class="kb-day' + (isToday ? ' today' : '') + '" style="height:' + bodyH + 'px">';
    b.placed.forEach(item => {
      c.n++;
      const r = item.r;
      const top = (r.start - 1) * rowH + 4;
      const height = (Math.min(r.end, maxP) - r.start + 1) * rowH - 8;
      const widthPct = 100 / b.lanes;
      const leftPct = item.lane * widthPct;
      // 键里必须带周次：双周时同一天同一节会出现两次，不带周次会互相覆盖
      const key = w + '_' + d + '_' + r.start;
      if (!slotMap[key]) {
        slotMap[key] = b.placed
          .map(it => it.r)
          .filter(x => !(x.end < r.start || x.start > r.end));
      }
      let conc = 1;
      for (let p = r.start; p <= Math.min(r.end, maxP); p++) {
        conc = Math.max(conc, (coverMap[p] || []).length);
      }
      const palIdx = courseKey(r.name) % PALETTE.length;
      const pal = PALETTE[palIdx];
      const palDark = PALETTE_DARK[palIdx];
      const sub = [r.teacher, r.room].filter(Boolean).join(' · ');
      const badge = conc > 1
        ? '<div class="blk-badge" title="该时段最多有 ' + conc + ' 门课重合，点击查看">' + conc + '</div>'
        : '';
      const inset = D.inset;
      h += '<div class="blk" data-slot="' + key + '" tabindex="0" role="button" title="' +
        esc(r.name + (sub ? '　' + sub : '') + (r.weeks ? '　' + r.weeks : '')) +
        '" style="--i:' + c.n + ';--blk-bg:' + pal[0] + ';--blk-ink:' + pal[1] +
        ';--blk-bg-d:' + palDark[0] + ';--blk-ink-d:' + palDark[1] + ';' +
        'top:' + top + 'px;height:' + height + 'px;' +
        'left:calc(' + leftPct + '% + ' + inset + 'px);width:calc(' + widthPct + '% - ' + (inset * 2) + 'px)">' +
        badge +
        '<span class="blk-idx">' + (c.n < 10 ? '0' : '') + c.n + '</span>' +
        '<div class="blk-body">' +
        '<div class="blk-name">' + esc(r.name) + '</div>' +
        '<div class="blk-sub">' + esc(sub) + '</div>' +
        (r.weeks ? '<div class="blk-meta">' + esc(r.weeks) + '</div>' : '') +
        '</div>' +
        '</div>';
    });
    h += '</div>';
  });
  return h;
}

/**
 * 滑动结束后把轨道「转一格」——不是重绘整块。
 *
 * 可见的那两组节点原封不动（这就是"后一周和原来一样"）：只把滑出视野的那一组
 * 搬到另一端、重新填成新的一周。三个轨道（周标签 / 星期 / 格子）一起转。
 * 顺带把周标签和星期里的 .now / .today 重刷一遍（它们是跟着 curWeek 走的），
 * 格子那两组只改 class，不重建节点。
 */
function recycleDuo(newCur) {
  const g = $('grid');
  if (!g || !grCtx) return false;
  const tracks = g.querySelectorAll('.kb-track');
  if (tracks.length < 3) return false;
  const old = duoGroups(curWeek);
  const next = duoGroups(newCur);
  const fresh = next.find(w => old.indexOf(w) < 0);
  if (fresh == null) return false;
  const fwd = newCur > curWeek;
  curWeek = newCur;                       // 先改周次：下面生成的 now/today 要按新值算
  // 12 个组节点：3 条轨道 × 4 组
  const moved = [];
  tracks.forEach(track => {
    const gs = [...track.children];
    if (gs.length !== 4) return;
    const node = fwd ? gs[0] : gs[3];
    if (fwd) track.appendChild(node); else track.insertBefore(node, gs[0]);
    moved.push(node);
  });
  if (moved.length !== 3) return false;
  // 新填那一组
  moved[0].innerHTML = weekLabelHtml(fresh);
  moved[1].innerHTML = weekHeadHtml(fresh);
  moved[2].innerHTML = weekBodyHtml(fresh);
  // 可见的两组：周标签与星期的文本重刷（节点很小，重建看不出），格子只改 class
  tracks.forEach((track, ti) => {
    [...track.children].forEach((node, gi) => {
      const isMoved = node === moved[ti];
      if (ti < 2) {
        if (!isMoved) node.innerHTML = (ti === 0 ? weekLabelHtml(next[gi]) : weekHeadHtml(next[gi]));
      } else {
        const days = node.querySelectorAll('.kb-day');
        days.forEach((el, di) => el.classList.toggle('today', next[gi] === curWeek && grCtx.daySel[di] === grCtx.todayIdx));
      }
    });
  });
  g.style.setProperty('--slide-dur', '0ms');
  g.style.setProperty('--pos', '1');
  updateWeekBar(currentRows.filter(r => weekActive(r, curWeek)).length);
  renderRuler();
  return true;
}

/**
 * 双周要渲染的四周：窗口左边那周的前一周 … 窗口右边那周的后一周。
 * 一共 4 组，窗口只显示中间两组 —— 多出来的两组分别待在窗口左右两侧：
 *   · 下一周那一组已经画好了，往左滑就能显形，不需要重绘重放；
 *   · 前一组用于往回滑。
 * 超出 [1, maxWeek] 的周渲染成空组（weekActive 对它们恒为 false）。
 */
function duoGroups(w) {
  const a = duoWindowStart(w);
  return [a - 1, a, a + 1, a + 2];
}

/* 切周按钮在入场动画播完之前不响应 —— 动画没走完就切下一次，
   看起来就是动画被反复打断。这条只约束按钮：键盘方向键和点周刻度尺
   仍然是即时跳转（那是"跳"，本来就没有生成动画可言）。 */
const WEEK_LOCK_MS = 780;
let weekLockUntil = 0;
let pendingWeek = null;
let weekBtnHeld = true;
document.addEventListener('mouseup', () => { weekBtnHeld = false; });
// 按住不放时，等动画走完接着往下翻
setInterval(() => {
  if (!weekBtnHeld || pendingWeek === null) return;
  if (Date.now() < weekLockUntil) return;
  const w = pendingWeek;
  pendingWeek = null;
  goWeek(w, true);
}, 100);

/* 课表重建时给卡片加一段错峰淡入，否则翻周是"啪"地整块换掉，很生硬。
   首次渲染（原来还没画过）不加：那不是"切换"，是页面刚出来。
   每张卡上的 --i 是 renderGrid 生成的全局序号，直接当错峰延迟用。
   节奏参数（单张时长 / 步长 / 封顶）都在 CSS 里，这里只负责挂和摘。

   连续快切时不重放入场：上一段还没走完就又建了一次课表的话，这次直接落定、
   不加动画，免得动画被一次次从头打断（那样看起来像"手速把动画催快了"）。

   这里有两个不同的时间量，不要混成一个：
     · ENTER_REPLAY_MS 620ms —— 只决定"这次要不要播"。
       实测一段入场 400ms + 最后一张错峰 ≈ 604ms（10 张时最多 740ms）。
       曾把它设成 1100ms，多出的近 500ms 正好接近用户按"下一周"的间隔，
       于是每隔一次就被静默跳过（"1 次隔 1 次跳"）。取 620ms 只挡真正没走完的那段。
     · ENTER_SETTLE_MS 900ms —— 决定"什么时候摘类"。
       必须覆盖最坏情况（400 + 34×10 = 740ms），否则错峰靠后的卡片还没跑完
       类就被摘掉，会硬生生跳一下。 */
const ENTER_REPLAY_MS = 620;
const ENTER_SETTLE_MS = 900;
let enteringUntil = 0;
function playEntrance(grid) {
  const firstPaint = !grid.dataset.painted;
  grid.dataset.painted = '1';
  if (firstPaint) return;
  const now = Date.now();
  if (now < enteringUntil) {
    // 上一段入场还没结束：这次不播，直接落定（并清掉可能还挂着的类）
    grid.classList.remove('entering');
    return;
  }
  enteringUntil = now + ENTER_REPLAY_MS;
  grid.classList.add('entering');
  setTimeout(() => grid.classList.remove('entering'), ENTER_SETTLE_MS);
}

/* 阵列不可用时把表格放出来当降级。声明必须在 renderList 之前 ——
   let 有暂时性死区，写在后面会在首次渲染时抛错。 */
let arrayFallback = false;

function renderList(rows) {
  const src = rows || currentRows;
  const q = listQuery();
  const shown = q ? src.filter(r => rowMatches(r, q)) : src;
  let html = '';
  shown.forEach(r => {
    const jc = (r.start && r.end && r.end !== r.start) ? r.start + '-' + r.end : (r.start || '—');
    html += '<tr><td>' + dayLabel(r.day) + '</td><td>' + jc + '</td><td>' + esc(r.name) +
      '</td><td>' + esc(r.teacher) + '</td><td>' + esc(r.room) + '</td><td>' + esc(r.weeks) + '</td></tr>';
  });
  $('listBody').innerHTML = html;
  $('statCount').textContent = src.length ? src.length : '--';
  $('statTeachers').textContent = src.length ? new Set(src.map(r => r.teacher)).size : '--';
  const wkSet = new Set();
  src.forEach(r => String(r.weeks).split(/[,，;；]/).forEach(w => { const s = w.trim(); if (s) wkSet.add(s); }));
  $('statWeeks').textContent = wkSet.size || '--';
  const cnt = $('drawerCount');
  if (cnt) cnt.textContent = '共 ' + shown.length + ' 门' + (q && shown.length !== src.length ? ' / ' + src.length : '');
  const lb = $('listCount');
  if (lb) lb.textContent = src.length ? '共 ' + src.length + ' 门' : '清单';
  // 表格的行照旧在这里维护（导出 CSV 读的就是它），但**显不显示**改由外观设置决定，
  // 不再跟「阵列是否成功」挂钩 —— 见 setListView 与 app.css 的 .list-wrap。
}

/* ---------------------------------------------------- 档案阵列的画质档位 --
   三维阵列是这份界面里唯一的重负载。档位参数直接取移植过来的
   render-quality.js 的 qualityPresets，不在这里另造一套：
     performance  scale 80  DPR 1    阴影1024  AO关  景深关 透射0.5 各向异性4
     balanced     scale 100 DPR 1    阴影2048  AO关  景深关 透射1   各向异性16
     original     scale 100 DPR 1.5  阴影2048  AO32  景深100 透射1   各向异性16
     high         scale 125 DPR 2    SMAA      AO32  景深100 透射1   各向异性16
   另有上游的「超级性能模式」：直接跳过整条后处理链，并把阵列材质换成
   无折射／无清漆的快速版（scene.ts:1731 的 superPerformance 分支）。
   默认给 performance —— 原始档在集显上就是会卡。
   ------------------------------------------------------------------------- */
/* v2：默认档从「性能」改成「清晰」。
   键升版是必须的 —— 旧键里存着 v1 时期的 performance，
   而 applyArrayPerf() 每次都会写回，用户不主动改档就永远看不到新的默认值。 */
const ARRAY_QUALITY_KEY = 'kbmonitor.arrayQuality.v2';

/**
 * 默认档「清晰」。
 *
 * 上游的 performance 是拿分辨率换帧率的：渲染比例 80%、像素密度 1、关抗锯齿、
 * 透明材质半分辨率 —— 阵列远看没事，卡片上的编号与刻字就是糊的。
 * 这里保留它「不开 AO、不开景深」的省法（这两项才是真正的性能大头），
 * 只把分辨率与抗锯齿拉上去。实测（同一台机、1084×620 画布）：
 *
 *   scale 80  · 无AA · t0.5   60.7 fps   867×496
 *   scale 100 · SMAA · t0.5   47.5 fps  1084×620   ← 取这档
 *   scale 100 · SMAA · t1.0   36.0 fps  1084×620
 *   scale 125 · SMAA · t1.0   26.4 fps  1355×775
 *
 * 关键结论：**transmission 才是大头**，0.5→1.0 一项就吃掉 13 fps
 * （透明盖板的折射缓冲要按整个场景再渲一遍），而 SMAA 只吃 3 fps。
 * 所以清晰档选 scale 100 + SMAA、透射仍留 0.5：
 * 像素数比性能档多 56%，边缘还带抗锯齿，代价是 13 fps。
 *
 * 注意 renderDimensions 取 min(deviceRatio, pixelRatio)，1× 屏上 pixelRatio
 * 再高也不起作用，真正有效的是 scale —— 所以 scale 必须大于 100 才有超采样。
 */
const SHARP_PRESET = {
  scale: 100,
  pixelRatio: 1.5,
  antialias: 'smaa',
  shadows: 1024,
  aoSamples: 0,
  aoResolution: 0.5,
  depthOfField: 0,
  transmission: 0.5,
  anisotropy: 16
};

/** 只有这些档位是合法的；存坏了或存了旧值一律回退到默认清晰档。 */
const ARRAY_QUALITY_NAMES = ['sharp', 'performance', 'balanced', 'original', 'high'];

/** 档位对象从 bundle 里的 render-quality 取，保证与上游同源。 */
function arrayQualityPreset(name) {
  const presets = (window.RHINE && RHINE.qualityPresets) || null;
  if (name === 'sharp') return SHARP_PRESET;
  if (presets && presets[name]) return presets[name];
  // bundle 没透出时的兜底（数值与上游 qualityPresets 一致）
  const fallback = {
    sharp: SHARP_PRESET,
    performance: { scale: 80, pixelRatio: 1, antialias: 'off', shadows: 1024, aoSamples: 0, aoResolution: 0.5, depthOfField: 0, transmission: 0.5, anisotropy: 4 },
    balanced: { scale: 100, pixelRatio: 1, antialias: 'off', shadows: 2048, aoSamples: 0, aoResolution: 1, depthOfField: 0, transmission: 1, anisotropy: 16 },
    original: { scale: 100, pixelRatio: 1.5, antialias: 'off', shadows: 2048, aoSamples: 32, aoResolution: 1, depthOfField: 100, transmission: 1, anisotropy: 16 },
    high: { scale: 125, pixelRatio: 2, antialias: 'smaa', shadows: 4096, aoSamples: 32, aoResolution: 1, depthOfField: 100, transmission: 1, anisotropy: 16 }
  };
  return fallback[name] || SHARP_PRESET;
}

const arrayPerf = {
  quality: 'sharp',
  superPerformance: false
};

function loadArrayPerf() {
  // 磁盘文件由 applyStoredPrefs() 在启动时合并进来；这里先把 localStorage 镜像读上，
  // 免得接口缺失时完全没有兜底。
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY) || localStorage.getItem(ARRAY_QUALITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const v = (parsed && parsed.array) || parsed;   // 兼容旧格式
      if (v && typeof v === 'object') {
        // 校验档位名：非法值（含旧版本残留）一律回落，避免存到一个跑不动的档位上
        if (ARRAY_QUALITY_NAMES.indexOf(v.quality) >= 0) arrayPerf.quality = v.quality;
        arrayPerf.superPerformance = !!v.superPerformance;
      }
    }
  } catch (e) { /* 存储不可用就用默认 */ }
}

function saveArrayPerf() { saveUiPrefs(); }

const ARRAY_QUALITY_LABEL = {
  sharp: '清晰（scale 100% · SMAA · 无 AO/景深）',
  performance: '性能（scale 80% · DPR 1 · 无 AO/景深 · 低透射）',
  balanced: '均衡（scale 100% · DPR 1 · 无 AO/景深）',
  original: '原始（DPR 1.5 · AO 32 · 景深 100）',
  high: '高（scale 125% · DPR 2 · SMAA · 阴影 4096）'
};

/**
 * 把当前档位同步到阵列、按钮态与提示文字。
 * 档位没变就不动场景 —— 以前每次进课程清单都会调到这里，
 * 而它会清掉 resize 去重键、强制重建全部后处理缓冲，纯属白卡一下。
 */
let appliedArrayPerf = '';
function applyArrayPerf() {
  const key = arrayPerf.quality + '|' + arrayPerf.superPerformance;
  if (listArray.instance && key !== appliedArrayPerf) {
    listArray.instance.setPerformance({
      preset: arrayQualityPreset(arrayPerf.quality),
      superPerformance: arrayPerf.superPerformance
    });
  }
  appliedArrayPerf = key;
  document.querySelectorAll('[data-array-quality]').forEach(b => {
    b.classList.toggle('active', b.dataset.arrayQuality === arrayPerf.quality);
  });
  document.querySelectorAll('[data-array-super]').forEach(b => {
    b.classList.toggle('active', (b.dataset.arraySuper === 'on') === arrayPerf.superPerformance);
  });
  const hint = $('arrayQualityHint');
  if (hint) {
    hint.textContent = (ARRAY_QUALITY_LABEL[arrayPerf.quality] || arrayPerf.quality) +
      (arrayPerf.superPerformance ? ' · 超级性能：跳过全部后处理' : '');
  }
  saveArrayPerf();
}

document.querySelectorAll('[data-array-quality]').forEach(b => {
  b.addEventListener('click', () => {
    arrayPerf.quality = b.dataset.arrayQuality;
    applyArrayPerf();
  });
});
document.querySelectorAll('[data-array-super]').forEach(b => {
  b.addEventListener('click', () => {
    arrayPerf.superPerformance = b.dataset.arraySuper === 'on';
    applyArrayPerf();
  });
});

/* ============================== 课程清单 = 三维档案阵列 ======================
   课程清单这一栏用移植过来的 RhineLabUI 档案阵列展示：
     · 本周每天    = 阵列的一列（周一…周日）
     · 每天每门课  = 该列里的一份档案
     · 拖动 / 滚轮 / 方向键浏览；选中项显示在右侧的档案详情里
   阵列本体是 vendor/rhine.global.js 的 RHINE.RhineArray（移植自 src/scene.ts），
   这里只负责喂数据、把选中项写进详情、切周刷新、以及进出这一栏时的启停。
   ========================================================================= */

const listArray = {
  instance: null,
  ready: false,
  loading: false,
  index: 0,
  records: [],
  unavailable: false
};

/** 本週实际要上的课 —— 与课表网格同一套筛选，保证两边一致。 */
function listRows() {
  return currentRows.filter(r => weekActive(r, curWeek));
}

/** 课程 -> 阵列需要的档案形状（与 port-overrides/data.js 的 ArchiveRecord 对齐）。 */
function toArchiveRecords(rows) {
  const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return rows.map((r, i) => ({
    id: 'KB-' + String(i + 1).padStart(3, '0'),
    title: r.name || '未命名课程',
    en: r.room || '',
    department: r.teacher || '—',
    category: DAYS[Math.min(6, Math.max(0, (Number(r.day) || 1) - 1))],
    date: r.weeks || '',
    lead: r.teacher || '—',
    clearance: '已归档 · 可读取',
    raw: r
  }));
}

/** 把选中项写进右侧档案详情（字段与上游 .archive-callout 一一对应）。 */
function paintArchiveDetail(i) {
  const rec = listArray.records[i];
  const n = $('selectedNumber');
  if (n) n.textContent = String(i + 1).padStart(2, '0');
  const t = $('countTotal');
  if (t) t.textContent = String(listArray.records.length || 0).padStart(2, '0');
  const num = $('fileNumber');
  if (num) num.textContent = rec ? rec.id : '—';
  const cat = $('archiveCategory');
  if (cat) cat.textContent = rec ? rec.category : '课程清单';
  const name = $('fileSummaryName');
  if (name) name.textContent = rec ? rec.title : '本周没有课程';
  const meta = $('fileSummaryMeta');
  if (meta && rec) {
    const raw = rec.raw || {};
    const span = (raw.start && raw.end && raw.end !== raw.start)
      ? '第 ' + raw.start + '–' + raw.end + ' 节'
      : '第 ' + (raw.start || '—') + ' 节';
    meta.textContent = [span, raw.weeks, rec.department, rec.en].filter(Boolean).join(' · ');
  }
  // 刻度：当前列的份数
  const ticks = $('fileTicks');
  if (ticks) {
    let html = '';
    for (let k = 0; k < listArray.records.length; k++) {
      html += '<button type="button" class="' + (k === i ? 'selected' : '') +
        '" data-tick="' + k + '" title="' + esc(listArray.records[k].title) +
        '" aria-label="第 ' + (k + 1) + ' 份：' + esc(listArray.records[k].title) + '"></button>';
    }
    ticks.innerHTML = html;
  }
  const hint = $('archiveSource');
  if (hint) hint.textContent = 'INTERNAL DATABASE';
}

/** 选中第 i 份：同步阵列与右侧详情。fromScene 表示这次是阵列自己选的（用户点了卡片）。 */
function selectArchive(i, fromScene, cell) {
  const n = listArray.records.length;
  if (!n) return;
  i = Number(i);
  if (!Number.isInteger(i)) return;      // 阵列可能给出 undefined（空列），别往下传
  /* 到边绕回另一端，而不是停在原地。
     三维阵列本身就是无限循环的 —— 上游 archive-loop.ts 的 nearestOccurrence 注释：
     「Directional moves use adjacent cells instead, so the last-to-first transition
     never reverses」。select() 拿到序号后会取离当前位置最近的同内容那一份，
     所以从最后一份到第一份是继续沿同方向绕过去，不会倒着飞回来。
     原先这里钳在 [0, n-1]：在最后一份按 ↓ 会算成 select(n-1)，等于原地重选同一份，
     看着就是「箭头到边了没反应」，把场景自带的循环白白废掉了。 */
  i = ((i % n) + n) % n;
  listArray.index = i;
  paintArchiveDetail(i);
  /* 无论来源都要告诉三维场景。
     早先这里写着 `if (!fromScene) ... select(i)`，于是从阵列点卡片时反而跳过了同步 ——
     回调只改了右侧文字，被点的那张卡不抬起、不走波浪，看着就像「点了没反应」。
     上游 main.ts:992 的 onSelect 回调里正是要回传 select(i, {cell}) 的。
     cell 也要一并传：同内容在循环阵列里有多份，不指定就抬错了那一张。 */
  if (listArray.instance) listArray.instance.select(i, cell ? { cell } : undefined);
}

/** 从检视态退回阵列（卡片落下、拖动恢复为平移）。 */
function exitArchiveDetail() {
  if (!listArray.instance || !listArray.instance.detail) return;
  listArray.instance.setDetail(false);
}

/** 建阵列实例（首次进入与空闲预热共用同一份参数，避免两处走偏）。 */
function makeListArray() {
  return new RHINE.RhineArray($('arrayStage'), {
    reduced: () => document.documentElement.classList.contains('reduce-motion'),
    // 用当前画质档位建场景，避免先按最重的原始档建好再立刻改
    quality: arrayQualityPreset(arrayPerf.quality),
    superPerformance: arrayPerf.superPerformance,
    onSelect: (fileIndex, cell) => selectArchive(fileIndex, true, cell),
    onError: (e) => {
      // 表格已改成外观设置里的手动开关（默认关），所以这里要顺带告诉用户去哪打开，
      // 否则阵列失败时清单页会是一片空白，找不到出路。
      toast('❌ 阵列渲染出错：' + e.message + '（可在「外观 › 清单表格」改用表格查看）', 'err');
      arrayFallback = true;
      markListArray(false);
      renderList();
    }
  });
}

/** 阵列的显示/隐藏与占位切换。 */
function markListArray(on) {
  const stage = $('listStage');
  if (stage) stage.dataset.array = on ? 'on' : 'off';
  const scene = $('arrayStage');
  if (scene) scene.classList.toggle('ready', !!on);
  const empty = $('listEmpty');
  if (empty) empty.hidden = !!on;
}

/** 启动阵列（进入课程清单栏时调用）。 */
async function startListArray() {
  const stage = $('listStage');
  if (!stage || listArray.ready) return;
  // 表格视图（listView=table）占着整块面板，阵列没有容身之处，直接跳过。
  // split 只是压矮，阵列照常启动。见 setListView。
  if (lookPrefs.listView === 'table') return;

  if (!window.RHINE || !RHINE.RhineArray) {
    arrayFallback = true;
    listArray.unavailable = true;
    markListArray(false);
    renderList();
    toast('❌ 阵列运行时未加载（vendor/rhine.global.js 缺失），已改用表格显示', 'err');
    return;
  }

  const rows = listRows();
  listArray.records = toArchiveRecords(rows);
  if (!listArray.instance) listArray.instance = makeListArray();
  listArray.instance.setCourses(rows);
  listArray.index = 0;
  paintArchiveDetail(0);
  try {
    await listArray.instance.start();
    listArray.ready = true;
    markListArray(true);
    // 场景建好后把画质落到按钮态与提示上（首次进入时档位还没同步过）
    applyArrayPerf();
  } catch (e) {
    listArray.unavailable = true;
    arrayFallback = true;
    markListArray(false);
    renderList();
    toast('❌ 阵列启动失败：' + e.message, 'err');
  }
}

/**
 * 空闲预热。
 *
 * 建场景是一次性的重活（解析内联 GLB、传贴图、编译着色器），实测首次进入时
 * 会连续卡掉七八帧、最差一帧 230ms —— 用户的感觉就是「每次进列表都卡」。
 * 这里趁启动后的空闲先把场景建好跑几帧，真进列表时直接复用。
 *
 * 关键点：容器此刻还带着 display:none（非激活的 .tab），尺寸是 0，
 * 直接建场景会让渲染尺寸被压到 1×1、相机 aspect 变成 0/0。
 * 所以临时挂 .warming：保持不可见，但按容器真实大小参与布局。
 */
async function warmListArray() {
  if (listArray.instance || listArray.ready) return;
  if (!window.RHINE || !RHINE.RhineArray) return;
  /* 表格档下 .stage-wrap 是 display:none，容器 0×0，拿零尺寸建场景会
     刷一屏 GL_INVALID_FRAMEBUFFER_OPERATION、相机 aspect 也会算坏。
     但预热是要留着的（进列表时最贵的那次一次性成本靠它提前付掉），
     所以不跳过，而是让舞台在预热期间按真实尺寸参与布局、用 visibility 藏住 ——
     见 app.css 的 .tab.warming .stage-wrap。 */
  const tab = $('tab-list');
  if (!tab || !$('arrayStage')) return;
  tab.classList.add('warming');
  try {
    listArray.instance = makeListArray();
    listArray.records = toArchiveRecords(listRows());
    listArray.instance.setCourses(listRows());
    await listArray.instance.warmup();
  } catch (e) {
    // 预热只是省时间，失败就走正常首次构建，不打扰用户
    listArray.instance = null;
  } finally {
    tab.classList.remove('warming');
  }
}

/* 离开课程清单栏：先退出检视态，再停掉逐帧渲染（阵列每帧要跑阴影与后处理）。 */
function stopListArray() {
  if (listArray.instance) {
    listArray.instance.setDetail(false);
    listArray.instance.stop();
  }
  listArray.ready = false;
}

/** 切周 / 重新查询后刷新阵列内容（只在阵列已就绪时有意义）。 */
function syncListArray() {
  if (!listArray.ready || !listArray.instance) return;
  const rows = listRows();
  listArray.records = toArchiveRecords(rows);
  listArray.instance.setCourses(rows);
  listArray.index = 0;
  paintArchiveDetail(0);
}

/* 事件绑定 */
if ($('prevFile')) $('prevFile').addEventListener('click', () => selectArchive(listArray.index - 1));
if ($('nextFile')) $('nextFile').addEventListener('click', () => selectArchive(listArray.index + 1));
if ($('fileTicks')) {
  $('fileTicks').addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-tick]');
    if (b) selectArchive(Number(b.dataset.tick));
  });
}
/* 进检视 = 上游的 openFile()（main.ts:471），它绑在 [data-action="open"] 上，
   而那个属性同时挂在 FILE NUMBER 标题和 ACCESS FILE 两个元素上。
   点阵列上那张卡片只负责选中 —— 选中才会放波浪，
   而 setMode("detail") 里会把 pendingPulse 清掉，点卡片直接进详情等于把波浪掐了。 */
function openArchiveDetail() {
  if (!listArray.instance || !listArray.ready) return;
  listArray.instance.setDetail(true);
}
['readFile', 'fileTitle'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('click', openArchiveDetail);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArchiveDetail(); }
  });
});
/* 清单页的键盘快捷键：↑/↓ 换一份档案，Enter 进检视。
   只在「课程清单」栏激活、且不在输入控件里时接管 —— 否则会和设置页的输入框、
   学年列表框的上下键打架。阵列正在放入场动画时也不接管（那时候画面还没交回浏览态）。 */
function listKeyTarget(e) {
  if (!listArray.ready || !listArray.instance) return false;
  const tab = document.getElementById('tab-list');
  if (!tab || !tab.classList.contains('active')) return false;
  const t = e.target || document.activeElement;
  const tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (t && t.isContentEditable) return false;
  return true;
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (!listKeyTarget(e)) return;
  if (listArray.instance.detail) return;      // 检视态里上下键留给场景自己
  e.preventDefault();
  selectArchive(listArray.index + (e.key === 'ArrowDown' ? 1 : -1));
});
/* 上游在 archive 模式下按 Enter 也是 openFile（main.ts:875）。
   焦点正落在 ACCESS FILE / FILE NUMBER 上时交给它们自己的处理，避免进两次。 */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!listKeyTarget(e)) return;
  if (listArray.instance.detail) return;
  const ae = document.activeElement;
  if (ae && (ae.id === 'readFile' || ae.id === 'fileTitle')) return;
  openArchiveDetail();
});
/* ---------------- 手动课表 / Excel 导入 ----------------
   导入或手编之后以这份课表为准（cfgObj.use_manual），启动时不再自动联网查询，
   否则一联网就把用户自己弄的课表盖掉了。点「查看该学期」会重新以网络结果为准。 */
function setManualState(on) {
  const bar = $('termNow');
  if (bar) bar.dataset.manual = on ? '1' : '0';
  const btn = $('editBtn');
  if (btn) btn.title = on ? '当前是手动课表，点这里继续编辑' : '手动增删改课程';
}
function isManual() { return !!(cfgObj && cfgObj.use_manual); }

async function persistManual(rows) {
  cfgObj = cfgObj || {};
  if (rows) {
    cfgObj.manual_schedule = rows;
    cfgObj.use_manual = true;
  } else {
    cfgObj.use_manual = false;
  }
  setManualState(!!rows);
  try { await api.save_config(cfgObj); }
  catch (e) { toast('课表已生效，但写入配置失败：' + e.message, 'err'); }
}

function adoptManualRows(rows) {
  applyRows(rows);
  saveScheduleSnapshot();
}

async function importXlsx() {
  if (!api) return;
  const pick = await api.pick_schedule_file();
  if (!pick || !pick.ok) {
    if (pick && pick.cancel) return;
    toast('❌ 打开文件失败：' + ((pick && pick.error) || '未知错误'), 'err');
    return;
  }
  setPill('导入中', 'running');
  const r = await api.import_schedule_xlsx(pick.path);
  if (!r || !r.ok) {
    setPill('空闲', 'idle');
    toast('❌ ' + ((r && r.error) || '导入失败'), 'err');
    if (r && r.grid) console.warn('导入未识别，表头前几行：', r.grid);
    return;
  }
  adoptManualRows(r.rows);
  await persistManual(r.rows);
  setPill('空闲', 'idle');
  $('termNow').textContent = 'Excel 导入 · ' + r.rows.length + ' 门';
  toast('✅ 已导入 ' + r.rows.length + ' 门课（识别到：' + (r.columns || []).join('/') + '）' +
        (r.skipped ? '，跳过 ' + r.skipped + ' 行无法解析的' : ''), 'ok');
}

/* ---------- 编辑器 ---------- */
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
function editRowHtml(r) {
  const v = (x) => esc(x == null ? '' : String(x));
  return '<tr>' +
    '<td class="c-idx"></td>' +
    '<td><input class="e-day" type="text" value="' + v(r ? r.day : '') + '" placeholder="1"></td>' +
    '<td class="e-sec"><input class="e-start" type="text" value="' + v(r ? r.start : '') + '" placeholder="1">' +
      '<i>–</i><input class="e-end" type="text" value="' + v(r ? r.end : '') + '" placeholder="2"></td>' +
    '<td><input class="e-name" type="text" value="' + v(r ? r.name : '') + '" placeholder="课程名称"></td>' +
    '<td><input class="e-teacher" type="text" value="' + v(r ? r.teacher : '') + '"></td>' +
    '<td><input class="e-room" type="text" value="' + v(r ? r.room : '') + '"></td>' +
    '<td><input class="e-weeks" type="text" value="' + v(r ? r.weeks : '') + '" placeholder="1-16"></td>' +
    '<td class="c-x"><button class="row-x" type="button" title="删除这一行">×</button></td>' +
  '</tr>';
}
function renumberEditRows() {
  const rows = [...$('editBody').querySelectorAll('tr')];
  rows.forEach((tr, i) => { tr.querySelector('.c-idx').textContent = String(i + 1); });
  $('editCount').textContent = rows.length + ' 门';
  if (!rows.length) $('editBody').innerHTML = editRowHtml(null);
}
function openEdit() {
  $('editBody').innerHTML = '';
  const src = (currentRows.length ? currentRows : []);
  $('editSource').textContent = isManual() ? '当前：手动课表' : (src.length ? '当前：查询结果（保存后转为手动课表）' : '');
  if (src.length) src.forEach(r => { $('editBody').insertAdjacentHTML('beforeend', editRowHtml(r)); });
  else $('editBody').innerHTML = editRowHtml(null);
  renumberEditRows();
  $('editMask').classList.add('show');
}
function readEditRows() {
  const out = [];
  $('editBody').querySelectorAll('tr').forEach(tr => {
    const g = (c) => (tr.querySelector(c) || {}).value || '';
    const name = g('.e-name').trim();
    if (!name) return;
    const day = parseDayText(g('.e-day'));
    const start = Number((g('.e-start').match(/\d+/) || [0])[0]);
    const end = Number((g('.e-end').match(/\d+/) || [0])[0]) || start;
    if (!day || !start) return;
    out.push({
      name, teacher: g('.e-teacher').trim(), room: g('.e-room').trim(),
      day, start, end: Math.max(start, end), weeks: g('.e-weeks').replace(/周/g, '').trim(),
    });
  });
  return out;
}
/** 星期接受 1–7 / 周一 / 星期一 / 一 */
function parseDayText(text) {
  const s = String(text || '').trim();
  if (/^[1-7]$/.test(s)) return Number(s);
  const table = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  for (const k in table) if (s.indexOf(k) >= 0) return table[k];
  return 0;
}
async function saveEdit() {
  const rows = readEditRows();
  if (!rows.length) { toast('一行有效的课都没有（课程名称 + 星期 + 节次是必填）', 'err'); return; }
  adoptManualRows(rows);
  await persistManual(rows);
  $('termNow').textContent = '手动课表 · ' + rows.length + ' 门';
  $('editMask').classList.remove('show');
  toast('✅ 已保存为当前课表（' + rows.length + ' 门），下次启动仍然是它', 'ok');
}
function closeEdit() { $('editMask').classList.remove('show'); }

if ($('importBtn')) $('importBtn').addEventListener('click', importXlsx);
if ($('editBtn')) $('editBtn').addEventListener('click', openEdit);
if ($('editAdd')) $('editAdd').addEventListener('click', () => {
  $('editBody').insertAdjacentHTML('beforeend', editRowHtml(null));
  renumberEditRows();
});
if ($('editFill')) $('editFill').addEventListener('click', () => {
  $('editBody').innerHTML = '';
  (currentRows.length ? currentRows : [null]).forEach(r => {
    $('editBody').insertAdjacentHTML('beforeend', editRowHtml(r));
  });
  renumberEditRows();
  toast('已载入当前显示的 ' + currentRows.length + ' 门课，可直接改', 'ok');
});
if ($('editBody')) $('editBody').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.row-x');
  if (!b) return;
  b.closest('tr').remove();
  renumberEditRows();
});
if ($('editSave')) $('editSave').addEventListener('click', saveEdit);
if ($('editCancel')) $('editCancel').addEventListener('click', closeEdit);
if ($('editClose')) $('editClose').addEventListener('click', closeEdit);
if ($('editMask')) $('editMask').addEventListener('click', (e) => {
  if (e.target === $('editMask')) closeEdit();
});

/* 窗口尺寸变化：合并到下一帧再应用一次。
   拖动/最大化窗口时浏览器会在一帧内连发多个 resize，逐个转发给阵列等于让
   三维侧反复重建渲染缓冲，界面就跟着卡。这里只保留每帧一次，具体尺寸是否
   真的变了由阵列宿主自己判断（rhine-scene-host.js 的 resize）。 */
let arrayResizeRaf = 0;
window.addEventListener('resize', () => {
  if (arrayResizeRaf) return;
  arrayResizeRaf = requestAnimationFrame(() => {
    arrayResizeRaf = 0;
    if (listArray.instance && listArray.ready) listArray.instance.resize();
  });
});

/* 检视态的退出：Esc，或点在阵列的空白处（没打到卡片）。
   场景只在打到卡片时回调 onSelect，空白处的点击它不吭声，所以这里自己判定。 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exitArchiveDetail();
});
if ($('arrayStage')) {
  $('arrayStage').addEventListener('click', (e) => {
    if (!listArray.instance || !listArray.instance.detail) return;
    const scene = listArray.instance.scene;
    if (!scene || typeof scene.pickCell !== 'function') return;
    if (!scene.pickCell(e.clientX, e.clientY)) exitArchiveDetail();
  });
}

/* 读入上次选的档位，并把按钮态点亮（场景还没建也能先显示） */
loadArrayPerf();
applyArrayPerf();

/* 调试出口：性能探针与自动化需要拿到阵列实例与画质对象。
   只挂在 window 上，不参与任何产品逻辑。 */
window.__kbListArray = listArray;
window.__kbArrayPerf = arrayPerf;
window.__kbArrayQualityPreset = arrayQualityPreset;

/* ---------------- 周次解析 / 周导航 / 刻度尺 / 日历 ---------------- */
let curWeek = 1;
let termStart = null;   // 第 1 周周一（自定义日历设定）
let maxWeek = 20;
let slotMap = {};
let calMonth = null;

function parseWeeks(str) {
  // 返回 null 表示「每周都有」；否则返回该课程生效周次集合
  const s = String(str || '').trim();
  if (!s) return null;
  const oddOnly = /单/.test(s), evenOnly = /双/.test(s);
  const set = new Set();
  const re = /(\d{1,2})\s*(?:[-–—~至到]\s*(\d{1,2}))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
      if (w >= 1 && w <= 30) set.add(w);
    }
  }
  if (!set.size) return null;
  if (oddOnly || evenOnly) {
    Array.from(set).forEach(w => {
      if ((oddOnly && w % 2 === 0) || (evenOnly && w % 2 === 1)) set.delete(w);
    });
  }
  return set;
}
function weekActive(r, w) {
  const set = parseWeeks(r.weeks);
  return set ? set.has(w) : true;
}
function computeMaxWeek(rows) {
  let mx = 16;
  rows.forEach(r => {
    const set = parseWeeks(r.weeks);
    if (set) set.forEach(w => { if (w > mx) mx = w; });
  });
  return mx;
}
function toISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
function weekDateRange(w) {
  if (!termStart) return '';
  const s = new Date(termStart.getTime() + (w - 1) * 7 * 86400000);
  const e = new Date(s.getTime() + 6 * 86400000);
  return (s.getMonth() + 1) + '/' + s.getDate() + ' ~ ' + (e.getMonth() + 1) + '/' + e.getDate();
}
function dayDateLabel(dayKey) {
  // 星期头上的日期数字：需要已设定「第 1 周周一」，且不是「其它」列
  if (!termStart || !(dayKey >= 1 && dayKey <= 7)) return '';
  const d = new Date(termStart.getTime() + ((curWeek - 1) * 7 + (dayKey - 1)) * 86400000);
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function weekOfDate(d) {
  if (!termStart) return null;
  const diff = Math.floor((d - termStart) / 86400000);
  if (diff < 0) return null;
  return Math.floor(diff / 7) + 1;
}
function updateWeekBar(n) {
  $('weekLabel').textContent = '第 ' + curWeek + ' 周';
  $('weekDate').textContent = weekDateRange(curWeek);
  $('weekCount').textContent = (n === undefined ? '' : '本周 ' + n + ' 条课程');
}
function renderRuler() {
  // 周刻度尺：每格一周，柱高 = 该周课程数量，点柱跳转；列宽与课表日列对齐
  const box = $('ruler');
  if (!box) return;
  const perWeek = new Array(maxWeek + 1).fill(0);
  currentRows.forEach(r => {
    const set = parseWeeks(r.weeks);
    if (set) set.forEach(w => { if (w <= maxWeek) perWeek[w] += 1; });
    else for (let w = 1; w <= maxWeek; w++) perWeek[w] += 1;
  });
  let peak = 1;
  for (let w = 1; w <= maxWeek; w++) peak = Math.max(peak, perWeek[w]);
  const corner = WEEK_HEADS.map(n => '<div class="ruler-head">' + n + '</div>').join('');
  let cols = '';
  for (let w = 1; w <= maxWeek; w++) {
    const n = perWeek[w];
    const h = Math.round(Math.max(n ? 4 : 0, (n / peak) * 15));
    cols += '<button type="button" class="ruler-col' + (w === curWeek ? ' cur' : '') + (n ? '' : ' no') +
      '" data-week="' + w + '" title="第 ' + w + ' 周 · ' + n + ' 条课程" aria-label="跳到第 ' + w + ' 周">' +
      '<span class="n">' + w + '</span>' +
      '<span class="ruler-track"><span class="ruler-fill" style="height:' + h + 'px"></span></span>' +
      '</button>';
  }
  box.innerHTML = '<div class="ruler-corner">' + corner + '</div>' +
    '<div class="ruler-cells">' + cols + '</div>';
}
function goWeek(w, silent) {
  if (!(w >= 1) || w > maxWeek) return;
  const dir = w >= curWeek ? 'fwd' : 'back';
  /* 双周并排：走滑动动画 —— 两条轨道一起平移出去，滑完再换成新的一对周。
     只翻一格才滑（跳周、点刻度尺那种是"跳"，滑过去反而慢）。 */
  if (lookPrefs.layout === 'duo' && Math.abs(w - curWeek) === 1) {
    if (slideWeekTo(w > curWeek ? 1 : -1, w)) {
      syncListArray();
      if (!silent) toast('已跳转到第 ' + w + ' 周');
      return;
    }
  }
  curWeek = w;
  renderGrid(currentRows);
  playWeekFx(dir);
  syncListArray();
  if (!silent) toast('已跳转到第 ' + w + ' 周');
}

/* 入场动画没播完之前，切周按钮不响应。
   被挡下来的请求会记在 pendingWeek 里：如果用户一直按着按钮，
   等动画走完就接着往下翻（按住连续翻周）；松手就丢掉，不做延迟追赶。 */
function isWeekLocked() { return Date.now() < weekLockUntil; }
function requestWeek(w) {
  if (w < 1 || w > maxWeek) {
    toast(w < 1 ? '已经是第 1 周' : '已经是第 ' + maxWeek + ' 周（最后一周）');
    return;
  }
  if (isWeekLocked()) { pendingWeek = w; return; }
  pendingWeek = null;
  goWeek(w, true);
}

/* 切周时给按钮和中间的"第 N 周"一点反馈：
     · 方向对应的那个箭头朝切换方向推一下（往回翻往左、往前翻往右）；
     · "第 N 周 / 日期 / 本周条数"按同方向滑入。
   按钮的按压感走 CSS 的 :active，不需要 JS。 */
function playWeekFx(dir) {
  const btn = $(dir === 'back' ? 'prevWeek' : 'nextWeek');
  if (btn && btn.classList) {
    const cls = dir === 'back' ? 'wk-nudge-back' : 'wk-nudge';
    // 先摘再挂，连着点同一侧时动画才会重新播
    btn.classList.remove('wk-nudge', 'wk-nudge-back');
    void btn.offsetWidth;
    btn.classList.add(cls);
    setTimeout(() => btn.classList.remove(cls), 400);
    // 按下 → 回弹：:active 只管按住那一段，松开后的过冲要靠这段动画
    btn.classList.remove('wk-push');
    void btn.offsetWidth;
    btn.classList.add('wk-push');
    setTimeout(() => btn.classList.remove('wk-push'), 340);
  }
  const now = document.querySelector('.wk-now');
  if (now && now.classList) {
    now.classList.remove('fx-fwd', 'fx-back');
    void now.offsetWidth;
    now.classList.add(dir === 'back' ? 'fx-back' : 'fx-fwd');
    setTimeout(() => now.classList.remove('fx-fwd', 'fx-back'), 320);
  }
}

/* 课表每次重绘都会重建全部 .blk，而 3D 跟手倾斜缓存着它们的矩形。
   这里留两个失效钩子，由倾斜那一段赋值，见下方 invalidateRects / resetBlur。 */
let invalidateRects = null;
let resetBlur = null;
function openSlot(key) {
  const list = slotMap[key] || [];
  if (!list.length) return;
  /* 键的格式随布局变：
       duo       周_天_节   （同一天同一节在两周里各有一份，必须带周次才不撞）
       original  天_节
     两种都认，取最后两段当「天_节」。 */
  const parts = key.split('_');
  const hasWeek = parts.length >= 3;
  const week = hasWeek ? parts[0] : null;
  const d = hasWeek ? parts[1] : parts[0];
  const p = hasWeek ? parts[2] : parts[1];
  $('slotTitle').textContent = (week ? '第 ' + week + ' 周 · ' : '') +
    (d === '8' ? '其它' : WEEKS[Number(d) - 1]) +
    ' 第 ' + p + ' 节 · 共 ' + list.length + ' 门课';
  // 课表这里保持原版：纯文字列表，不做三维牌（用户明确不要课表侧的 3D 检视）
  $('slotBody').innerHTML = list.map(r => {
    const meta = [r.teacher, r.room, r.weeks, (r.start + '-' + r.end + ' 节')].filter(Boolean).join(' · ');
    return '<div class="slot-item"><div class="t">' + esc(r.name) + '</div>' +
      '<div class="m">' + esc(meta) + '</div></div>';
  }).join('');
  if (modalReset) modalReset();
  $('slotMask').classList.add('show');
}
function openCal() {
  if (!api) return;
  $('startDate').value = termStart ? toISO(termStart) : '';
  const base = termStart || new Date();
  calMonth = new Date(base.getFullYear(), base.getMonth(), 1);
  renderCal();
  $('calMask').classList.add('show');
}
function renderCal() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('calMonth').textContent = y + ' 年 ' + (m + 1) + ' 月';
  const startPad = (new Date(y, m, 1).getDay() + 6) % 7;   // 周一为一周起点
  const days = new Date(y, m + 1, 0).getDate();
  const todayIso = toISO(new Date());
  let html = ['一', '二', '三', '四', '五', '六', '日']
    .map(w => '<div class="cal-cell head">' + w + '</div>').join('');
  for (let i = 0; i < startPad; i++) html += '<div class="cal-cell mute"></div>';
  for (let d = 1; d <= days; d++) {
    const dt = new Date(y, m, d);
    const iso = toISO(dt);
    const wk = weekOfDate(dt);
    const cls = 'cal-cell day' + (iso === todayIso ? ' today' : '') + (wk === curWeek ? ' inweek' : '');
    html += '<div class="' + cls + '" data-date="' + iso + '">' + d + '</div>';
  }
  $('calGrid').innerHTML = html;
}

/* ---------------- 课程清单 ---------------- */
/* 清单原来是个弹出抽屉，现在独立成左侧栏的一页（#tab-list）。
   这里不再需要开合，只在切进来时重画一次。 */
function listQuery() {
  const el = $('listSearch');
  return el && el.value ? String(el.value).trim().toLowerCase() : '';
}
function rowMatches(r, q) {
  return [r.name, r.teacher, r.room, r.weeks, dayLabel(r.day)]
    .some(v => String(v == null ? '' : v).toLowerCase().indexOf(q) >= 0);
}

/** 按钮上的学年显示要跟着 #selYear.value 走。
    两处会程序化改这个值（保存配置后、恢复上次快照时），都要调一次。 */
function syncYearLabel() {
  const ys = $('selYear'), btn = $('yearBtn');
  if (!ys || !btn) return;
  btn.textContent = ys.value || '—';
}
/** 展开时把选中项滚到第 3 行附近 —— 原生的 size>1 select 只保证「在视窗内」，
    最上面的年份会贴在顶边，看不出上下还有内容。 */
function scrollYearToSelected() {
  const ys = $('selYear');
  if (!ys || !ys.options.length) return;
  const rows = ys.scrollHeight / ys.options.length;
  const want = ys.selectedIndex * rows - rows * 2;
  ys.scrollTop = Math.max(0, Math.min(ys.scrollHeight - ys.clientHeight, want));
}
function closeYearPick() {
  const pick = $('yearPick'), btn = $('yearBtn');
  if (pick) pick.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
(function bindYearPick() {
  const pick = $('yearPick'), btn = $('yearBtn'), ys = $('selYear');
  if (!pick || !btn || !ys) return;
  btn.addEventListener('click', () => {
    const open = !pick.classList.contains('open');
    pick.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) { scrollYearToSelected(); ys.focus(); }
  });
  // 列表框里点一条就是选定：更新按钮文字后收起
  ys.addEventListener('change', () => { syncYearLabel(); closeYearPick(); });
  ys.addEventListener('blur', () => { setTimeout(closeYearPick, 120); });
  document.addEventListener('click', (e) => {
    if (!pick.contains(e.target)) closeYearPick();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeYearPick();
  });
})();

/* ---------------- 动作 ---------------- */
let watchTerm = null;
async function initTermBar() {
  if (!api) return;
  const to = await api.get_term_options();
  watchTerm = to.watch;
  const ys = $('selYear'), ss = $('selSem');
  (to.years || []).forEach(y => {
    const o = document.createElement('option');
    o.value = y;
    o.textContent = y;
    ys.appendChild(o);
  });
  for (const code of ['3', '12', '16']) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = XQM[code] || code;
    ss.appendChild(o);
  }
  if (to.watch) {
    ys.value = String(to.watch[0]);
    ss.value = String(to.watch[1]);
  }
  syncYearLabel();
}

function applyRows(rows) {
  currentRows = rows || [];
  maxWeek = Math.max(1, computeMaxWeek(currentRows));
  if (termStart) {
    const wkNow = weekOfDate(new Date());
    if (wkNow && wkNow >= 1 && wkNow <= maxWeek) curWeek = wkNow;
  }
  if (curWeek > maxWeek) curWeek = maxWeek;
  if (curWeek < 1) curWeek = 1;
  renderGrid(currentRows);
  renderList(currentRows);
  // 新数据到手：清单阵列若已就绪，一并换成同一周的课程
  syncListArray();
  saveScheduleSnapshot();
}

/* ---------- 课表快照：让「上次看到的课表」活到下一次启动 ----------
   存在 exe 同目录的 schedule_cache.json（见 app.py 的 save_schedule_cache）。
   原先启动时若最近发生过网络异常（后端 net_error_recent），init() 会跳过
   自动查询并把课表清空重绘 —— 用户看到的就是「课表突然没了」，还以为数据丢了。
   这里把每次查询成功的课表和当时的学期/周次一起存下来，启动先摆上快照，
   再决定要不要刷新；刷新失败也不会把已经显示的课表清掉。 */
const SNAPSHOT_KEY = 'kbmonitor.schedule.v1';
let schedSaveTimer = 0;
function saveScheduleSnapshot() {
  if (!currentRows.length) return;
  const snap = {
    rows: currentRows,
    year: $('selYear') ? $('selYear').value : '',
    sem: $('selSem') ? $('selSem').value : '',
    week: curWeek,
    at: Date.now(),
  };
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) { /* 只是镜像 */ }
  if (!api || typeof api.save_schedule_cache !== 'function') return;
  clearTimeout(schedSaveTimer);
  schedSaveTimer = setTimeout(() => {
    try { Promise.resolve(api.save_schedule_cache(snap)).catch(() => {}); } catch (e) { /* 忽略 */ }
  }, 400);
}
function loadScheduleSnapshot() {
  // 磁盘优先，其次 localStorage 镜像
  if (scheduleDisk && Array.isArray(scheduleDisk.rows) && scheduleDisk.rows.length) return scheduleDisk;
  try {
    const v = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
    if (v && Array.isArray(v.rows) && v.rows.length) return v;
  } catch (e) { /* 损坏就当没有 */ }
  return null;
}

async function viewQuery(silent) {
  if (!api) return;
  const xnm = $('selYear').value, xqm = $('selSem').value;
  setPill('查询中', 'running');
  try {
    const r = await api.view_term(xnm, xqm);
    if (r.ok) {
      applyRows(r.rows || []);
      // 联网结果为准：手动课表让位（否则下次启动又会用手动那份盖回来）
      if (cfgObj && cfgObj.use_manual) await persistManual(null);
      const lbl = xnm + ' ' + (XQM[xqm] || '第' + xqm + '学期');
      $('termNow').textContent = lbl +
        (currentRows.length ? ' · ' + currentRows.length + ' 门' : ' · 暂无');
      if (!silent) {
        if (currentRows.length) toast('✅ ' + lbl + '：共 ' + currentRows.length + ' 门课', 'ok');
        else {
          const watching = watchTerm && String(watchTerm[0]) === String(xnm) && String(watchTerm[1]) === String(xqm);
          toast('ℹ️ ' + lbl + '：暂无课表数据' +
            (watching ? '（该学期未开放，监控中：一开放立即微信通知你）' : '（可能未开放或无排课）'));
        }
      }
    } else {
      toast('❌ ' + (r.error || '查询失败'), 'err');
    }
  } catch (e) { toast('❌ ' + e, 'err'); }
  setPill('空闲', 'idle');
}
async function fullWorkflowTest() {
  if (!api) return;
  setPill('完整流程执行中…', 'running');
  toast('正在完整流程：登录 → 查询课表 → 微信发送现状…');
  try {
    const r = await api.run_check(true);
    if (r.ok) toast('✅ 流程完成，微信已收到现状消息', 'ok');
    else toast('❌ ' + (r.error || '流程失败，详见日志页'), 'err');
  } catch (e) { toast('❌ ' + e, 'err'); }
  setPill('空闲', 'idle');
  await refreshStatus();
}
async function previewPush() {
  if (!api) return;
  toast('正在发送课表样式预览…');
  try {
    const r = await api.preview_push();
    toast(r.ok ? '✅ 预览消息已发送，去微信看看通知样式' : '❌ ' + (r.error || '发送失败'), r.ok ? 'ok' : 'err');
  } catch (e) { toast('❌ ' + e, 'err'); }
}

/* ---------- 周导航 / 刻度尺 / 弹窗 / 抽屉 / 日历 ---------- */
$('refreshBtn').addEventListener('click', () => viewQuery(false));
$('viewBtn').addEventListener('click', () => viewQuery(false));
/* 顶栏两个弹出层（外观与主题 / 更多操作）：同一时刻只开一个，点外部或 Esc 关闭 */
const POPS = [['lookPop', 'lookBtn'], ['morePop', 'moreBtn']];
function togglePop(id, force) {
  POPS.forEach(pair => {
    const pop = $(pair[0]);
    if (!pop) return;
    const on = pair[0] === id
      ? (force === undefined ? !pop.classList.contains('show') : !!force)
      : false;
    pop.classList.toggle('show', on);
    const btn = $(pair[1]);
    if (btn) {
      btn.setAttribute('aria-expanded', String(on));
      btn.classList.toggle('active', on);
    }
  });
}
POPS.forEach(pair => {
  const btn = $(pair[1]);
  if (btn) btn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePop(pair[0]); });
  const pop = $(pair[0]);
  if (pop) pop.addEventListener('click', (ev) => ev.stopPropagation());
});
document.addEventListener('click', () => togglePop(''));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') togglePop(''); });

/* 特效开关：毛玻璃与悬浮漂移 */
const FROST_OK = (function () {
  try { return CSS.supports('backdrop-filter', 'blur(2px)') || CSS.supports('-webkit-backdrop-filter', 'blur(2px)'); }
  catch (e) { return false; }
})();
function setFx(name, on) {
  document.documentElement.classList.toggle('no-' + name, !on);
  lookPrefs[name] = !!on;
  saveLook();
  if (cfgObj) { cfgObj.ui = cfgObj.ui || {}; cfgObj.ui[name] = !!on; }
  const b = document.querySelector('[data-ui="' + name + '"]');
  if (b) b.classList.toggle('active', !!on);
}
/** 分栏时把 ACCESS FILE 挪到 .archive-ui 下面直接定位；其它两档放回 callout 里。
    必须在两处之间搬：绝对值定位的包含块是**最近的有定位祖先**，
    而 .archive-callout 自己是 position:absolute —— 留在里面就只能相对那一栏居中，
    没法在整个舞台上居中。搬到 .archive-ui（inset:0，正好等于舞台）之后，
    CSS 里 left:50% + translateX(-50%) 才是舞台意义上的居中。
    搬回去时插回 .file-summary 之后，恢复原来的阅读顺序。 */
function placeReadFile(split) {
  const rf = $('readFile');
  const ui = document.querySelector('.archive-ui');
  const callout = document.querySelector('.archive-callout');
  if (!rf || !ui || !callout) return;
  if (split) {
    if (rf.parentElement !== ui) ui.appendChild(rf);
  } else if (rf.parentElement !== callout) {
    const summary = callout.querySelector('.file-summary');
    callout.insertBefore(rf, summary ? summary.nextSibling : null);
  }
}

/** 清单视图：array（默认）/ split（上阵列下表格各一半）/ table（表格占满）。
    表格原本是三维阵列起不来时的降级路径、会自己冒出来，用户明确不要它自动出现，
    改成这里手动切换。布局由 html 上的类驱动，见 app.css 的 .list-wrap。 */
function setListView(view) {
  if (LIST_VIEWS.indexOf(view) < 0) view = 'array';
  lookPrefs.listView = view;
  document.documentElement.classList.toggle('list-view-split', view === 'split');
  document.documentElement.classList.toggle('list-view-table', view === 'table');
  saveLook();
  document.querySelectorAll('[data-listview]').forEach(b => {
    b.classList.toggle('active', b.dataset.listview === view);
  });

  /* 阵列的起停与重新取景。 */
  placeReadFile(view === 'split');

  /* 切到 table 时阵列没有容身之处，必须真的 stop()：只藏起来的话容器变成 0 宽高，
     相机会算出一个 0/0 的 aspect，而且逐帧循环还在空转白占 GPU。
     split 只是把阵列压矮 —— 容器尺寸变了但窗口没有 resize 事件，
     场景不会自己发现，画布会留着上一次的渲染尺寸被容器裁掉（这正是分栏
     曾经"排版乱"的原因），所以要主动 resize() 一次。 */
  const arr = listArray.instance;
  const onListTab = !!document.querySelector('#tab-list.active');
  if (view === 'table') {
    if (arr) arr.stop();
    return;
  }
  if (!onListTab) return;
  // 等这一帧的布局落地再量尺寸，否则读到的还是旧的 clientHeight
  requestAnimationFrame(() => {
    if (listArray.ready && arr) { arr.start(); arr.resize(); }
    else startListArray();
  });
}
function applyFx() {
  // 以本地外观偏好为准（上次启动时用的就是它），配置里的只作为初始种子
  const frost = FROST_OK && lookPrefs.frost !== false;
  const drift = lookPrefs.drift !== false;
  document.documentElement.classList.toggle('no-frost', !frost);
  document.documentElement.classList.toggle('no-drift', !drift);
  document.querySelectorAll('[data-ui]').forEach(b => {
    const name = b.dataset.ui;
    b.classList.toggle('active', name === 'frost' ? frost : drift);
    if (name === 'frost' && !FROST_OK) {
      b.disabled = true;
      b.title = '当前内核不支持毛玻璃';
    }
  });
  // 清单视图是单选三档，不是开关。这里必须**同时**把版式类落地：
  // 只在点击时由 setListView 应用的话，开机时实际版式会停在默认的三维阵列，
  // 而按钮却按存下来的偏好点亮「上下分栏」—— 两边对不上就是这么来的。
  document.documentElement.classList.toggle('list-view-split', lookPrefs.listView === 'split');
  document.documentElement.classList.toggle('list-view-table', lookPrefs.listView === 'table');
  placeReadFile(lookPrefs.listView === 'split');
  document.querySelectorAll('[data-listview]').forEach(b => {
    b.classList.toggle('active', b.dataset.listview === lookPrefs.listView);
  });
}
document.querySelectorAll('[data-ui]').forEach(b => {
  b.addEventListener('click', () => {
    const name = b.dataset.ui;
    const on = !b.classList.contains('active');
    setFx(name, on);
    toast((on ? '已开启' : '已关闭') + b.textContent.trim() + '，下次启动仍然保留', 'ok');
  });
});
document.querySelectorAll('[data-listview]').forEach(b => {
  b.addEventListener('click', () => {
    const view = b.dataset.listview;
    if (view === lookPrefs.listView) return;
    setListView(view);
    toast('清单视图：' + b.textContent.trim() + '，下次启动仍然保留', 'ok');
  });
});
/* 课程详情弹窗：白色磨砂玻璃，同样随指针倾斜与扫光 */
const slotMask = $('slotMask');
if (slotMask && slotMask.querySelector) {
  const modal = slotMask.querySelector('.modal');
  const canStyle = !!(modal && modal.style && modal.style.setProperty);
  let raf = 0;
  const applyTilt = (nx, ny) => {
    if (!canStyle) return;
    modal.style.setProperty('--ry', (nx * 5).toFixed(2) + 'deg');
    modal.style.setProperty('--rx', (-ny * 5).toFixed(2) + 'deg');
    const sh = Math.max(6, Math.min(94, 50 + nx * 32 - ny * 14));
    modal.style.setProperty('--sh', sh.toFixed(1) + '%');
    modal.style.setProperty('--gl', Math.min(1, Math.hypot(nx, ny) / .7).toFixed(3));
  };
  modalReset = () => {
    if (!canStyle) return;
    modal.style.setProperty('--rx', '0deg');
    modal.style.setProperty('--ry', '0deg');
    modal.style.setProperty('--sh', '50%');
    modal.style.setProperty('--gl', '0');
  };
  modalReset();
  slotMask.addEventListener('mousemove', (ev) => {
    if (!canStyle || document.documentElement.classList.contains('no-drift')) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (typeof modal.getBoundingClientRect !== 'function') return;
      const m = modal.getBoundingClientRect();
      const nx = Math.max(-1, Math.min(1, ((ev.clientX - m.left) / Math.max(1, m.width)) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((ev.clientY - m.top) / Math.max(1, m.height)) * 2 - 1));
      applyTilt(nx, ny);
    });
  });
  slotMask.addEventListener('mouseleave', () => { if (modalReset) modalReset(); });
}

/* 液态玻璃的 3D 跟手倾斜。
   在课表内移动指针时：
     · 指针所在的那一块按指针在块内的相对位置绕 X/Y 轴转动 —— 像一块亚克力砖跟着手翻；
     · 倾斜角换算出反光带的位置（--sh），倾斜之后反光自然随之扫动；
     · 其余部分完全不动、不模糊、不发光 —— 反光是材质对自然光的反应，
       不是鼠标在发光，所以亮度恒定，只改角度。 */

const gridEl = $('grid');
if (gridEl) {
  const TILT = 9;       // 最大倾斜角（度）
  const BLUR_MAX = .6;  // 最远处文字的最大失焦半径（px）—— 0.4 时偏弱看不出来，取 0.6
  let hot = null;

  /* 距离失焦：每张卡各自算自己的，指针压在哪张上哪张最清晰，越远越虚。
     按「指针到这张卡中心的距离」算，不按"到最近卡"——所以是各卡独立的景深，
     不是整块课表共用一个值。
     起坡 0.28：指针压着的那张卡、以及紧邻的同一行课程基本还是清晰的；
     0.48 到顶（下午没课那片空白的距离差不多就到这），最远处 0.6px。
     这两个数是量出来的：一格横向约 0.2、一行纵向约 0.11，
     所以 0.28 意味着"隔一格才算开始虚"。
     平滑用 smoothstep，两端导数为 0，不会在起坡处出现硬边。
     只在变化超过 0.01px 时才写属性：避免每帧对每张卡都触发一次样式重算。 */
  const blurApplied = new WeakMap();
  function blurAt(d) {
    let t = (d - .28) / (.48 - .28);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t) * BLUR_MAX;
  }
  function applyBlur(clientX, clientY, rects, r) {
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    rects.forEach(item => {
      const d = Math.hypot((item.l + item.w / 2 - clientX) / w,
                           (item.t + item.h / 2 - clientY) / h);
      const v = blurAt(d);
      const prev = blurApplied.get(item.el);
      if (prev !== undefined && Math.abs(prev - v) < .01) return;
      blurApplied.set(item.el, v);
      item.el.style.setProperty('--blur', v.toFixed(3) + 'px');
    });
  }
  function clearBlur() {
    gridEl.querySelectorAll('.blk').forEach(b => {
      if (blurApplied.get(b) === 0) return;
      blurApplied.set(b, 0);
      b.style.setProperty('--blur', '0px');
    });
  }
  /* 重绘前把「上一帧写过哪些卡」的记账丢掉，免得新节点沿用旧判断。
     幕布也要一起收起来：重绘后 focused 指向的是已经销毁的节点，
     洞会停在上一个位置不动（看着像"磨砂卡住了"），要等下一次 mousemove 才恢复。 */
  resetBlur = () => {
    gridEl.querySelectorAll('.blk').forEach(b => blurApplied.delete(b));
    concealFrost();
  };

  const reset = (b) => {
    b.style.setProperty('--rx', '0deg');
    b.style.setProperty('--ry', '0deg');
    b.style.setProperty('--sh', '50%');
  };

  // 每次 mousemove 都要读 getBoundingClientRect，不节流的话每秒会强制几十次同步布局。
  // 改为「记录最后一次事件 → 每帧只处理一次」，并缓存各块矩形（滚动/改尺寸/重绘时失效重取）。
  let queued = null, rafId = 0, rectCache = null;
  const dropRects = () => { rectCache = null; };
  const wrapEl = $('gridWrap');
  if (wrapEl) wrapEl.addEventListener('scroll', dropRects, { passive: true });
  window.addEventListener('resize', dropRects);
  // 翻周 / 重新查询都会换掉整批 .blk，位置随之全变，必须让缓存失效。
  invalidateRects = dropRects;

  const collect = () => {
    const out = [];
    gridEl.querySelectorAll('.blk').forEach(b => {
      // 只收还在文档里的块：脱离文档的节点量出来是空矩形，
      // 留着会让「指针落在哪一块」判断整体失灵。
      if (b.isConnected === false) return;
      const br = b.getBoundingClientRect();
      out.push({ el: b, l: br.left, t: br.top, w: br.width, h: br.height });
    });
    rectCache = out;
    return out;
  };

  /* 磨砂幕布：一片，遮罩挖洞，洞的位置就是命中卡的中心（--fx/--fy）。
     幕布的范围必须避开两处，否则会被罩住：
       · 表头星期栏 .kb-head（幕布从它下沿开始，--top）
       · 左侧节次列 .kb-times（幕布从它右沿开始，--left）
     这两个量都按实际布局现量：星期栏字号随窗口变，节次列宽度是 CSS 变量。
     洞的坐标换算到幕布自身的内容原点，和幕布的绝对定位同一坐标系；
     滚动/改窗口尺寸时重新同步，所以翻动课表时洞会跟着卡片走。 */
  const frost = document.createElement('div');
  frost.className = 'kb-frost';
  const hasFrost = !!(frost && frost.style && frost.style.setProperty && gridEl.parentNode);
  if (hasFrost) gridEl.parentNode.appendChild(frost);
  let focused = null;   // 当前 .focus 的卡，收起时也要摘掉

  const headSel = '.kb-head';
  let frostTop = 0, frostLeft = 0, frostRight = 0;
  function measureBox() {
    if (!hasFrost) return;
    const wrap = frost.parentNode;
    const box = wrap.getBoundingClientRect();
    const times = gridEl.querySelector ? gridEl.querySelector('.kb-times') : null;
    /* 表头与节次列都必须**现查**，不能像以前那样在模块初始化时抓一次引用：
       renderGrid() 每次都重建 grid.innerHTML，之前抓到的节点会变成
       已脱离文档的，getBoundingClientRect() 全为 0 ——
       早先 frostTop 就被 Math.max(0, 0 - box.top) 夹成 0，幕布一路盖到表头上。
       另外双周布局有**两行**表头（周标签行 + 星期行），幕布要从最后一行下面开始，
       所以取的是最后一个 .kb-head 而不是第一个。 */
    const heads = gridEl.querySelectorAll ? gridEl.querySelectorAll(headSel) : null;
    const h = (heads && heads.length) ? heads[heads.length - 1] : null;
    const t = times;
    const hb = (h && h.getBoundingClientRect) ? h.getBoundingClientRect() : null;
    const tb = (t && t.getBoundingClientRect) ? t.getBoundingClientRect() : null;
    const kb = (gridEl.getBoundingClientRect) ? gridEl.getBoundingClientRect() : null;
    frostTop = hb ? Math.max(0, hb.bottom - box.top) : 0;
    frostLeft = tb ? Math.max(0, tb.right - box.left) : 0;
    frostRight = kb ? Math.max(0, box.right - kb.right) : 0;
    /* 竖直方向必须钉在「可见框」上，不能只写 top + bottom:0：
       幕布是滚动容器里的绝对定位子元素，会跟着内容一起滚 ——
       课表比可视区高（11 节 × 72px），往下滚之后幕布底边就升到容器底边之上，
       底部露出一条没遮住的（实测滚到底差 126px）。
       横竖两个方向的表现不同是因为：表头是 sticky 不随滚动走，而节次列会滚走，
       所以横向照旧用 left/right（两者一起滚，差值不变），
       竖向改成 top = scrollTop + 表头高、height = 可视高 − 表头高。 */
    frost.style.setProperty('--top', (wrap.scrollTop + frostTop).toFixed(1) + 'px');
    frost.style.setProperty('--f-h', Math.max(0, wrap.clientHeight - frostTop).toFixed(1) + 'px');
    frost.style.setProperty('--left', frostLeft.toFixed(1) + 'px');
    frost.style.setProperty('--right', frostRight.toFixed(1) + 'px');
  }

  function syncFrost(b) {
    if (!hasFrost || !b) return;
    const box = frost.parentNode.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    // 幕布自己的原点在 (frostLeft, frostTop)，洞要按这个原点算
    frost.style.setProperty('--fx', (r.left - box.left - frostLeft + r.width / 2).toFixed(1) + 'px');
    frost.style.setProperty('--fy', (r.top - box.top - frostTop + r.height / 2).toFixed(1) + 'px');
    // 洞留 1.5 倍余量：卡片还要放大、浮起，实心清晰区必须整个包住它
    frost.style.setProperty('--fw', (r.width * .75).toFixed(1) + 'px');
    frost.style.setProperty('--fh', (r.height * .75).toFixed(1) + 'px');
  }

  function concealFrost() {
    if (focused && focused.classList) focused.classList.remove('focus');
    focused = null;
    if (hasFrost) frost.classList.remove('live');
  }

  function revealFrost(b) {
    if (focused === b) return;      // 同一张卡：只同步洞的位置，不重放动画
    if (focused && focused.classList) focused.classList.remove('focus');
    focused = b;
    if (!hasFrost) return;
    if (b && b.classList) b.classList.add('focus');
    measureBox();
    frost.classList.add('live');
    // 等倾斜角写完再量：量到的矩形要和真正画出来的那张卡对齐
    syncFrost(b);
  }

  /* 命中判定：给指针用，也给「表头不触发磨砂」用 */
  function hitBlock(x, y) {
    let near = null;
    (rectCache || collect()).forEach(item => {
      if (x >= item.l && x <= item.l + item.w && y >= item.t && y <= item.t + item.h) near = item.el;
    });
    return near;
  }

  const wrapElRef = $('gridWrap');
  if (wrapElRef) wrapElRef.addEventListener('scroll', () => {
    if (focused) { measureBox(); syncFrost(focused); }
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (focused) { measureBox(); syncFrost(focused); }
  });
  // 指针扫过表头时也要收起：mousemove 只挂在 #grid 上，表头得单独接一下。
  // 用事件委托挂在 gridEl 上 —— 表头每次 renderGrid 都会被重建，
  // 直接绑在表头节点上会在第一次重绘后就永久失效。
  if (gridEl.addEventListener) {
    gridEl.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest(headSel)) concealFrost();
    });
  }

  gridEl.addEventListener('mousemove', (ev) => {
    if (document.documentElement.classList.contains('no-drift')) return;
    queued = { x: ev.clientX, y: ev.clientY };
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const q = queued;
      if (q) applyLight(q.x, q.y);
    });
  });

  function applyLight(clientX, clientY) {
    const wrap = $('gridWrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const rects = rectCache || collect();
    let nearest = null, nd = 1e9;

    rects.forEach(item => {
      const b = item.el, br = { left: item.l, top: item.t, width: item.w, height: item.h };
      const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
      const inside = clientX >= br.left && clientX <= br.left + br.width &&
                     clientY >= br.top && clientY <= br.top + br.height;
      if (!inside) return;
      const d = Math.hypot((cx - clientX) / Math.max(1, r.width),
                           (cy - clientY) / Math.max(1, r.height));
      if (d < nd) { nd = d; nearest = b; }
    });

    if (hot && hot !== nearest) reset(hot);
    hot = nearest;
    if (!nearest) { concealFrost(); return; }

    // 只让这一块「倾斜」。反光完全由倾斜角推出 —— 是材质对自然光的反应，
    // 不是鼠标在发光：亮度恒定，鼠标只负责改变这块的朝向。
    const nr = nearest.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, ((clientX - nr.left) / Math.max(1, nr.width)) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, ((clientY - nr.top) / Math.max(1, nr.height)) * 2 - 1));
    nearest.style.setProperty('--ry', (nx * TILT).toFixed(2) + 'deg');
    nearest.style.setProperty('--rx', (-ny * TILT).toFixed(2) + 'deg');
    // 面朝光源的那一侧出现反光带：倾斜角直接换算光带位置
    const sh = Math.max(8, Math.min(92, 50 - nx * 30 + ny * 12));
    nearest.style.setProperty('--sh', sh.toFixed(1) + '%');
    // 磨砂的洞放在最后量：此时倾斜角已经写好，量到的矩形才和画出来的那张卡对齐
    revealFrost(nearest);
  }

  gridEl.addEventListener('mouseleave', () => {
    gridEl.querySelectorAll('.blk').forEach(reset);
    hot = null;
    clearBlur();                                 // 指针离开课表就恢复清晰
    concealFrost();
  });

  /* 距离失焦单独接一条 mousemove：上面那条在「关闭漂移」时会直接 return，
     但失焦不是动效，是"视线离开"的静态提示，减少动态效果下也应该保留。
     用同一个逐帧节流器，不额外增加每帧的强制布局。 */
  let blurQueued = null, blurRaf = 0;
  gridEl.addEventListener('mousemove', (ev) => {
    blurQueued = { x: ev.clientX, y: ev.clientY };
    if (blurRaf) return;
    blurRaf = requestAnimationFrame(() => {
      blurRaf = 0;
      const q = blurQueued;
      if (q) applyBlur(q.x, q.y, rectCache || collect(), $('gridWrap').getBoundingClientRect());
    });
  });
}

// 下拉里按 Enter 直接查询，省去一次移动鼠标
['selYear', 'selSem'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('keydown', ev => { if (ev.key === 'Enter') viewQuery(false); });
});
// 按住时标记"手还按着"，松手就丢掉没来得及处理的待切请求
['prevWeek', 'nextWeek'].forEach(id => {
  const b = $(id);
  if (b) b.addEventListener('mousedown', () => { weekBtnHeld = true; });
});
$('prevWeek').addEventListener('click', () => requestWeek(curWeek - 1));
$('nextWeek').addEventListener('click', () => requestWeek(curWeek + 1));
$('todayWeek').addEventListener('click', () => {
  const wk = termStart ? weekOfDate(new Date()) : null;
  if (!wk) { toast('未设定第 1 周日期，可在「日历 / 设置第 1 周」里设定', 'err'); return; }
  requestWeek(Math.min(Math.max(1, wk), maxWeek));
});
$('ruler').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-week]');
  if (btn) goWeek(Number(btn.dataset.week));
});
/* 卡片按压：pointerdown 压下去 → 按住停在最低点 → pointerup 回弹 → 弹详情。
   ★ 关键：按压必须挂在 pointerdown 上。曾经挂在 click 上，而 click 是
     鼠标【松开】时才触发的 —— 于是按下去毫无反应，松开才开始加 .press，
     紧接着 openSlot() 把详情卡盖上来，那点回弹也一并被盖掉了。
     用户看到的就是"按下去没反应、松手才动、还看不到回弹"。
   回弹要看得见，详情就得等回弹播完（BOUNCE_MS）再开，不然还是被盖。
   减少动态效果时全部跳过，直接开详情。 */
const BOUNCE_MS = 240;    // 与 CSS 的 blk-release 时长（.24s）保持一致
let pressedEl = null;

function pressDown(el) {
  if (!el || document.documentElement.classList.contains('reduce-motion')) return;
  pressedEl = el;
  el.classList.remove('release', 'tap');
  el.classList.add('press');
}
function pressCancel() {
  if (!pressedEl) return;
  pressedEl.classList.remove('press');
  pressedEl = null;
}
function pressRelease() {
  const el = pressedEl;
  pressedEl = null;
  if (!el) return;
  el.classList.remove('press');
  void el.offsetWidth;            // 重排一次，让回弹从最低点起播
  el.classList.add('release');
  setTimeout(() => el.classList.remove('release'), BOUNCE_MS + 60);
  // 等回弹播完再开详情；立刻开会把回弹盖住
  setTimeout(() => openSlot(el.dataset.slot), BOUNCE_MS);
}
/* 键盘打开详情：Enter / 空格没有"按住"这段，用一次性动画补压感 */
function openSlotByKey(el) {
  const key = el.dataset.slot;
  el.classList.remove('press', 'release');
  if (!document.documentElement.classList.contains('reduce-motion')) {
    el.classList.add('tap');
    setTimeout(() => el.classList.remove('tap'), 360);
  }
  openSlot(key);
}
$('grid').addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;    // 只响应左键
  pressDown(ev.target.closest ? ev.target.closest('[data-slot]') : null);
});
window.addEventListener('pointerup', pressRelease);
window.addEventListener('pointercancel', pressCancel);
// 按住时把指针拖出去：这次算取消，不弹详情。
// 用 pointerout + relatedTarget 判断，不能用 pointerleave —— 那玩意在
// 进出子元素（.blk-name 之类）时也会触发，会误判成离开。
$('grid').addEventListener('pointerout', (ev) => {
  if (!pressedEl) return;
  const to = ev.relatedTarget;
  if (!to || !pressedEl.contains(to)) pressCancel();
});
// 键盘可达：Enter / 空格同样打开详情（没有"按住"阶段，走一次性压感）
$('grid').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest ? ev.target.closest('[data-slot]') : null;
  if (!el) return;
  ev.preventDefault();
  openSlotByKey(el);
});
// 顶栏「清单」按钮：切到左侧栏的课程清单页
$('listBtn').addEventListener('click', () => showTab('list'));
// 检索框：清单改用阵列浏览后这个输入框已移除；留着绑定是为了将来加回来时不用改这里
if ($('listSearch')) $('listSearch').addEventListener('input', () => renderList());
function closeSlot() {
  $('slotMask').classList.remove('show');
  const el = document.querySelector('#grid .blk.press');
  if (el) el.classList.remove('press');
}
$('slotClose').addEventListener('click', closeSlot);
$('slotMask').addEventListener('click', (ev) => {
  if (ev.target === $('slotMask')) closeSlot();
});
$('calBtn').addEventListener('click', openCal);
$('calClose').addEventListener('click', () => $('calMask').classList.remove('show'));
$('calMask').addEventListener('click', (ev) => {
  if (ev.target === $('calMask')) $('calMask').classList.remove('show');
});
/* 疏密切换：立即生效，并写进本地外观偏好（下次启动直接恢复） */
document.querySelectorAll('[data-density]').forEach(btn => {
  btn.addEventListener('click', () => {
    density = btn.dataset.density;
    applyDensityUI();
    if (currentRows.length) renderGrid(currentRows);
    lookPrefs.density = density;
    saveLook();
    if (cfgObj) {
      cfgObj.ui = cfgObj.ui || {};
      cfgObj.ui.density = density;
    }
    toast('课表外观已切换为「' + densityPreset().label + '」，下次启动仍然保留', 'ok');
  });
});
$('calPrev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCal(); });
$('calNext').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCal(); });
$('calGrid').addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-date]');
  if (!el) return;
  if (!termStart) { toast('请先在上方设定「第 1 周周一日期」，之后点日期即可跳转', 'err'); return; }
  const dt = new Date(el.dataset.date + 'T00:00:00');
  const wk = weekOfDate(dt);
  if (wk && wk >= 1) {
    curWeek = Math.min(Math.max(1, wk), maxWeek);
    renderGrid(currentRows);
    renderCal();
    $('calMask').classList.remove('show');
    toast('已跳转到第 ' + curWeek + ' 周', 'ok');
  } else {
    toast('该日期不在本学期范围内');
  }
});
$('saveStart').addEventListener('click', async () => {
  const v = $('startDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('请选择有效日期', 'err'); return; }
  termStart = new Date(v + 'T00:00:00');
  if (cfgObj) {
    cfgObj.term = cfgObj.term || {};
    cfgObj.term.start_date = v;
    try { await api.save_config(cfgObj); } catch (e) { /* ignore */ }
  }
  const wkNow = weekOfDate(new Date());
  if (wkNow && wkNow >= 1 && wkNow <= maxWeek) curWeek = wkNow;
  renderGrid(currentRows);
  renderCal();
  toast('已设置第 1 周周一 = ' + v + (wkNow ? '（今天为第 ' + wkNow + ' 周）' : ''), 'ok');
});
$('clearStart').addEventListener('click', async () => {
  termStart = null;
  if (cfgObj) {
    cfgObj.term = cfgObj.term || {};
    cfgObj.term.start_date = '';
    try { await api.save_config(cfgObj); } catch (e) { /* ignore */ }
  }
  $('startDate').value = '';
  renderGrid(currentRows);
  renderCal();
  toast('已清除起始日期（改为仅按周次过滤）');
});
$('testPushBtn').addEventListener('click', fullWorkflowTest);
$('previewPushBtn').addEventListener('click', previewPush);
$('exportCsvBtn').addEventListener('click', () => {
  if (!currentRows.length) { toast('暂无数据可导出', 'err'); return; }
  const lines = ['星期,节次,课程,教师,教室,周次'];
  currentRows.forEach(r => {
    const jc = (r.start && r.end && r.end !== r.start) ? r.start + '-' + r.end : (r.start || '');
    lines.push([dayLabel(r.day), jc, '"' + r.name.replace(/"/g, '""') + '"',
      '"' + r.teacher.replace(/"/g, '""') + '"', '"' + r.room.replace(/"/g, '""') + '"',
      '"' + r.weeks.replace(/"/g, '""') + '"'].join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '课表.csv';
  a.click();
});

/* ---------------- 设置 ---------------- */
function fillForm(cfg) {
  const a = cfg.auth || {}, t = cfg.term || {}, p = cfg.push || {}, n = cfg.notify || {};
  const mon = cfg.monitor || {};
  $('base').value = cfg.base || '';
  $('username').value = a.username || '';
  $('password').value = a.password || '';
  $('provider').value = p.provider || 'wechat_ui';
  $('sendkey').value = p.sendkey || '';
  $('pushplusToken').value = p.pushplus_token || '';
  $('wechatContact').value = p.wechat_contact || '文件传输助手';
  $('autoTerm').checked = !!t.auto;
  $('xnm').value = t.xnm || '';
  $('xqm').value = t.xqm || '';
  $('monitorEnabled').checked = mon.enabled !== false;   // 默认开启
  $('onStart').checked = n.on_start !== false;
  $('onWaiting').checked = n.on_waiting !== false;
  $('onChange').checked = n.on_change !== false;
  $('onError').checked = n.on_error !== false;
  if (t.start_date && /^\d{4}-\d{2}-\d{2}$/.test(t.start_date)) {
    termStart = new Date(t.start_date + 'T00:00:00');
    $('startDate').value = t.start_date;
  } else {
    termStart = null;
  }
  const st = (cfg.schedule && Array.isArray(cfg.schedule.times)) ? cfg.schedule.times : ['10:00', '17:00'];
  timeList = st.filter(v => /^\d{2}:\d{2}$/.test(String(v))).sort();
  renderTimeChips();
  density = DENSITIES[lookPrefs.density] ? lookPrefs.density : 'standard';
  applyDensityUI();
  applyLayoutUI();
  applyFx();
  syncProviderRows();
}
function renderTimeChips() {
  const box = $('timeChips');
  box.innerHTML = '';
  timeList.forEach((t, i) => {
    const c = document.createElement('span');
    c.className = 'time-chip';
    c.innerHTML = esc(t) + '<button class="rm" title="移除" data-i="' + i + '">×</button>';
    box.appendChild(c);
  });
}
$('timeChips').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.rm');
  if (!btn) return;
  timeList.splice(Number(btn.dataset.i), 1);
  renderTimeChips();
});
$('addTimeBtn').addEventListener('click', () => {
  const v = $('newTime').value;
  if (!/^\d{2}:\d{2}$/.test(v)) { toast('请选择有效时间', 'err'); return; }
  if (timeList.indexOf(v) >= 0) { toast('该时间已在列表中', 'err'); return; }
  timeList.push(v);
  timeList.sort();
  renderTimeChips();
  toast('已添加 ' + v + '（保存后生效）', 'ok');
});
function syncProviderRows() {
  const p = $('provider').value;
  $('sendkeyRow').style.display = p === 'serverchan' ? '' : 'none';
  $('pushplusRow').style.display = p === 'pushplus' ? '' : 'none';
  $('wechatContactRow').style.display = p === 'wechat_ui' ? '' : 'none';
}
$('provider').addEventListener('change', syncProviderRows);
$('eyeBtn').addEventListener('click', () => {
  const p = $('password');
  const hidden = p.type === 'password';
  p.type = hidden ? 'text' : 'password';
  const use = $('eyeBtn').querySelector('use');
  if (use) use.setAttribute('href', hidden ? '#i-eye-off' : '#i-eye');
});
$('saveBtn').addEventListener('click', async () => {
  if (!api || !cfgObj) return;
  cfgObj.base = $('base').value.trim();
  cfgObj.auth = cfgObj.auth || {};
  cfgObj.auth.username = $('username').value.trim();
  cfgObj.auth.password = $('password').value;
  cfgObj.push = cfgObj.push || {};
  cfgObj.push.provider = $('provider').value;
  cfgObj.push.sendkey = $('sendkey').value.trim();
  cfgObj.push.pushplus_token = $('pushplusToken').value.trim();
  cfgObj.push.wechat_contact = $('wechatContact').value.trim() || '文件传输助手';
  cfgObj.term = cfgObj.term || {};
  cfgObj.term.auto = $('autoTerm').checked;
  cfgObj.term.xnm = $('xnm').value.trim();
  cfgObj.term.xqm = $('xqm').value;
  cfgObj.notify = cfgObj.notify || {};
  cfgObj.notify.on_start = $('onStart').checked;
  cfgObj.notify.on_waiting = $('onWaiting').checked;
  cfgObj.notify.on_change = $('onChange').checked;
  cfgObj.notify.on_error = $('onError').checked;
  cfgObj.schedule = cfgObj.schedule || {};
  cfgObj.schedule.times = timeList.length ? timeList : ['10:00', '17:00'];
  cfgObj.monitor = cfgObj.monitor || {};
  cfgObj.monitor.enabled = $('monitorEnabled').checked;
  cfgObj.ui = cfgObj.ui || {};
  cfgObj.ui.density = density;
  try {
    const r = await api.save_config(cfgObj);
    toast(r && r.ok ? '✅ 配置已保存（界面开着时按新时间自动检查）' : '❌ 保存失败', r && r.ok ? 'ok' : 'err');
    try {
      const to = await api.get_term_options();
      watchTerm = to.watch;
      if (to.watch) {
        $('selYear').value = String(to.watch[0]);
        $('selSem').value = String(to.watch[1]);
        syncYearLabel();
      }
    } catch (e2) { /* ignore */ }
    await refreshStatus();
    await refreshTasks();
    if (r && r.ok) {
      if (!$('autoTerm').checked) {
        toast('⚠️ 已关闭自动：监控目标变为手动指定学期（不再等新学期开放提醒）', 'err');
      }
      await viewQuery(false);
    }
  } catch (e) { toast('❌ ' + e, 'err'); }
});
$('autoTerm').addEventListener('change', () => {
  const el = $('termNow');
  if (el && !$('autoTerm').checked && $('xnm').value.trim()) {
    el.title = '已改为手动监控 ' + $('xnm').value.trim();
  }
});

/* ---------------- 可选：系统定时任务 ---------------- */
async function refreshTasks() {
  if (!api) return;
  try {
    const t = await api.tasks_status();
    const timesTxt = ((t.times || timeList || []).join(' / ')) || '10:00 / 17:00';
    if (t.ok) $('taskStatus').textContent = '✅ 已安装系统任务：关闭软件也会在 ' + timesTxt + ' 自动检查';
    else $('taskStatus').textContent = '当前：界面开着时按 ' + timesTxt + ' 自动检查（未安装系统任务）';
    $('installTasks').disabled = !!t.ok;
  } catch (e) { /* ignore */ }
}
$('installTasks').addEventListener('click', async () => {
  toast('正在按时间列表重建任务…');
  try {
    const r = await api.install_tasks();
    if (r && r.ok) toast('✅ 已按 ' + (r.times || []).join(' / ') + ' 注册定时任务', 'ok');
    else toast('❌ 注册失败（可看日志排查）', 'err');
  } catch (e) { toast('❌ ' + e, 'err'); }
  await refreshTasks();
  await refreshStatus();
});
$('uninstallTasks').addEventListener('click', async () => {
  try {
    await api.uninstall_tasks();
    toast('已卸载定时任务');
  } catch (e) { toast('❌ ' + e, 'err'); }
  await refreshTasks();
});

/* ---------------- 日志 ---------------- */
function escLine(l) {
  const s = esc(l);
  const line = '<span class="lg-line">' + s + '</span>';
  if (/失败|异常|错误|ERROR/.test(s)) return '<span class="lg-err">' + line + '</span>';
  if (/已发送|推送/.test(s)) return '<span class="lg-push">' + line + '</span>';
  return line;
}
async function pollLogs() {
  if (!api) return;
  try {
    const lines = await api.get_logs(200);
    const text = lines.map(l => String(l).replace(/\s+$/, '')).join('');
    const box = $('logBox');
    if (text !== box.dataset.last) {
      box.dataset.last = text;
      box.innerHTML = lines.length ? lines.map(escLine).join('') : '（暂无日志）';
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) { /* ignore */ }
}
function manageLogPolling(active) {
  if (active && !logTimer) { pollLogs(); logTimer = setInterval(pollLogs, 5000); }
  else if (!active && logTimer) { clearInterval(logTimer); logTimer = null; }
}
$('clearLogBtn').addEventListener('click', async () => {
  if (!api) return;
  await api.clear_logs();
  const box = $('logBox');
  box.innerHTML = '（暂无日志）';
  box.dataset.last = '';
});

/* ---------------- 启动 ---------------- */
async function init() {
  tickClock();
  setInterval(tickClock, 1000);
  api = (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  if (!api) {
    $('refreshBtn').disabled = true;
    $('testPushBtn').disabled = true;
    $('viewBtn').disabled = true;
    toast('未检测到桌面环境，请通过 KbMonitor.exe 打开本界面', 'err');
    return;
  }
  // 两个状态文件（ui_prefs.json / schedule_cache.json）必须在 fillForm 之前读进来
  await loadDiskPrefs();
  applyStoredPrefs();
  cfgObj = await api.get_config();
  fillForm(cfgObj);
  try { await initTermBar(); } catch (e) { /* ignore */ }
  const a = (cfgObj && cfgObj.auth) || {};
  const configured = !!(a.username && String(a.username).indexOf('在这里') < 0 && a.password);
  /* 先把上次的课表摆上来 —— 启动瞬间不该是空课表，
     之后无论自动查询成功、失败还是被跳过，用户都至少有上一份可看。 */
  const manual = Array.isArray(cfgObj.manual_schedule) ? cfgObj.manual_schedule : null;
  const snap = loadScheduleSnapshot();
  if (cfgObj.use_manual && manual && manual.length) {
    // 手动 / Excel 导入的课表优先：那是用户自己弄的，不该被联网结果盖掉
    adoptManualRows(manual);
    setManualState(true);
    $('termNow').textContent = '手动课表 · ' + manual.length + ' 门';
  } else if (snap) {
    if (snap.year) $('selYear').value = snap.year;
    if (snap.sem) $('selSem').value = snap.sem;
    syncYearLabel();
    applyRows(snap.rows);          // 内部会 saveScheduleSnapshot，所以下面要复写周次
    if (snap.week) curWeek = snap.week;
    renderGrid(currentRows);
    $('termNow').textContent = (snap.year && snap.sem ? snap.year + ' ' + (XQM[snap.sem] || '') : '上次查询') +
      ' · ' + currentRows.length + ' 门 · 上次结果';
  }
  // 启动时自动查询默认（监控）学期；但若最近 30 分钟内刚发生过网络故障就跳过
  let skipAuto = false;
  try {
    const st0 = await api.get_status();
    skipAuto = !!st0.net_error_recent;
  } catch (e) { /* ignore */ }
  if (isManual()) {
    // 手动课表：不自动联网查询，否则用户刚导入的课表就被盖了
    setPill('空闲', 'idle');
  } else if (configured && !skipAuto) {
    await viewQuery(true);
  } else if (!snap) {
    currentRows = [];
    renderGrid(currentRows);
    renderList(currentRows);
    if (configured && skipAuto) toast('检测到最近网络异常，已跳过启动自动查询（可点「查看该学期」手动重试）');
  } else if (configured && skipAuto) {
    toast('检测到最近网络异常，这次启动没有自动刷新；下面是上次查询的课表（点「查看该学期」重试）');
  }
  await refreshStatus();
  await refreshTasks();
  setInterval(refreshStatus, 15000);   // 降频轮询，减少 WebView2/Python 常驻开销

  /* 数据到位后空闲时预热三维阵列：把首次进入课程清单的那一下卡顿提前付掉。
     放在这里（而不是脚本末尾）是因为要等课表数据与首屏都稳定，别跟启动抢主线程。 */
  if (window.requestIdleCallback) requestIdleCallback(() => warmListArray(), { timeout: 6000 });
  else setTimeout(() => warmListArray(), 3000);
}
function boot() {
  if (window.pywebview && window.pywebview.api) init();
  else window.addEventListener('pywebviewready', init, { once: true });
}
boot();
