/**
 * 把「移植过来的 RhineLabUI 阵列」打成 bundle。
 *
 * 产物 rhine.global.js 是一个 IIFE 经典脚本，暴露全局 RHINE：
 *   RHINE.ArchiveScene   —— 移植自 src/scene.ts 的编排类
 *   RHINE.RhineArray     —— KbMonitor 侧的宿主封装
 *   RHINE.coursesToRecords / RHINE.data —— 数据适配与调试入口
 *   RHINE.motion / RHINE.archiveDrag / RHINE.archiveLoop —— 纯逻辑，便于自检
 *
 * 走 bundle 而不是「浏览器原生 ESM + 改写导入路径」的原因：
 *   pywebview 以 file:// 加载，Chromium 在 file:// 下禁止 module import；
 *   打包成经典脚本既绕过这个限制，也让 addons 的解析在构建期就确定下来。
 *
 *   node kbapp/build-rhine.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync, writeFileSync, existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WEB = join(HERE, 'web');
const SRC = join(ROOT, 'vendor', 'three-src');
const OUT = join(WEB, 'vendor', 'rhine.global.js');

const posix = (p) => p.replace(/\\/g, '/');

/**
 * 解析裸导入 `three` 与 `three/addons/...`。
 *
 * 不能用 esbuild 的 alias —— 它是**前缀匹配**，会把 `three/addons/xxx.js`
 * 也改写成 `…/three.module.js/addons/xxx.js`。用插件精确匹配两个前缀：
 *   three                     -> vendor/three-src/three.module.js
 *   three/addons/<rest>       -> vendor/three-src/addons/<rest>
 */
const threeResolver = {
  name: 'three-resolver',
  setup(b) {
    b.onResolve({ filter: /^three(\/.*)?$/ }, (args) => {
      if (args.path === 'three') {
        return { path: join(SRC, 'three.module.js') };
      }
      const rest = args.path.slice('three/'.length);          // addons/postprocessing/xxx.js
      const mapped = join(SRC, rest);
      if (existsSync(mapped)) return { path: mapped };
      return { errors: [{ text: `找不到 three 子路径：${args.path}（已试 ${mapped}）` }] };
    });
  },
};

const entry = `
import * as THREE from ${JSON.stringify(posix(join(SRC, 'three.module.js')))};
import { ArchiveScene } from ${JSON.stringify(posix(join(WEB, 'rhine', 'scene.js')))};
import { RhineArray, coursesToRecords } from ${JSON.stringify(posix(join(WEB, 'rhine-scene-host.js')))};

// 纯逻辑原样透出，方便在浏览器里逐条核对（与源码逐行一致）
import * as motion from ${JSON.stringify(posix(join(WEB, 'rhine', 'motion.js')))};
import * as archiveDrag from ${JSON.stringify(posix(join(WEB, 'rhine', 'archive-drag.js')))};
import * as archiveLoop from ${JSON.stringify(posix(join(WEB, 'rhine', 'archive-loop.js')))};
import * as dataApi from ${JSON.stringify(posix(join(WEB, 'rhine', 'data.js')))};
import * as rolling from ${JSON.stringify(posix(join(WEB, 'rhine-rolling.js')))};
// 画质档位：宿主侧要用同一份参数，避免两处各写一套
import { qualityPresets, normalizeQuality, matchingPreset, presetLabels } from ${JSON.stringify(posix(join(WEB, 'rhine', 'render-quality.js')))};

// 注：kbapp/web/ivory-viewer.js（课程详情里的三维象牙牌）目前不接入。
// 用户明确不要课表侧的 3D 检视，文件保留在仓库里，需要时把下面两行加回来即可。
// import { IvoryViewer } from ${JSON.stringify(posix(join(WEB, 'ivory-viewer.js')))};

export {
  THREE, ArchiveScene, RhineArray, coursesToRecords,
  motion, archiveDrag, archiveLoop, dataApi, rolling,
  qualityPresets, normalizeQuality, matchingPreset, presetLabels
};
`;

const banner = `/*!
 * RhineLabUI 档案阵列 —— 移植版 bundle
 * 由 kbapp/build-rhine.mjs 生成：three.js r183 + 移植的 scene.ts 及其依赖。
 * 上游许可 MIT（RhineLabUI / three.js）。
 * 打包成经典脚本是因为 pywebview 以 file:// 加载页面，无法使用 ES module。
 */`;

const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'RHINE',
  platform: 'browser',
  target: ['chrome110'],
  minify: false,
  legalComments: 'none',
  banner: { js: banner },
  plugins: [threeResolver],
  outfile: OUT,
  logLevel: 'warning',
  metafile: true,
});

const size = statSync(OUT).size;
writeFileSync(
  join(WEB, 'vendor', 'rhine.manifest.json'),
  JSON.stringify(
    {
      name: 'rhine-archive-array',
      source: 'RhineLabUI src/scene.ts 及其依赖（kbapp/port-rhine.mjs 逐行移植）',
      builtBy: 'kbapp/build-rhine.mjs',
      format: 'iife（经典脚本，暴露全局 RHINE）',
      exposes: ['THREE', 'ArchiveScene', 'RhineArray', 'coursesToRecords',
        'motion', 'archiveDrag', 'archiveLoop', 'dataApi', 'rolling'],
      bytes: size,
      inputs: Object.keys(result.metafile.inputs).length,
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `rhine.global.js 已生成：${(size / 1024).toFixed(1)} KB（${Object.keys(result.metafile.inputs).length} 个输入模块）`,
);
