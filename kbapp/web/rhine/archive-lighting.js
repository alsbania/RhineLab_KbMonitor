/*
 * 移植自 RhineLabUI src/archive-lighting.ts（1273 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
function createArchiveLighting(renderer, scene, look = "baseline") {
  const refined = look === "refined";
  renderer.toneMappingExposure = refined ? 1 : 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = refined ? 0.52 : 0.48;
  scene.add(
    new THREE.HemisphereLight(
      "#fffaf5",
      refined ? "#b49b80" : "#b4a18c",
      refined ? 0.5 : 0.65
    )
  );
  const key = new THREE.DirectionalLight(
    refined ? "#fff4e5" : "#fff7ed",
    refined ? 1.7 : 1.4
  );
  key.position.set(
    ...refined ? [-8, 14, 4] : [-6, 14, -5]
  );
  const fill = new THREE.DirectionalLight("#ffffff", refined ? 0.3 : 0.6);
  fill.position.set(7, 8, -10);
  scene.add(key, fill);
  return key;
}
export {
  createArchiveLighting
};
