/*
 * 移植自 RhineLabUI src/render-quality.ts（3971 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
const qualityPresets = {
  performance: {
    scale: 80,
    pixelRatio: 1,
    antialias: "off",
    shadows: 1024,
    aoSamples: 0,
    aoResolution: 0.5,
    depthOfField: 0,
    transmission: 0.5,
    anisotropy: 4
  },
  original: {
    scale: 100,
    pixelRatio: 1.5,
    antialias: "off",
    shadows: 2048,
    aoSamples: 32,
    aoResolution: 1,
    depthOfField: 100,
    transmission: 1,
    anisotropy: 16
  },
  high: {
    scale: 125,
    pixelRatio: 2,
    antialias: "smaa",
    shadows: 4096,
    aoSamples: 32,
    aoResolution: 1,
    depthOfField: 100,
    transmission: 1,
    anisotropy: 16
  },
  ultra: {
    scale: 150,
    pixelRatio: 2,
    antialias: "smaa",
    shadows: 4096,
    aoSamples: 64,
    aoResolution: 1,
    depthOfField: 100,
    transmission: 1,
    anisotropy: 16
  }
};
const presetLabels = {
  performance: "\u6027\u80FD",
  original: "\u539F\u59CB",
  high: "\u9AD8",
  ultra: "\u6781\u9AD8"
};
const member = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const range = (value, min, max, step, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value / step) * step)) : fallback;
function normalizeQuality(value, legacyHigh = true) {
  const base = qualityPresets.original;
  const v = value && typeof value === "object" ? value : {};
  const fallback = legacyHigh ? base : { ...base, pixelRatio: 1, aoSamples: 0, depthOfField: 0 };
  return {
    scale: range(v.scale, 50, 200, 5, fallback.scale),
    pixelRatio: member(v.pixelRatio, [1, 1.5, 2, 3], fallback.pixelRatio),
    antialias: member(
      v.antialias,
      ["off", "smaa"],
      fallback.antialias
    ),
    shadows: member(v.shadows, [0, 1024, 2048, 4096], fallback.shadows),
    aoSamples: member(v.aoSamples, [0, 16, 32, 64], fallback.aoSamples),
    aoResolution: member(v.aoResolution, [0.5, 0.75, 1], fallback.aoResolution),
    depthOfField: range(v.depthOfField, 0, 150, 5, fallback.depthOfField),
    transmission: member(
      v.transmission,
      [0.25, 0.5, 0.75, 1],
      fallback.transmission
    ),
    anisotropy: member(v.anisotropy, [1, 2, 4, 8, 16], fallback.anisotropy)
  };
}
function matchingPreset(quality) {
  return Object.keys(qualityPresets).find(
    (key) => Object.entries(qualityPresets[key]).every(
      ([field, value]) => quality[field] === value
    )
  ) ?? "custom";
}
function renderDimensions(quality, width, height, stageScale, deviceRatio, maxTextureSize, pixelBudget = 8294400) {
  const requested = Math.min(deviceRatio, quality.pixelRatio) * stageScale * quality.scale / 100;
  const ratio = Math.min(
    requested,
    Math.sqrt(pixelBudget / Math.max(1, width * height)),
    maxTextureSize / Math.max(1, width, height)
  );
  return {
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
    limited: ratio < requested - 1e-4
  };
}
export {
  matchingPreset,
  normalizeQuality,
  presetLabels,
  qualityPresets,
  renderDimensions
};
