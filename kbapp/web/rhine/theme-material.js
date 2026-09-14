/*
 * 移植自 RhineLabUI src/theme-material.ts（4276 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
import * as THREE from "three";
const surfaces = {
  Frosted_Polymer: "#626b70",
  Ivory_Edges: "#687277",
  Optical_Diffuser: "#192226",
  Titanium_Fasteners: "#b1b9bb",
  Index_Inlay: "#c6a36b",
  Printed_Label: "#303a3e",
  Subsurface_Optics: "#939e9f",
  Optical_Edges: "#bbc3bc",
  Carbon_Ink: "#b6bdb8"
};
function themeMaterial(material, name, instanced = false, subduedIndex = { value: 0 }) {
  const amount = { value: 0 };
  const before = material.onBeforeCompile;
  const cache = material.customProgramCacheKey.bind(material)();
  const color = new THREE.Color(surfaces[name] ?? (name.includes("Orange") ? "#bb8850" : "#969f9f"));
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.rhineTheme = amount;
    shader.uniforms.rhineDarkSurface = { value: color };
    shader.uniforms.rhineSubduedIndex = subduedIndex;
    if (instanced) {
      shader.vertexShader = "attribute float archiveTheme; varying float vRhineTheme;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvRhineTheme = archiveTheme;");
      shader.fragmentShader = "varying float vRhineTheme;\n" + shader.fragmentShader;
    }
    shader.fragmentShader = "uniform float rhineTheme; uniform vec3 rhineDarkSurface; uniform float rhineSubduedIndex;\n" + shader.fragmentShader;
    const mix = instanced ? "vRhineTheme" : "rhineTheme";
    const printed = name === "Printed_Canvas";
    const anchor = printed ? "#include <opaque_fragment>" : "#include <roughnessmap_fragment>";
    const dark = printed ? "mix(vec3(0.023, 0.032, 0.037), vec3(0.78, 0.78, 0.71), 1.0 - smoothstep(0.12, 0.65, dot(diffuseColor.rgb, vec3(.2126,.7152,.0722))))" : name === "Frosted_Polymer" && !instanced ? "mix(rhineDarkSurface, vec3(0.92, 0.96, 0.97), glassRevealAtHeight(archiveClarity, vArchiveHeight))" : name === "Index_Inlay" ? "mix(rhineDarkSurface, vec3(0.030, 0.042, 0.048), rhineSubduedIndex)" : "rhineDarkSurface";
    const output = printed ? "outgoingLight" : "diffuseColor.rgb";
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `${output} = mix(${output}, ${dark}, ${mix});
${anchor}`);
  };
  material.customProgramCacheKey = () => `${cache}-rhine-theme-${name}-${instanced}`;
  return amount;
}
const scenes = /* @__PURE__ */ new WeakMap();
const background = new THREE.Color("#11181b"), floorColor = new THREE.Color("#192125"), mistColor = new THREE.Color("#263136");
function themeEnvironment(scene, renderer, amount) {
  let baseline = scenes.get(scene);
  if (!baseline) {
    const lights = [];
    scene.traverse((object) => {
      if (object instanceof THREE.Light) lights.push({ light: object, intensity: object.intensity });
    });
    const floor = scene.getObjectByName("archive-floor");
    const material = floor?.material;
    baseline = {
      background: scene.background.clone(),
      fog: scene.fog?.color.clone(),
      intensity: scene.environmentIntensity,
      exposure: renderer.toneMappingExposure,
      lights,
      floor: material ? { material, color: material.color.clone() } : void 0
    };
    scenes.set(scene, baseline);
  }
  scene.background.copy(baseline.background).lerp(background, amount);
  if (scene.fog && baseline.fog) scene.fog.color.copy(baseline.fog).lerp(mistColor, amount);
  if (baseline.floor) baseline.floor.material.color.copy(baseline.floor.color).lerp(floorColor, amount);
  scene.environmentIntensity = THREE.MathUtils.lerp(baseline.intensity, 0.32, amount);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(baseline.exposure, 0.98, amount);
  for (const { light, intensity } of baseline.lights) light.intensity = intensity * (1 - 0.35 * amount);
}
export {
  themeEnvironment,
  themeMaterial
};
