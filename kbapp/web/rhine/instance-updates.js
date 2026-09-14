/*
 * 移植自 RhineLabUI src/instance-updates.ts（1274 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
class InstanceUpdates {
  first = Infinity;
  last = -1;
  attribute;
  constructor(attribute) {
    this.attribute = attribute;
  }
  set(offset, values) {
    const array = this.attribute.array;
    for (let j = 0; j < values.length; j++) {
      const i = offset + j, value = Math.fround(values[j]);
      if (array[i] === value) continue;
      array[i] = value;
      this.first = Math.min(this.first, i);
      this.last = Math.max(this.last, i);
    }
  }
  scalar(offset, value) {
    value = Math.fround(value);
    if (this.attribute.array[offset] === value) return;
    this.attribute.array[offset] = value;
    this.first = Math.min(this.first, offset);
    this.last = Math.max(this.last, offset);
  }
  commit() {
    if (this.last < 0) return false;
    this.attribute.addUpdateRange(this.first, this.last - this.first + 1);
    this.attribute.needsUpdate = true;
    this.first = Infinity;
    this.last = -1;
    return true;
  }
}
export {
  InstanceUpdates
};
