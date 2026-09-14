// 离线验证课表 UI：周次解析 + 块布局几何 + 重叠并排 + 疏密联动 + 日历 + 样式契约
//
// 用法：
//   node web_ui_test.js               读 kbapp/web/app.js（唯一源）
//   set KBAPP=<工程根> && node web_ui_test.js   读别的副本做一致性回归
//
// 2026-09-14 清理时的三处修正（此前这套断言有 11 项失败 + 1 处崩溃）：
//   1) 夹具改为本文件自带。原先从 app.js 里读 DEMO_KB 常量 —— 那是作者本人的
//      真实课表快照，既不该随源码分发，也让测试依赖产品代码里的一个具体常量
//      （该常量一删，整个测试直接 ReferenceError）。现在用合成课表，覆盖同样的
//      边界：单双周、跨周段、相邻节次合并、同格重叠、第 10 节以后的行数。
//   2) DOM 桩改为按 id 缓存元素。原桩每次 getElementById 都返回一个新对象，
//      于是 openSlot 写入的 slotBody 与测试读取的不是同一个，弹窗断言必然失败。
//   3) 断言改成对齐真实 API：
//        · data-slot 的键是「周_日_起始节」（如 1_1_1），不是「日_节」
//        · parseWeeks 返回 Set（「每周都有」返回 null），不是数组
//        · 疏密行高实为 紧凑42 / 标准50 / 瘦长72（断言原写 160/192/232 是旧值）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = process.env.KBAPP
  ? path.resolve(process.env.KBAPP, 'kbapp', 'web', 'app.js')
  : path.join(__dirname, 'kbapp', 'web', 'app.js');
if (!fs.existsSync(APP)) {
  console.error('找不到前端逻辑：' + APP + '\n可用 KBAPP=<工程根> 指定其它副本。');
  process.exit(1);
}
const code = fs.readFileSync(APP, 'utf8');
const WEB = path.dirname(APP).replace(/\\/g, '/');
console.log('读取前端逻辑：' + path.relative(__dirname, APP).replace(/\\/g, '/') + '\n');

