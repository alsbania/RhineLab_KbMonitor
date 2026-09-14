/*
 * 移植自 RhineLabUI src/internal-optics.ts（2054 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
import * as THREE from "three";
const surfaces = {
  Optical_Glass_Body: {
    color: "#929894",
    roughness: 0.38,
    opacity: 0.27,
    order: 20
  },
  Optical_Glass_Roof: {
    color: "#929b94",
    roughness: 0.34,
    opacity: 0.42,
    order: 24
  },
  Optical_Glass_Edge: {
    color: "#edf0e7",
    roughness: 0.19,
    opacity: 0.9,
    order: 28
  },
  Optical_Bridge_Glass: {
    color: "#a0aca2",
    roughness: 0.32,
    opacity: 0.36,
    order: 26
  }
};
function configureInternalOptics(name, mat) {
  const surface = surfaces[name];
  if (!surface) return;
  mat.color.set(surface.color);
  mat.roughness = surface.roughness;
  mat.metalness = 0.015;
  mat.clearcoat = 0.42;
  mat.clearcoatRoughness = 0.24;
  mat.opacity = surface.opacity;
  mat.transmission = 0;
  mat.transparent = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.depthWrite = false;
  mat.side = THREE.FrontSide;
  mat.userData.opticalOrder = surface.order;
}
function internalOpticsFragment(source) {
  return source.replace(
    "#include <opaque_fragment>",
    `diffuseColor.a = min(0.86, opacity + 0.42 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0));
     #include <opaque_fragment>`
  );
}
export {
  configureInternalOptics,
  internalOpticsFragment
};
