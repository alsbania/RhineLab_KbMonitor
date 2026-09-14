/**
 * asset-url.js —— 改写版（放在 kbapp/port-overrides/）
 *
 * 上游 src/asset-url.ts 依赖两个 Vite 构建期常量：
 *   import.meta.env.PROD / BASE_URL   —— Vite 注入
 *   __RHINE_MODELS__                  —— scripts/export-records.mjs 注入的模型哈希表
 * 这两样在 KbMonitor 里都不存在（没有构建链，pywebview 直接以 file:// 加载）。
 *
 * 这里保持同名同签名，但换一套「把模型带进来」的办法：
 *
 *   file:// 下 Chromium 禁止 fetch/XHR（只放行经典脚本与样式表），
 *   GLTFLoader 取 .glb 必然被 CORS 拦掉：
 *       Access to fetch at 'file://…/archive-cassette.glb' from origin 'null'
 *       has been blocked by CORS policy
 *
 *   所以模型由 kbapp/build-models.py 转成 base64 内联的经典脚本
 *   （vendor/models/archive-cassette.js），这里再把它包成 data: URL ——
 *   GLTFLoader 对 data: URL 走的是 fetch 的 data 方案，不受 file:// 限制。
 *
 * 若模型脚本没加载（例如单独打开某个调试页），退回相对路径，
 * 便于在 HTTP 服务下调试。
 */
const MODEL_MIME = 'model/gltf-binary';

const assetUrl = (path) => {
  const key = String(path).replace(/^\//, '');          // assets/archive-cassette.glb
  const name = key.split('/').pop();                    // archive-cassette.glb
  const table = (typeof window !== 'undefined' && window.__RHINE_MODELS__) || null;
  const entry = table && table[name];

  if (entry && entry.base64) {
    return `data:${entry.mime || MODEL_MIME};base64,${entry.base64}`;
  }

  // 兜底：相对当前页面解析（HTTP 调试用）
  return new URL(key, document.baseURI).href;
};

export { assetUrl };
