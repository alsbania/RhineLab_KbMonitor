/**
 * 滚动文字 / 滚动编号
 *
 * 复刻 RhineLabUI 用 @kitlangton/rolling-number 的 createRollingText 做的那套：
 *   · 460ms 定长
 *   · 各字同时启动（stagger: none），不是逐字延迟
 *   · 文字固定向上滚；编号按导航方向滚
 *   · 过渡中途垂直模糊 0.2，停稳恢复清晰
 *   · 宽度跟随同一套布局弹簧，长中文换短中文时宽度平滑过渡
 *   · 连续快速替换从当前可见位置接续，不排队补播中间值
 *   · 减少动态效果时直接落定
 *
 * 这里用等宽数字（tabular-nums）+ 固定槽位保证编号不抖；文字用测量宽度。
 */

const DURATION = 460;
const BLUR = 0.2;
/** 临界阻尼弹簧，与原实现 damp() 同式 */
function stepSpring(s, target, rate, dt) {
  const delta = s.value - target;
  const impulse = s.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  s.value = target + (delta + impulse * dt) * decay;
  s.velocity = (s.velocity - rate * impulse * dt) * decay;
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const reduced = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 把一个元素变成滚动槽。原地保留可访问语义文字（screen reader 只读一份）。
 *
 * @param {HTMLElement} host  承载元素（会被清空并重建内部结构）
 * @param {{direction?: 1|-1}} [opts]  direction 1 = 向上滚（默认），-1 = 向下
 */
export function createRollingText(host, opts = {}) {
  const direction = opts.direction === -1 ? -1 : 1;

  host.classList.add('rt');
  host.innerHTML = '';
  const viewport = document.createElement('span');
  viewport.className = 'rt-view';
  const track = document.createElement('span');
  track.className = 'rt-track';
  const a = document.createElement('span');
  a.className = 'rt-cell';
  const b = document.createElement('span');
  b.className = 'rt-cell';
  track.append(a, b);
  viewport.append(track);
  const sr = document.createElement('span');
  sr.className = 'rt-sr';
  host.append(viewport, sr);

  let current = '';        // 正在显示的完整文字
  let target = '';         // 最新目标
  let raf = 0;
  let start = 0;
  let baseWidth = 0;
  let live = false;

  const measure = (text) => {
    const probe = document.createElement('span');
    probe.className = 'rt-cell rt-probe';
    probe.textContent = text || ' ';
    viewport.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };

  function finish(text) {
    current = target = text;
    a.textContent = text;
    b.textContent = '';
    track.style.transform = 'translateY(0)';
    track.style.filter = 'none';
    viewport.style.width = '';
    sr.textContent = text;
    live = false;
  }

  function frame(now) {
    const t = Math.min(1, (now - start) / DURATION);
    const e = easeOut(t);
    // 旧的一格往上走、新的一格从下方顶上
    const shift = -direction * e * 100;
    track.style.transform = `translateY(${shift}%)`;
    // 中段最糊，两端清晰
    const blur = BLUR * Math.sin(Math.PI * t);
    track.style.filter = blur > 0.002 ? `blur(0px, ${(blur * 6).toFixed(2)}px)` : 'none';

    if (t < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      finish(target);
    }
  }

  return {
    /** 设置目标文字。相同内容不重复播放。 */
    set(text) {
      text = String(text == null ? '' : text);
      if (text === target) return;
      if (text === current && !live) return;
      sr.textContent = text;

      if (reduced() || !current) {
        cancelAnimationFrame(raf);
        finish(text);
        return;
      }

      cancelAnimationFrame(raf);
      // 从当前可见位置接续：旧格吃掉当下显示的内容，新格放目标
      const showing = live ? a.textContent : current;
      target = text;
      a.textContent = showing;
      b.textContent = text;
      track.style.transform = 'translateY(0)';
      viewport.style.width = Math.max(measure(showing), measure(text)) + 'px';
      live = true;
      start = performance.now();
      raf = requestAnimationFrame(frame);
    },
    get value() {
      return target;
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}

/**
 * 编号滚动：固定前缀 + 补零数字，按方向滚动。
 * 用 tabular-nums 保证等宽，数字变化时不会左右抖。
 */
export function createRollingNumber(host, opts = {}) {
  const pad = opts.pad ?? 0;
  const prefix = opts.prefix ?? '';
  const roll = createRollingText(host, opts);
  return {
    set(value) {
      const n = Number(value);
      const body = Number.isFinite(n)
        ? (pad ? String(Math.abs(Math.trunc(n))).padStart(pad, '0') : String(Math.trunc(n)))
        : String(value);
      roll.set(prefix + body);
    },
    get value() {
      return roll.value;
    },
    destroy: roll.destroy,
  };
}
