/*
 * 移植自 RhineLabUI src/archive-play-motion.ts（5629 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const quietBands = () => ({ low: 0, mid: 0, high: 0, activity: 0 });
class SpectrumEnvelope {
  bands = quietBands();
  target = quietBands();
  received = -Infinity;
  audible = -Infinity;
  localSoundUntil = -Infinity;
  ignoreLocalSound(until) {
    if (Number.isFinite(until)) this.localSoundUntil = Math.max(this.localSoundUntil, until);
  }
  ingest(samples, time) {
    if (samples.length !== 128) return;
    if (time <= this.localSoundUntil && this.bands.activity < 0.1) return;
    const band = (start, end) => {
      let energy = 0;
      for (let i = start; i < end; i++) {
        const l = Number.isFinite(samples[i]) ? clamp(samples[i]) : 0;
        const r = Number.isFinite(samples[i + 64]) ? clamp(samples[i + 64]) : 0;
        energy += (l * l + r * r) / 2;
      }
      return Math.sqrt(energy / (end - start));
    };
    this.target = { low: band(0, 8), mid: band(8, 32), high: band(32, 64), activity: 0 };
    this.received = time;
    if (Math.max(this.target.low, this.target.mid, this.target.high) > 0.012) this.audible = time;
  }
  update(dt, time, enabled) {
    const fresh = enabled && time - this.received < 0.5;
    for (const key of ["low", "mid", "high"]) {
      const target = fresh ? this.target[key] : 0;
      const rate = target > this.bands[key] ? 16 : 3.2;
      this.bands[key] += (target - this.bands[key]) * (1 - Math.exp(-Math.min(dt, 0.1) * rate));
    }
    const active = fresh && time - this.audible < 1.5 ? 1 : 0;
    this.bands.activity += (active - this.bands.activity) * (1 - Math.exp(-Math.min(dt, 0.1) * (active ? 3 : 1.5)));
    return { ...this.bands };
  }
}
function musicDisplacement(row, lane, time, bands, strength) {
  const bass = bands.low * 0.8 * (0.5 + 0.5 * Math.sin(row * 0.29 - lane * 0.5 - time * 2.7));
  const middle = bands.mid * 0.48 * (0.5 + 0.5 * Math.sin(row * 0.72 + lane * 0.9 - time * 4.3));
  const treble = bands.high * 0.18 * Math.pow(Math.max(0, Math.sin(row * 1.7 - lane * 2.2 - time * 6.4)), 4);
  return clamp((bass + middle + treble) * clamp(strength, 0, 2), 0, 1.8);
}
class RelayRound {
  status = "idle";
  score = 0;
  target = null;
  remaining = 0;
  total = 0;
  reason = "";
  start() {
    this.status = "preparing";
    this.score = 0;
    this.target = null;
    this.remaining = 0.8;
    this.reason = "";
  }
  stop() {
    this.status = "idle";
    this.target = null;
    this.remaining = 0;
  }
  aim(target, pace) {
    this.target = target;
    this.status = "playing";
    const base = pace === "gentle" ? 8 : pace === "quick" ? 4 : 6;
    this.total = this.remaining = Math.max(base * 0.55, base - this.score * 0.12);
  }
  tick(dt, paused) {
    if (paused || this.status !== "playing" && this.status !== "preparing") return;
    this.remaining = Math.max(0, this.remaining - Math.max(0, dt));
    if (this.status === "playing" && this.remaining === 0) this.finish("\u8FD9\u9053\u6CE2\u7EB9\u505C\u4E0B\u4E86");
  }
  hit(target) {
    if (this.status !== "playing") return false;
    if (target !== this.target) {
      this.finish("\u63A5\u529B\u7ED3\u675F");
      return false;
    }
    this.score++;
    this.status = "preparing";
    this.target = null;
    this.remaining = 0.28;
    return true;
  }
  finish(reason) {
    this.status = "over";
    this.target = null;
    this.reason = reason;
  }
}
class RhythmMotion {
  weights = { legacy: 1, wave: 0, lift: 0 };
  update(_bands, _time, dt, style) {
    for (const key of ["legacy", "wave", "lift"]) this.weights[key] += ((style === key ? 1 : 0) - this.weights[key]) * (1 - Math.exp(-clamp(dt, 0, 0.1) * 5));
    return { style: { ...this.weights } };
  }
}
function rhythmDisplacement(row, lane, time, bands, strength, frame, x = 0.5) {
  x = clamp(x);
  const smooth = (v) => v * v * (3 - 2 * v);
  const right = smooth(clamp((x - 0.5) * 2));
  const left = 1 - smooth(clamp(x * 2));
  const middle = 1 - left - right;
  const spectrum = bands.low * left + bands.mid * middle + bands.high * right;
  const wave = spectrum * (0.72 + 0.28 * Math.sin(row * 0.32 - time * 2.2)) * 0.95;
  const flow = bands.low * 0.62 * (0.55 + 0.45 * Math.sin(row * 0.22 + lane * 0.18 - time * 1.8)) + bands.mid * 0.42 * (0.55 + 0.45 * Math.sin(row * 0.38 - lane * 0.27 - time * 2.8)) + bands.high * 0.28 * (0.55 + 0.45 * Math.sin(row * 0.62 + lane * 0.4 - time * 4.1));
  return musicDisplacement(row, lane, time, bands, strength) * frame.style.legacy + (frame.style.wave * wave + frame.style.lift * flow) * clamp(strength, 0, 2);
}
export {
  RelayRound,
  RhythmMotion,
  SpectrumEnvelope,
  musicDisplacement,
  quietBands,
  rhythmDisplacement
};