/* ---------------- DOM 桩：按 id 缓存，保证写入与读取是同一个对象 ---------------- */
function fakeStyle() {
  const store = {};
  return {
    setProperty(k, v) { store[k] = String(v); },
    getPropertyValue(k) { return store[k] || ''; },
    removeProperty(k) { delete store[k]; },
    get cssText() { return Object.keys(store).map(k => k + ':' + store[k]).join(';'); },
  };
}
function fakeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: fakeStyle(), innerHTML: '', textContent: '', dataset: {},
    value: '', checked: false, disabled: false, offsetWidth: 0,
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener() {}, removeEventListener() {}, click() {},
    setAttribute() {}, getAttribute() { return null; },
    closest() { return null; },
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 400, right: 120, bottom: 400 }),
    classList: {
      _s: {},
      add(...c) { c.forEach(x => { this._s[x] = 1; }); },
      remove(...c) { c.forEach(x => { delete this._s[x]; }); },
      toggle(c, on) { if (on === undefined) { this._s[c] ? delete this._s[c] : this._s[c] = 1; } else if (on) { this._s[c] = 1; } else { delete this._s[c]; } },
      contains(c) { return !!this._s[c]; },
    },
  };
  return el;
}
const els = {};
const sandbox = {
  console, setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {},
  setTimeout: () => 0, requestAnimationFrame: () => 0, cancelAnimationFrame: () => 0,
  Blob: function () {}, URL: { createObjectURL: () => '' },
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, RegExp, Error,
  document: {
    getElementById: (id) => (els[id] = els[id] || fakeEl()),
    createElement: (t) => fakeEl(t),
    querySelector: () => fakeEl(), querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {} },
    documentElement: fakeEl('html'),
    addEventListener() {},
  },
  window: { addEventListener() {}, pywebview: null, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

let pass = true;
const check = (d, c) => { console.log((c ? '✅ ' : '❌ ') + d); if (!c) pass = false; };
const setOf = (s) => s ? Array.from(s).sort((a, b) => a - b).join(',') : 'ALL';
/** app.css 所在目录（样式契约段要用；WEB 即 app.js 所在目录） */
const SRC = WEB;

/* ---------------- 测试夹具：合成课表，不来自任何真实账号 ---------------- */
const KB = [
  { day: 1, start: 1, end: 2, name: '课程甲', teacher: '师甲', room: 'A101', weeks: '1-16周' },
  { day: 1, start: 7, end: 8, name: '课程乙', teacher: '师乙', room: 'B202', weeks: '1-3周' },
  { day: 1, start: 7, end: 8, name: '课程乙', teacher: '师丙', room: 'B202', weeks: '4-6周' },
  { day: 1, start: 10, end: 11, name: '课程丙', teacher: '师丁', room: 'C303', weeks: '4周' },
  { day: 3, start: 1, end: 2, name: '课程丁', teacher: '师戊', room: 'A101', weeks: '1-8周' },
  { day: 3, start: 3, end: 4, name: '课程丁', teacher: '师戊', room: 'A101', weeks: '1-8周' },
  { day: 3, start: 3, end: 4, name: '课程戊', teacher: '师己', room: 'D404', weeks: '9-15周(单)' },
  { day: 5, start: 1, end: 2, name: '课程庚', teacher: '师辛', room: '在线', weeks: '2-16周(双)' },
  { day: 5, start: 5, end: 6, name: '课程辛', teacher: '师壬', room: 'A101', weeks: '7周,11周' },
  { day: 5, start: 7, end: 8, name: '课程乙', teacher: '师乙,师丙', room: 'B202', weeks: '9-10周' },
];

function parseBlocks(html) {
  return html.split('<div class="blk"').slice(1).map(chunk => {
    const g = (re) => { const m = chunk.match(re); return m ? m[1] : null; };
    return {
      slot: g(/data-slot="([^"]+)"/),
      top: Number(g(/top:(\d+)px/)),
      height: Number(g(/height:(\d+)px/)),
      widthPct: Number(g(/width:calc\(([\d.]+)%/)),
      badge: g(/blk-badge[^>]*>(\d+)</),
      name: g(/blk-name">([^<]*)</),
    };
  });
}
function render(w, rows) {
  vm.runInContext('curWeek = ' + w + ';', sandbox);
  sandbox.applyRows((rows || KB).map(r => Object.assign({}, r)));
  return { html: els['grid'].innerHTML, times: (els['grid'].innerHTML.match(/class="kb-time"/g) || []).length };
}
// 网格一次渲染三周（当前周 + 前后各一周，供翻周滑动），所以任何按名字的断言
// 都必须先按 slot 键的周次段过滤，否则会同时命中三份 —— 这不是产品重复渲染，
// 而是用户实际只看到其中一周。slot 键格式为「周_日_起始节」，如 1_3_1。
const inWeek = (blocks, w) => blocks.filter(b => String(b.slot || '').startsWith(w + '_'));
const names = (blocks) => blocks.map(b => b.name);

/* ---------------- 周次解析：parseWeeks 返回 Set，null 表示每周都有 ---------------- */
check('“1-16周” → 1..16', setOf(sandbox.parseWeeks('1-16周')) === Array.from({ length: 16 }, (_, i) => i + 1).join(','));
check('“5-11周(单)” → 5,7,9,11', setOf(sandbox.parseWeeks('5-11周(单)')) === '5,7,9,11');
check('“2-16周(双)” → 2,4,…,16', setOf(sandbox.parseWeeks('2-16周(双)')) === '2,4,6,8,10,12,14,16');
check('“9-15周(单)” → 9,11,13,15', setOf(sandbox.parseWeeks('9-15周(单)')) === '9,11,13,15');
check('“1-3周,5-12周” → 1,2,3,5..12', setOf(sandbox.parseWeeks('1-3周,5-12周')) === '1,2,3,5,6,7,8,9,10,11,12');
check('“12周” → 12', setOf(sandbox.parseWeeks('12周')) === '12');
check('空周次 → null（表示每周都有，而不是空集）', sandbox.parseWeeks('') === null);

/* ---------------- 第 1 周：块几何 / 相邻合并 / 网格行数 ---------------- */
const r1 = render(1);
const b1 = inWeek(parseBlocks(r1.html), 1);
check('第1周：有 课程甲', names(b1).includes('课程甲'));
check('第1周：有 课程乙(1-3周)', b1.some(b => b.name === '课程乙'));
check('第1周：无 课程丙(仅4周)', !names(b1).includes('课程丙'));
check('第1周：无 周一第10节 的块(课程丙仅4周)', !b1.some(b => b.slot === '1_1_10'));
// 几何：top = (起始节-1)*行高 + 4；height = 节数*行高 - 8；标准行高 50
check('课程甲 块高 92px、top 4px（1-2 节 @行高50）', (() => {
  const b = b1.find(x => x.name === '课程甲');
  return b && b.height === 92 && b.top === 4;
})());
check('相邻节次同课合并：周三 课程丁 1-2 + 3-4 → 一块 1-4 节(高 192px)', (() => {
  const bs = b1.filter(x => x.name === '课程丁');
  return bs.length === 1 && bs[0].slot === '1_3_1' && bs[0].height === 192;
})());
check('第1周网格 11 行（按整学期最晚节次固定，翻周不跳动）', r1.times === 11);

/* ---------------- 第 4 周：跨周段课登场、行数不变 ---------------- */
const r4 = render(4);
const b4 = inWeek(parseBlocks(r4.html), 4);
check('第4周：出现 课程丙(仅4周)', b4.some(b => b.name === '课程丙'));
check('第4周：课程丙 top = 454px(第10节 @行高50)', (() => {
  const b = b4.find(x => x.name === '课程丙');
  return b && b.top === 454;
})());
check('第4周：课程乙 换教师后仍在场(4-6周)', names(b4).includes('课程乙'));
check('第4周：网格仍 11 行（与第1周一致）', r4.times === 11);

/* ---------------- 第 9 周：单周课 + 9-10 周课 ---------------- */
const r9 = render(9);
const b9 = inWeek(parseBlocks(r9.html), 9);
check('第9周：周三3-4 课程戊(9-15单)', b9.some(b => b.slot === '9_3_3' && b.name === '课程戊'));
check('第9周：课程丁(1-8周) 已消失', !names(b9).includes('课程丁'));
check('第9周：周五7-8 课程乙(9-10周)', b9.some(b => b.slot === '9_5_7' && b.name === '课程乙'));

/* ---------------- 第 11 / 12 周：离散周次进出 ---------------- */
const b11 = inWeek(parseBlocks(render(11).html), 11);
check('第11周：周五5-6 课程辛(7周,11周)', b11.some(b => b.slot === '11_5_5' && b.name === '课程辛'));
const b12 = inWeek(parseBlocks(render(12).html), 12);
check('第12周：课程辛(7周,11周) 已退出', !names(b12).includes('课程辛'));

/* ---------------- 第 2 / 3 周：双周课 ---------------- */
check('第2周：周五1-2 课程庚(2-16双) 在场', inWeek(parseBlocks(render(2).html), 2).some(b => b.slot === '2_5_1' && b.name === '课程庚'));
check('第3周：周五1-2 课程庚 不在场', !inWeek(parseBlocks(render(3).html), 3).some(b => b.slot === '3_5_1'));

/* ---------------- 重叠并排 + 圆圈数字 + 弹窗 ---------------- */
const overlap = [
  { day: 3, start: 5, end: 8, name: '重叠课A', teacher: '师一', room: 'X101', weeks: '1-16周' },
  { day: 3, start: 7, end: 8, name: '重叠课B', teacher: '师二', room: 'X102', weeks: '1-16周' },
];
const pair = inWeek(parseBlocks(render(1, overlap).html), 1).filter(b => b.name.startsWith('重叠课'));
check('重叠课并排成两块', pair.length === 2);
check('重叠课各占 50% 宽', pair.length === 2 && pair.every(b => Math.abs(b.widthPct - 50) < 0.01));
check('重叠课显示圆圈数字 2', pair.length === 2 && pair.every(b => b.badge === '2'));
sandbox.openSlot('1_3_5');
check('点击弹窗列出该时段的两门课',
  (els['slotBody'].innerHTML.match(/slot-item/g) || []).length === 2);

/* ---------------- 疏密预设：行高联动（紧凑42 / 标准50 / 瘦长72） ---------------- */
const hOf = (d) => {
  vm.runInContext("density = '" + d + "';", sandbox);
  const b = parseBlocks(render(1).html).find(x => x.name === '课程丁');
  return b ? b.height : null;
};
check('疏密-标准：1-4节 高 192px（行高 50）', hOf('standard') === 192);
check('疏密-瘦长：1-4节 高 280px（行高 72）', hOf('slim') === 280);
check('疏密-紧凑：1-4节 高 160px（行高 42）', hOf('compact') === 160);
vm.runInContext("density = 'standard';", sandbox);

/* ---------------- 日历 ---------------- */
vm.runInContext("termStart = new Date('2026-09-07T00:00:00'); calMonth = new Date(2026, 8, 1);", sandbox);
check('9/7 属第1周', sandbox.weekOfDate(new Date('2026-09-07T00:00:00')) === 1);
check('9/14 属第2周', sandbox.weekOfDate(new Date('2026-09-14T00:00:00')) === 2);
check('第3周日期范围 = 9/21 ~ 9/27', sandbox.weekDateRange(3) === '9/21 ~ 9/27');
sandbox.renderCal();
check('日历渲染 ≥28 天', (els['calGrid'].innerHTML.match(/cal-cell day/g) || []).length >= 28);

// ---------- 样式契约（防「基类被静默删除」）----------
// 起因：一次改动把 .kb-day / .blk 的布局基类整体删掉了。
// JS 的断言全过（它只负责生成 HTML），但整张课表塌成了普通文字流，
// 界面看起来「完全不对」却没有任何报错。这里给样式表本身订契约。
const CSS = fs.readFileSync(SRC + '/app.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// 取所有规则体（含单行写法），按选择器分组
const rules = [];
{
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) {
    rules.push({ sels: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')), body: m[2] });
  }
}
// 找出「选择器恰好是 sel」的全部规则体，拼起来一起断言
const declOf = (sel) => rules.filter(r => r.sels.includes(sel)).map(r => r.body).join(';');
const hasDecl = (sel, re) => re.test(declOf(sel));

check('.kb 有 min-width（否则窄窗口下天列被挤没）', hasDecl('.kb', /min-width\s*:\s*\d+px/));
check('.kb-day 存在基础规则', rules.some(r => r.sels.includes('.kb-day')));
check('.kb-day position:relative（卡片绝对定位的参照系）', hasDecl('.kb-day', /position\s*:\s*relative/));
check('.kb-day flex:1（均分七列）', hasDecl('.kb-day', /flex\s*:\s*1/));
check('.blk 存在基础规则', rules.some(r => r.sels.includes('.blk')));
check('.blk position:absolute（课表卡片的命根子）', hasDecl('.blk', /position\s*:\s*absolute/));
check('.blk 有课程底色 --blk-bg', hasDecl('.blk', /background\s*:[^;]*--blk-bg/));
check('.blk overflow:hidden（长课名裁切）', hasDecl('.blk', /overflow\s*:\s*hidden/));
check('.blk 有 3D 倾斜变换（--rx/--ry）', hasDecl('.blk', /rotateX\(var\(--rx/));
check('.blk-name 用 --blk-name 字号（疏密联动）', hasDecl('.blk-name', /font-size\s*:\s*var\(--blk-name/));
check('.blk-sub 用 --blk-sub 字号', hasDecl('.blk-sub', /font-size\s*:\s*var\(--blk-sub/));

// 样式契约：磨砂聚焦（用户要求「其他区域整块磨砂 + 选中课放大浮起」）
// 注意允许带前缀的 -webkit-backdrop-filter —— 负向先行断言要挡住它。
const kbCards = rules.filter(r => r.sels.some(s =>
  s === '.blk' || s.startsWith('.blk:') || s.startsWith('.blk.') || s === '.kb-day'));
const cardsBody = kbCards.map(r => r.body).join(';');
check('课程卡自身不含 filter:blur（不是逐卡模糊方案）',
  !/(?<!-webkit-)filter\s*:[^;]*blur/.test(cardsBody));
check('课程卡自身不含 backdrop-filter（框架层玻璃只属于框架）',
  !/(?<!-webkit-)backdrop-filter/.test(cardsBody));
const frostBody = rules.filter(r => r.sels.some(s => s.includes('.kb-frost'))).map(r => r.body).join(';');
check('有 .kb-frost 磨砂幕布', frostBody.length > 0);
check('.kb-frost 用 backdrop-filter 做磨砂', /backdrop-filter\s*:\s*blur/.test(frostBody));
check('.kb-frost 用 mask 挖洞（--fx/--fy 定位）',
  /mask-image/.test(frostBody) && /at var\(--fx/.test(frostBody));
check('.kb-frost 不吃指针事件', /pointer-events\s*:\s*none/.test(frostBody));
// scale() 里现在是 calc(--pop-lift * --pop-press)，所以不能只匹配 scale(var(--pop-lift
check('.blk.focus 放大（--pop-lift）',
  (() => { const t = /transform:[^;]*/.exec(declOf('.blk.focus'))?.[0] || ''; return /scale\(/.test(t) && /--pop-lift/.test(t); })());
check('.blk.focus 抬高浮起（负向 Y 位移）', hasDecl('.blk.focus', /translate3d\(\s*0\s*,\s*-\d/));
check('.blk.focus 有落影（浮起感），且已收到克制档', (() => {
  const b = declOf('.blk.focus');
  if (!/box-shadow/.test(b)) return false;
  // 外落影的模糊半径要 >=12px 才有"抬起"感，但不得超过 26px ——
  // 之前 44px 的版本用户反馈跳得太夸张，这里把上界钉住防止再调回去。
  const out = [...b.matchAll(/^\s*0\s+\d+px\s+(\d+)px/gm)].map(m => Number(m[1]));
  return out.some(v => v >= 12) && out.every(v => v <= 26);
})());
check('旧的 #grid-wrap.dim 逐卡模糊蒙层没有被拿回来',
  !rules.some(r => r.sels.some(s => s.includes('.dim'))));
check('JS 在重绘课表时会失效磨砂/矩形缓存（切周后不残留）',
  /invalidateRects/.test(code) && /if \(invalidateRects\) invalidateRects\(\);/.test(code));

// 范围契约：幕布必须跟着表头下沿和节次列右沿走，否则会把它们罩住
// （用户实测反馈：周一周五那一行和左侧序号被磨砂盖住了）
check('幕布 top 由 --top 控制（量表头下沿）', /top:\s*var\(--top/.test(frostBody));
check('幕布 left 由 --left 控制（量节次列右沿）', /left:\s*var\(--left/.test(frostBody));
check('JS 量了 .kb-head 的下沿写入 --top', (() => {
  // 应用把选择器抽成了 headSel 常量，并用 querySelectorAll 取**最后一个** .kb-head
  // （双周布局有两行表头，幕布必须从最后一行下面开始）。断言对准这个行为，
  // 而不是某个巧合的写法 —— 之前它找字面量 querySelector('.kb-head') 必然假红。
  const usesSel = /querySelectorAll\(\s*headSel\s*\)|querySelector\(\s*'\.kb-head'\s*\)/.test(code);
  const takesLast = /heads\s*\[\s*heads\.length\s*-\s*1\s*\]/.test(code);
  const usesBottom = /hb\.bottom/.test(code);
  return usesSel && takesLast && usesBottom && /setProperty\('--top'/.test(code);
})());
check('JS 量了 .kb-times 的右沿写入 --left',
  /querySelector\('\.kb-times'\)/.test(code) && /setProperty\('--left'/.test(code));
check('幕布在表头之上还留了 z-index 兜底（.kb-head 提到幕布之上）', (() => {
  // 取每条规则里最后一个 z-index：.kb-head 的基类有一条 8，兜底那条在后面
  const last = (body) => {
    const all = [...body.matchAll(/z-index\s*:\s*(\d+)/g)].map(m => Number(m[1]));
    return all.length ? all[all.length - 1] : 0;
  };
  const h = rules.filter(r => r.sels.includes('.kb-head')).map(r => last(r.body));
  const f = last(rules.filter(r => r.sels.includes('.kb-frost')).map(r => r.body).join(';'));
  const hz = h.length ? Math.max(...h) : 0;
  return f > 0 && hz > f;
})());
// --top/--left 绝不能进过渡：值会从 initial-value 补间，幕布会先多盖住表头再收回
check('--top/--left 没有被注册为可插值（否则会从 0 补间过去）',
  !/@property\s+--top/.test(CSS) && !/@property\s+--left/.test(CSS));
check('--top/--left 不在 transition 列表里',
  !/transition[^;}]*--top/.test(frostBody) && !/transition[^;}]*--left/.test(frostBody));
check('洞的四个量仍然可插值（换卡时洞滑过去）',
  ['--fx', '--fy', '--fw', '--fh'].every(v => new RegExp('@property\\s+' + v + '\\b').test(CSS)) &&
  /transition[^;}]*--fx/.test(frostBody));
check('.blk.focus 的抬起幅度已收到克制档（<=6px，<=1.06 倍）', (() => {
  const b = declOf('.blk.focus');
  const dy = Number(/translate3d\(\s*0\s*,\s*-(\d+(?:\.\d+)?)px/.exec(b)?.[1] ?? 999);
  const sc = Number(/--pop-lift:\s*(\d+(?:\.\d+)?)/.exec(b)?.[1] ?? 9);
  return dy <= 6 && sc <= 1.06;
})());

// 距离失焦：逐卡各自算，指针压着谁谁最清晰，越远越虚
check('文字节点按 --blur 做距离失焦', hasDecl('.blk-name', /filter\s*:\s*blur\(var\(--blur/));
// --blur 必须直接是长度：试过「JS 给系数 + CSS calc(系数*.4px)」，
// 实测 Chromium 下算不出长度、filter 恒为 blur(0px)，整个效果失效，已回退。
check('--blur 注册为 <length>（不能用 <number> 交给 calc 换算）',
  /@property\s+--blur\s*\{[^}]*syntax:\s*'<length>'/.test(CSS));
check('--blur 不可继承（每张卡各自持有，不能共用一个值）',
  /@property\s+--blur\s*\{[^}]*inherits:\s*false/.test(CSS));
check('filter 不经过 calc（calc 那条路走不通）',
  !/filter\s*:\s*blur\(calc\(/.test(CSS));
check('失焦上限已被确认可感知，且不失控（0.5~0.8px）', (() => {
  const m = /BLUR_MAX\s*=\s*([\d.]+)/.exec(code);
  const v = m ? Number(m[1]) : 0;
  return v >= .5 && v <= .8;
})());
check('失焦只加在文字上，卡片本身不套 filter（保住卡片边界）',
  !/(?<!-webkit-)filter\s*:/.test(declOf('.blk')));
check('命中卡豁免失焦（.blk.focus 下文字 filter:none）',
  hasDecl('.blk.focus .blk-name', /filter\s*:\s*none/));
check('JS 逐卡写 --blur，且带 px 单位（长度直接可用）', (() => {
  const perEl = /item\.el\.style\.setProperty\('--blur',\s*v\.toFixed\(3\)\s*\+\s*'px'\)/.test(code);
  const notGlobal = !/gridEl\.style\.setProperty\('--blur'/.test(code);
  return perEl && notGlobal;
})());
check('JS 按每张卡自己的距离算失焦（用该卡中心，不是"到最近卡"的最小值）', (() => {
  const body = /function applyBlur[\s\S]*?\n  \}/.exec(code)?.[0] || '';
  return /item\.l \+ item\.w \/ 2 - clientX/.test(body) && !/let d = 1e9/.test(body);
})());
check('有逐卡变化阈值，避免每帧全量重算样式', /<\s*\.01/.test(code));
check('指针离开课表时逐卡清零', /function clearBlur/.test(code) && /clearBlur\(\)/.test(code));
check('重绘课表时丢弃逐卡记账（resetBlur 钩子）',
  /let resetBlur = null/.test(code) && /if \(resetBlur\) resetBlur\(\)/.test(code));

// 翻周入场：整块 innerHTML 换掉太生硬，改成错峰淡入
check('有翻周入场动画 blk-fade-in', /@keyframes\s+blk-fade-in/.test(CSS));
check('入场动画只碰 opacity / translateY，不碰倾斜用的 --rx/--ry',
  (() => {
    const m = /@keyframes\s+blk-fade-in\s*\{([\s\S]*?)\n\}/.exec(CSS);
    const kf = m ? m[1] : '';
    return /opacity/.test(kf) && /translateY/.test(kf) && !/--rx|--ry|--sh/.test(kf);
  })());
check('错峰延迟按 --i 递增，且有上限（免得多课时最后一张等太久）',
  /\.kb\.entering\s+\.blk\s*\{[^}]*animation-delay:\s*calc\(min\(var\(--i[\s\S]{0,40}?\*\s*\d+ms\)/.test(CSS));
check('入场动画遵守 reduce-motion', (() => {
  const i = CSS.indexOf('.kb.entering .blk');
  if (i < 0) return false;
  return /prefers-reduced-motion[\s\S]{0,120}?\.kb\.entering\s+\.blk\s*\{\s*animation:\s*none/.test(CSS.slice(i));
})());
check('JS 只在"重建"时挂 entering，首次渲染不挂', (() => {
  const body = /function playEntrance[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /dataset\.painted/.test(body) && /if \(firstPaint\) return/.test(body) &&
    /classList\.add\('entering'\)/.test(body) && /classList\.remove\('entering'\)/.test(body);
})());
// 断言"同一函数体内两行紧邻"是在测代码格式，不是测行为 —— 中间插一句就假红。
// 改为在 renderGrid 函数体内检查调用与赋值确实存在。
const renderGridBody = /function renderGrid[\s\S]*?\n\}/.exec(code)?.[0] || '';
check('renderGrid 里接上了 playEntrance',
  /grid\.innerHTML = html;/.test(renderGridBody) && /playEntrance\(grid\);/.test(renderGridBody));
// 快切不该把动画"催快"，但窗口也不能比动画长，否则会"隔一次跳一次"
check('入场有时间窗，窗口内重建不重放动画', (() => {
  const body = /function playEntrance[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /enteringUntil/.test(body) && /if \(now < enteringUntil\)/.test(body) &&
    /grid\.classList\.remove\('entering'\);\s*\n\s*return;/.test(body);
})());
check('重放窗口 <= 一段入场的实际长度（否则会每隔一次空跳）', (() => {
  const m = /const\s+ENTER_REPLAY_MS\s*=\s*(\d+)/.exec(code);
  const dur = Number(/(\d+)ms\s+var\(--ease\)\s+backwards/.exec(CSS)?.[1] ?? 0);
  const step = Number(/\*\s*(\d+)ms\)/.exec(CSS)?.[1] ?? 0);
  const cap = Number(/min\(var\(--i,\s*\d+\),\s*(\d+)\)/.exec(CSS)?.[1] ?? 0);
  if (!m || !dur || !step || !cap) return false;
  return Number(m[1]) <= dur + step * cap;
})());
check('摘类时长 >= 最坏情况（单张 + 步长×封顶）', (() => {
  const m = /const\s+ENTER_SETTLE_MS\s*=\s*(\d+)/.exec(code);
  const dur = Number(/(\d+)ms\s+var\(--ease\)\s+backwards/.exec(CSS)?.[1] ?? 0);
  const step = Number(/\*\s*(\d+)ms\)/.exec(CSS)?.[1] ?? 0);
  const cap = Number(/min\(var\(--i,\s*\d+\),\s*(\d+)\)/.exec(CSS)?.[1] ?? 0);
  if (!m || !dur || !step || !cap) return false;
  return Number(m[1]) >= dur + step * cap;
})());
check('两个时间量是分开的常量（别合并成一个）',
  /const\s+ENTER_REPLAY_MS/.test(code) && /const\s+ENTER_SETTLE_MS/.test(code));

// 切周按钮的反馈
check('切周按钮有按下态（压感）', /\.week-nav\s+\.wk-btn:active\s*\{[^}]*background/.test(CSS));
check('按下态用 .week-nav .wk-btn:active 压过透明底（不然不生效）',
  /\.week-nav\s+\.wk-btn\s*\{[^}]*background:\s*transparent/.test(CSS) &&
  /\.week-nav\s+\.wk-btn:active/.test(CSS));
check('箭头有朝前 / 朝后两个方向的推动画',
  /@keyframes\s+wk-nudge-fwd/.test(CSS) && /@keyframes\s+wk-nudge-back/.test(CSS));
check('往前翻箭头往右、往回翻往左（方向不能反）', (() => {
  const fwd = /@keyframes\s+wk-nudge-fwd\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  const back = /@keyframes\s+wk-nudge-back\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  const val = (s) => {
    const m = /translateX\(\s*(-?[\d.]+)px\s*\)/.exec(s);
    return m ? Number(m[1]) : 0;
  };
  return val(fwd) > 0 && val(back) < 0;
})());
check('中间的"第 N 周"也按方向滑入', /\.wk-now\.fx-fwd/.test(CSS) && /\.wk-now\.fx-back/.test(CSS));
check('JS 按方向选按钮和类名（回退走 prev + back 分支）', (() => {
  const body = /function playWeekFx[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /dir === 'back' \? 'prevWeek' : 'nextWeek'/.test(body) &&
    /dir === 'back' \? 'wk-nudge-back' : 'wk-nudge'/.test(body) &&
    /dir === 'back' \? 'fx-back' : 'fx-fwd'/.test(body);
})());
check('JS 先摘类再挂（连着点同一侧动画要能重播）', (() => {
  const body = /function playWeekFx[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /classList\.remove\('wk-nudge', 'wk-nudge-back'\)/.test(body) &&
    /void btn\.offsetWidth/.test(body);
})());
check('方向由新旧周比较得出（前进 / 回退）',
  /const\s+dir\s*=\s*w\s*>=\s*curWeek\s*\?\s*'fwd'\s*:\s*'back'/.test(code));
check('切周反馈遵守 reduce-motion',
  /prefers-reduced-motion[\s\S]{0,200}?\.wk-btn\.wk-nudge[\s\S]{0,120}?animation:\s*none/.test(CSS));

// 箭头换成强调色
check('切周箭头用强调色，且声明在透明底规则之后（否则被盖）', (() => {
  const i = CSS.indexOf('.week-nav .wk-btn {');
  const j = CSS.indexOf('.week-nav .wk-btn { color:');
  return i >= 0 && j > i && /color:\s*var\(--accent\)/.test(CSS.slice(j, j + 60));
})());

// 点课程：按下缩、按住停、松手回弹，然后才弹详情
check('点课程抽成 pressDown / pressRelease / pressCancel 三个入口',
  /function pressDown/.test(code) && /function pressRelease/.test(code) && /function pressCancel/.test(code));
check('弹详情等回弹播完再开（否则详情卡盖上来，回弹看不见）', (() => {
  const body = /function pressRelease[\s\S]*?\n\}/.exec(code)?.[0] || '';
  // 延迟用的是常量 BOUNCE_MS，别把数字写死进正则
  const m = /setTimeout\(\(\) => openSlot\([^)]*\),\s*BOUNCE_MS\)/.exec(body);
  const b = /const\s+BOUNCE_MS\s*=\s*(\d+)/.exec(code);
  // CSS 时长写成 .3s，要按秒解析再换算成毫秒
  const rel = /\.blk\.release\s*\{[^}]*\}/.exec(CSS)?.[0] || '';
  const sm = /([\d.]+)s\s+var\(--ease\)/.exec(rel);
  const dur = sm ? Number(sm[1]) * 1000 : 0;
  return !!m && !!b && dur > 0 && Number(b[1]) >= dur;
})());
// 这条是实机 bug 换来的：按压曾经挂在 click 上，而 click 是鼠标【松开】才触发，
// 于是按下去毫无反应、松手才开始动，回弹又被紧接着弹出的详情盖掉。
check('按压挂在 pointerdown 上（挂 click 会变成"松开才动"）', (() => {
  const down = /addEventListener\('pointerdown'[\s\S]{0,200}?pressDown\(/.test(code);
  const up = /addEventListener\('pointerup',\s*pressRelease\)/.test(code);
  const cancel = /addEventListener\('pointercancel',\s*pressCancel\)/.test(code);
  return down && up && cancel;
})());
check('按住期间最低点由 .press 类维持（不依赖动画自己跑）',
  /function pressDown[\s\S]{0,200}?classList\.add\('press'\)/.test(code));
check('拖出卡片算取消，不弹详情', /addEventListener\('pointerout'/.test(code) &&
  /relatedTarget/.test(code) && /pressCancel\(\)/.test(code));
check('键盘路径不弹详情前先压一下（tap 动画）',
  /function openSlotByKey[\s\S]{0,240}?classList\.add\('tap'\)/.test(code));
check('减少动态效果时跳过整套按压', (() => {
  const down = /function pressDown[\s\S]*?\n\}/.exec(code)?.[0] || '';
  const byKey = /function openSlotByKey[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /reduce-motion/.test(down) && /reduce-motion/.test(byKey);
})());
check('键盘走独立入口，没有绕过按压路径', (() => {
  const key = /addEventListener\('keydown',[\s\S]{0,260}?openSlotByKey\(el\)/.test(code);
  return key && /function openSlotByKey/.test(code);
})());

// 动画播完才能切周
check('切周有动画锁，锁定时长是常量', /const\s+WEEK_LOCK_MS\s*=\s*\d+/.test(code) &&
  /function isWeekLocked/.test(code));
check('重建课表时刷新锁（锁跟着动画走）',
  /weekLockUntil = Date\.now\(\) \+ WEEK_LOCK_MS;/.test(renderGridBody));
check('锁定时按钮请求被记下来而不是直接切', (() => {
  const body = /function requestWeek[\s\S]*?\n\}/.exec(code)?.[0] || '';
  return /if \(isWeekLocked\(\)\) \{ pendingWeek = w; return; \}/.test(body);
})());
check('松手就丢掉未处理的待切请求（不做延迟追赶）',
  /addEventListener\('mouseup'[\s\S]{0,60}?weekBtnHeld = false/.test(code) &&
  /if \(!weekBtnHeld \|\| pendingWeek === null\) return;/.test(code));
check('锁只约束按钮，键盘与刻度尺仍即时跳转', (() => {
  const btns = /\$\('prevWeek'\)\.addEventListener\('click', \(\) => requestWeek/.test(code) &&
    /\$\('nextWeek'\)\.addEventListener\('click', \(\) => requestWeek/.test(code);
  const ruler = /const btn = ev\.target\.closest\('\[data-week\]'\);[\s\S]{0,80}?goWeek\(Number\(btn\.dataset\.week\)\)/.test(code);
  return btns && ruler;
}));

// 课程卡配色与按压回弹
// 只取两个调色板数组本身来断言 —— 注释里也会提到旧色值，全局搜会误报
const paletteSrc = (() => {
  const i = code.indexOf('const PALETTE = [');
  const j = code.indexOf('const PALETTE_DARK = [');
  return code.slice(i, code.indexOf('];', j));
})();
check('课程卡配色是 8 组、浅深各一套', (() => {
  const grab = (name) => {
    const i = code.indexOf('const ' + name + ' = [');
    if (i < 0) return [];
    return [...code.slice(i, code.indexOf('];', i)).matchAll(/'#[0-9a-f]{6}'/g)].map(m => m[0]);
  };
  return grab('PALETTE').length === 16 && grab('PALETTE_DARK').length === 16;
})());
check('配色里不再有会跟纸面糊在一起的暖灰（旧的 #e7e5e0）',
  !/#e7e5e0/i.test(paletteSrc));
check('8 组底色互不相同（换了配色不能撞色）', (() => {
  const bgs = [...paletteSrc.matchAll(/'#[0-9a-f]{6}'/g)].map(m => m[0]);
  const light = bgs.filter((_, k) => k % 2 === 0);
  return new Set(light).size === light.length;
})());
check('--pop-press 注册为可插值，并接到独立 scale 属性上', (() => {
  return /@property\s+--pop-press\s*\{[^}]*syntax:\s*'<number>'/.test(CSS) &&
    /scale:\s*var\(--pop-press/.test(declOf('.blk'));
})());
check('按压没有再直接写 transform（否则会盖掉倾斜角）', (() => {
  const body = declOf('.blk.press');
  return !/transform\s*:/.test(body);
})());
// 这条是实机 bug 换来的：缩放曾经塞进 .blk 的 transform 链，结果被
// .blk.focus 那条带 !important 的 transform 顶掉，按下去纹丝不动
// （而鼠标点的永远正是悬停那张卡）。改成独立 scale 属性后不受它影响。
check('按下用独立 scale 属性，而不是往 transform 链里塞（否则被 .blk.focus 顶掉）', (() => {
  const i = CSS.indexOf('.blk.press { --pop-press');
  const j = CSS.indexOf('scale: var(--pop-press');
  return i >= 0 && j > 0 && j > i;
})());
check('按住就是最低点：最低点由 .press 类维持，不是自动跑完的 keyframes', (() => {
  const body = declOf('.blk.press');
  return /--pop-press:\s*\.9/.test(body) && !/animation/.test(body);
})());
check('松手有回弹（过冲到 >1 再落回）', (() => {
  const kf = /@keyframes\s+blk-release\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1] || '';
  const vals = [...kf.matchAll(/--pop-press:\s*([\d.]+)/g)].map(m => Number(m[1]));
  return vals.length >= 3 && Math.min(...vals) < 1 && Math.max(...vals) > 1;
})());
check('按压动画遵守 reduce-motion', (() => {
  const i = CSS.indexOf('.blk.press { --pop-press');
  return i >= 0 && /prefers-reduced-motion[\s\S]{0,300}?\.blk\.release[\s\S]{0,60}?animation:\s*none/.test(CSS.slice(i));
})());

console.log(pass ? '\n全部通过' : '\n存在失败项');
process.exit(pass ? 0 : 1);
