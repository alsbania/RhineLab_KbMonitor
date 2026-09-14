/*
 * 移植自 RhineLabUI src/viewport-layout.ts（1856 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
function openingLayout(width, height) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const scale = Math.min(height / 1080, width / 1280);
  return { width: width / scale, height: height / scale, scale, kind: "opening" };
}
function viewportLayout(width, height, coarse, cinematic = false) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  if (cinematic) return {
    width: 1920,
    height: 1080,
    scale: Math.min(width / 1920, height / 1080),
    kind: "cinematic"
  };
  const portrait = width / height < 1.05;
  const compact = portrait || width < 1100 || coarse && height < 600;
  const scale = compact ? 1 : height / 1080;
  return {
    width: width / scale,
    height: height / scale,
    scale,
    kind: portrait ? "portrait" : compact ? "compact" : "desktop"
  };
}
function archiveFraming(width, height, span, detail, compact) {
  const aspect = width / height;
  const portrait = aspect < 1.05;
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(6.3 / aspect, 3.7 * height / Math.max(100, 0.54 * height - 156));
  const viewSpan = portrait ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail) : Math.max(baseSpan, baseSpan * (16 / 9) / aspect);
  return {
    span: viewSpan,
    portrait,
    // Portrait selection is deliberately above its title and navigation.
    previewY: portrait ? 0.36 : 0.5,
    detailX: portrait ? 0.5 : compact ? 0.27 : 550 / 1920,
    detailY: portrait ? 0.27 + 34 / height : compact ? 0.49 : 560 / 1080
  };
}
export {
  archiveFraming,
  openingLayout,
  viewportLayout
};
