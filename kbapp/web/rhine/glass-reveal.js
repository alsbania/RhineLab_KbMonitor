/*
 * 移植自 RhineLabUI src/glass-reveal.ts（2248 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
const FEATHER = 0.12;
const FROSTED_ROUGHNESS = 0.42;
const CLEAR_ROUGHNESS = 0.025;
const FROST_SPAN = 0.016;
function frostedTransmissionLod(panelPixels, textureWidth, roughness, quality = 1, ior = 1.46) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const strength = clamp((roughness - CLEAR_ROUGHNESS) / (FROSTED_ROUGHNESS - CLEAR_ROUGHNESS));
  const native = Math.log2(textureWidth) * roughness * clamp(ior * 2 - 2);
  const clearLod = Math.log2(textureWidth) * CLEAR_ROUGHNESS * clamp(ior * 2 - 2);
  const bounded = Math.log2(Math.max(2 ** clearLod, panelPixels * FROST_SPAN * Math.pow(strength, 1.15)));
  return native + (Math.min(native, bounded) - native) * quality;
}
const frostedTransmissionGLSL = `
float archiveTransmissionLod(float roughness, float ior, vec2 samplerSize) {
  float nativeLod = log2(samplerSize.x) * roughness * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float strength = clamp((roughness - ${CLEAR_ROUGHNESS}) / ${FROSTED_ROUGHNESS - CLEAR_ROUGHNESS}, 0.0, 1.0);
  float panelPixels = length(vArchiveProjectedAxis * samplerSize);
  float clearLod = log2(samplerSize.x) * ${CLEAR_ROUGHNESS} * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  float boundedLod = log2(max(exp2(clearLod), panelPixels * ${FROST_SPAN} * pow(strength, 1.15)));
  return mix(nativeLod, min(nativeLod, boundedLod), archiveQuality);
}`;
function glassRevealAtHeight(progress, height) {
  const edge = 1 - (1 + 2 * FEATHER) * Math.max(0, Math.min(1, progress));
  const x = Math.max(
    0,
    Math.min(1, (Math.max(0, Math.min(1, height)) - edge) / (2 * FEATHER))
  );
  return x * x * (3 - 2 * x);
}
const glassRevealGLSL = `
float glassRevealAtHeight(float progress, float height) {
  float edge = 1.0 - ${1 + 2 * FEATHER} * clamp(progress, 0.0, 1.0);
  return smoothstep(edge, edge + ${2 * FEATHER}, clamp(height, 0.0, 1.0));
}`;
export {
  CLEAR_ROUGHNESS,
  FROSTED_ROUGHNESS,
  frostedTransmissionGLSL,
  frostedTransmissionLod,
  glassRevealAtHeight,
  glassRevealGLSL
};
