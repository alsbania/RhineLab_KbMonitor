/*
 * 移植自 RhineLabUI src/archive-drag.ts（5541 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
class ArchiveDrag {
  active = false;
  moved = false;
  value = { lane: 0, row: 0 };
  x = 0;
  y = 0;
  inverse = null;
  samples = [];
  lastMotion = -Infinity;
  motionDirection = { x: 0, y: 0 };
  pointer = { x: 0, y: 0 };
  start(x, y, projection, time = 0) {
    this.active = false;
    this.moved = false;
    this.x = x;
    this.y = y;
    this.value = { lane: 0, row: 0 };
    this.samples = [{ value: this.value, time }];
    this.lastMotion = -Infinity;
    this.motionDirection = { x: 0, y: 0 };
    this.pointer = { x, y };
    const { lane, row } = projection;
    const determinant = lane.x * row.y - row.x * lane.y;
    const area = Math.hypot(lane.x, lane.y) * Math.hypot(row.x, row.y);
    this.inverse = Number.isFinite(area) && area > 0 && Math.abs(determinant) > area * 1e-3 ? {
      lane: { x: row.y / determinant, y: -row.x / determinant },
      row: { x: -lane.y / determinant, y: lane.x / determinant }
    } : null;
  }
  move(x, y, time) {
    const dx = x - this.x, dy = y - this.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 7) this.moved = true;
    if (!this.inverse || !this.active && distance < 10) return;
    this.active = true;
    const value = {
      lane: dx * this.inverse.lane.x + dy * this.inverse.lane.y,
      row: dx * this.inverse.row.x + dy * this.inverse.row.y
    };
    const previous = this.samples.at(-1);
    if (previous) {
      const delta = { x: x - this.pointer.x, y: y - this.pointer.y };
      if (Math.hypot(delta.x, delta.y) > 1e-9) {
        this.lastMotion = time;
        if (delta.x * this.motionDirection.x + delta.y * this.motionDirection.y < 0)
          this.samples = [previous];
        this.motionDirection = delta;
      }
    }
    this.pointer = { x, y };
    this.value = value;
    if (previous?.time === time)
      this.samples[this.samples.length - 1] = { value, time };
    else this.samples.push({ value, time });
    this.samples = this.samples.filter((sample) => time - sample.time <= 120).slice(-32);
  }
  /** Actual release velocity in both tracks, in cells/second. */
  releaseVelocity(time, reduced) {
    const first = this.samples[0], last = this.samples.at(-1);
    if (reduced || !first || !last || time - this.lastMotion > 80 || last.time - first.time < 8)
      return { lane: 0, row: 0 };
    const scale = 1e3 / (last.time - first.time);
    return {
      lane: (last.value.lane - first.value.lane) * scale,
      row: (last.value.row - first.value.row) * scale
    };
  }
}
class ArchiveMomentum {
  value;
  velocity;
  phase;
  target;
  friction = 2.4;
  constructor(value, velocity) {
    this.value = value;
    this.velocity = velocity;
    this.phase = Math.abs(velocity) >= 0.75 ? "coasting" : "snapping";
    this.target = Math.round(value);
  }
  step(dt, coasting = this.phase === "coasting") {
    if (coasting) {
      const decay = Math.exp(-this.friction * dt);
      this.value += this.velocity * (1 - decay) / this.friction;
      this.velocity *= decay;
      if (Math.abs(this.velocity) < 0.6) {
        this.target = Math.round(this.value + this.velocity / this.friction);
        this.phase = "snapping";
      }
    } else if (this.phase === "snapping") {
      const rate = 10;
      const delta = this.value - this.target;
      const impulse = this.velocity + rate * delta;
      const decay = Math.exp(-rate * dt);
      this.value = this.target + (delta + impulse * dt) * decay;
      this.velocity = (this.velocity - rate * impulse * dt) * decay;
      if (Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 5e-3) {
        this.value = this.target;
        this.velocity = 0;
        this.phase = "idle";
      }
    }
  }
}
class ArchivePlaneMomentum {
  lane;
  row;
  constructor(value, velocity) {
    this.lane = new ArchiveMomentum(value.lane, velocity.lane);
    this.row = new ArchiveMomentum(value.row, velocity.row);
  }
  get phase() {
    return this.lane.phase === "coasting" || this.row.phase === "coasting" ? "coasting" : this.lane.phase === "idle" && this.row.phase === "idle" ? "idle" : "snapping";
  }
  get value() {
    return { lane: this.lane.value, row: this.row.value };
  }
  get velocity() {
    return { lane: this.lane.velocity, row: this.row.velocity };
  }
  step(dt) {
    const coasting = this.phase === "coasting";
    this.lane.step(dt, coasting);
    this.row.step(dt, coasting);
  }
}
export {
  ArchiveDrag,
  ArchiveMomentum,
  ArchivePlaneMomentum
};
