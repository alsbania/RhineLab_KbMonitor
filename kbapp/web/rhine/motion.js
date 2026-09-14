/*
 * 移植自 RhineLabUI src/motion.ts（4307 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (10 + t * (-15 + 6 * t));
};
const bell = (x, width) => Math.exp(-0.5 * (x / width) ** 2);
function archiveWave(row, lane, time) {
  const t = time - 22;
  const phase = row + (lane - 2) * 0.65;
  const enter = smooth(t / 0.32);
  const first = 3 + t * 19;
  const returning = 32 - (t - 2.3) * 24;
  const packet = (distance) => 2.5 * bell(distance, 3.8) - 0.58 * bell(distance - 6, 3.5);
  return enter * (packet(phase - first) * (1 - smooth((t - 2.15) / 0.65)) + packet(phase - returning) * smooth((t - 2.17) / 0.32) * (1 - smooth((t - 3.5) / 0.85)));
}
function extraction(time) {
  return 0.4 * smooth((time - 25.58) / 0.82) + 2.95 * smooth((time - 27.55) / 1.3);
}
function settlingWave(distance, time) {
  const age = time - 25.05 - Math.abs(distance) * 0.065;
  const envelope = Math.max(
    -0.42,
    2.15 - 0.17 * (Math.sqrt(distance * distance + 1) - 1)
  );
  const rise = smooth(age / 0.62);
  const ring = age > 0 ? Math.sin(age * 5.1) * Math.exp(-age * 1.3) : 0;
  return envelope * (rise + 0.18 * ring * smooth(age / 0.16));
}
function baselineSelectionWave(distance, age) {
  if (age < 0 || age > 3.2) return 0;
  return 0.8 * smooth(age / 0.2) * Math.exp(-age * 1.15) * Math.cos((distance - age * 8) * 0.58) * bell(distance - age * 8, 3.4);
}
function selectionWave(distance, age) {
  return Math.max(0, baselineSelectionWave(distance, age));
}
function rippleEnvelope(distance, age) {
  return smooth(distance / 2.5) * Math.max(0, Math.cos((distance - age * 8) * 0.58));
}
function columnStrength(lane, focus, progress = 1) {
  const selected = 0.25 + 0.75 * bell(lane - focus, 0.55);
  return 1 + (selected - 1) * smooth(progress);
}
function idleWave(row, lane, time) {
  return 0.075 * Math.sin(time * Math.PI * 2 / 8 + row * 0.3 - lane * 0.45) + 0.027 * Math.sin(time * Math.PI * 2 / 13 - row * 0.17 + lane * 0.3);
}
function cinematicField(row, lane, time, center = 12, focus = 2) {
  const handoff = smooth((time - 24.95) / 0.45);
  const selection = smooth((time - 25.4) / 0.95);
  const shoulderTime = time + 0.3 * handoff * (1 - selection);
  return archiveWave(row, lane, time) * (1 - handoff) + settlingWave(row - center, shoulderTime) * columnStrength(lane, focus, (time - 25.4) / 0.95);
}
const INSPECTION_LIFT = 4.05;
const ALIGNMENT_EPSILON = 1e-3;
function returnStep(angle, dt, reduced = false) {
  const next = angle * Math.exp(-dt * (reduced ? 35 : 7));
  return Math.abs(next) <= ALIGNMENT_EPSILON ? 0 : next;
}
function damp(s, target, rate, dt) {
  const delta = s.value - target;
  const impulse = s.velocity + rate * delta;
  const decay = Math.exp(-rate * dt);
  s.value = target + (delta + impulse * dt) * decay;
  s.velocity = (s.velocity - rate * impulse * dt) * decay;
}
export {
  ALIGNMENT_EPSILON,
  INSPECTION_LIFT,
  archiveWave,
  baselineSelectionWave,
  cinematicField,
  columnStrength,
  damp,
  extraction,
  idleWave,
  returnStep,
  rippleEnvelope,
  selectionWave,
  settlingWave,
  smooth
};
