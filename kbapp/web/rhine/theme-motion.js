/*
 * 移植自 RhineLabUI src/theme-motion.ts（1491 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
const key = (cell) => `${cell.lane}:${cell.row}`;
const ease = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
class ThemeWave {
  target = 0;
  start = -10;
  origin = { row: 12, lane: 2 };
  from = /* @__PURE__ */ new Map();
  latest = /* @__PURE__ */ new Map();
  backgroundFrom = 0;
  set(dark, time, origin, immediate = false) {
    const target = dark ? 1 : 0;
    if (target === this.target && !immediate) return;
    this.backgroundFrom = immediate ? target : this.background(time);
    this.from = immediate ? /* @__PURE__ */ new Map() : new Map(this.latest);
    this.target = target;
    this.start = immediate ? time - 10 : time;
    this.origin = { ...origin };
  }
  background(time) {
    return this.backgroundFrom + (this.target - this.backgroundFrom) * ease((time - this.start) / 0.85);
  }
  beginFrame() {
    this.latest.clear();
  }
  sample(cell, time) {
    const delay = Math.min(0.6, Math.abs(cell.row - this.origin.row) * 0.034 + Math.abs(cell.lane - this.origin.lane) * 0.11);
    const from = this.from.get(key(cell)) ?? this.backgroundFrom;
    const value = from + (this.target - from) * ease((time - this.start - delay) / 0.58);
    this.latest.set(key(cell), value);
    return value;
  }
}
export {
  ThemeWave
};
