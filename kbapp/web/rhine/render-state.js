/*
 * 移植自 RhineLabUI src/render-state.ts（950 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
class RenderState {
  values = [];
  cursor = 0;
  changed = true;
  begin() {
    this.cursor = 0;
  }
  add(...values) {
    for (const value of values) {
      if (this.values[this.cursor] !== value) this.changed = true;
      this.values[this.cursor++] = value;
    }
  }
  floats(...values) {
    this.add(...values.map((value) => value === void 0 ? void 0 : Math.fround(value)));
  }
  end() {
    const changed = this.changed || this.values.length !== this.cursor;
    this.values.length = this.cursor;
    this.changed = false;
    return changed;
  }
  invalidate() {
    this.changed = true;
  }
}
export {
  RenderState
};
