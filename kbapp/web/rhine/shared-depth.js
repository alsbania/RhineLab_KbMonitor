/*
 * 移植自 RhineLabUI src/shared-depth.ts（4631 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
import * as THREE from "three";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
class SharedDepthAO extends SSAOPass {
  packed;
  sharing = true;
  savedColor = new THREE.Color();
  depthClear = new Float32Array([1, 1, 1, 1]);
  constructor(scene, camera, width, height, kernel = 32) {
    super(scene, camera, width, height, kernel);
    this.packed = this.normalRenderTarget.texture.clone();
    this.packed.name = "Archive.packedDepth";
    this.normalRenderTarget.textures.push(this.packed);
    this.normalMaterial.onBeforeCompile = (shader) => {
      if (!this.sharing) return;
      shader.vertexShader = "varying vec2 vArchiveZW;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\nvArchiveZW = gl_Position.zw;");
      shader.fragmentShader = "varying vec2 vArchiveZW;\nlayout(location = 1) out vec4 archivePackedDepth;\n#include <packing>\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", "void main() {\narchivePackedDepth = packDepthToRGBA(0.5 * vArchiveZW.x / vArchiveZW.y + 0.5);");
    };
    this.normalMaterial.customProgramCacheKey = () => `archive-normal-packed-depth-v1-${this.sharing}`;
  }
  setSharing(enabled) {
    if (enabled === this.sharing) return;
    this.normalRenderTarget.dispose();
    this.sharing = enabled;
    this.normalRenderTarget.textures.length = 1;
    if (enabled) this.normalRenderTarget.textures.push(this.packed);
    this.normalMaterial.needsUpdate = true;
  }
  _renderOverride(renderer, material, target, color, alpha) {
    renderer.getClearColor(this.savedColor);
    const savedAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    const override = this.scene.overrideMaterial;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    renderer.setClearColor(color, alpha);
    renderer.clear();
    const gl = renderer.getContext();
    if (this.sharing) gl.clearBufferfv(gl.COLOR, 1, this.depthClear);
    this.scene.overrideMaterial = material;
    try {
      renderer.render(this.scene, this.camera);
    } finally {
      this.scene.overrideMaterial = override;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.savedColor, savedAlpha);
    }
  }
}
class SharedDepthBokeh extends BokehPass {
  constructor(scene, camera, params, source) {
    super(scene, camera, params);
    this.source = source;
    this.quad = new FullScreenQuad(this.materialBokeh);
  }
  source;
  width = 1;
  height = 1;
  quad;
  setSize(width, height) {
    super.setSize(width, height);
    this.width = width;
    this.height = height;
  }
  render(renderer, write, read, delta, mask) {
    const ao = this.source(), uniforms = this.uniforms;
    if (!ao.enabled || ao.width !== this.width || ao.height !== this.height) {
      return super.render(renderer, write, read, delta, mask);
    }
    const originalDepth = uniforms.tDepth.value;
    uniforms.tDepth.value = ao.normalRenderTarget.textures[1];
    uniforms.tColor.value = read.texture;
    uniforms.nearClip.value = this.camera.near;
    uniforms.farClip.value = this.camera.far;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    if (!this.renderToScreen) renderer.clear();
    try {
      this.quad.render(renderer);
    } finally {
      uniforms.tDepth.value = originalDepth;
      renderer.autoClear = autoClear;
    }
  }
  dispose() {
    super.dispose();
    this.quad.dispose();
  }
}
export {
  SharedDepthAO,
  SharedDepthBokeh
};
