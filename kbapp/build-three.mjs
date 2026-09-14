/**
 * 把 vendored 的 three.js 与移植过来的 RhyneLabUI 场景，打成单个「经典脚本」。
 *
 * 为什么要打包：
 *   · three 0.183 只提供 ESM；
 *   · KbMonitor 的页面由 pywebview 以 file:// 加载，Chromium 在 file:// 下
 *     禁止 ES module 的 import（CORS），所以不能用 <script type="module">；
 *   · 因此必须产出 IIFE 经典脚本，用普通 <script> 加载。
 *
 * addons 清单不写死 —— 直接扫描 kbapp/web/rhine/*.js 里出现的
 * `three/addons/...` 裸导入，自动加入打包入口，避免漏包。
 *
 *   node kbapp/build-three.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { statSync, writeFileSync, readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'vendor', 'three-src');
const ADDONS = join(SRC, 'addons');
const RHINE = join(HERE, 'web', 'rhine');
const OUT = join(HERE, 'web', 'vendor', 'three.global.js');

/* ------------------------------------------------ 1. 同步用到的 three addons -- */

/** 从移植代码里扫出所有 `three/addons/...` 导入 */
function scanAddons() {
  const found = new Set();
  if (!existsSync(RHINE)) return found;
  for (const f of readdirSync(RHINE).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(join(RHINE, f), 'utf8');
    for (const m of text.matchAll(/from\s+["']three\/addons\/([^"']+)["']/g)) found.add(m[1]);
  }
  return found;
}

/** 把三个包 examples/jsm 下的文件复制到 vendor，保持目录结构 */
function copyAddon(rel) {
  const from = join(PKG_JSM, rel);
  const to = join(ADDONS, rel);
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  // addon 自己的相对依赖也要一起复制
  const text = readFileSync(from, 'utf8');
  for (const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const dep = join(dirname(rel), m[1]).replace(/\\/g, '/');
    copyAddon(dep);
  }
  return true;
}

// three 包解出来的 examples/jsm 位置。
// 2026-09-14 清理：原本默认指向 ROOT/.tmp/package/examples/jsm —— 依赖一个临时解包目录，
// .tmp 一删这条链就断（且报错信息只说"找不到 addons"，不会告诉你缺的是解包目录）。
// 现改为 vendor/three-jms，与 vendor/three-src 并排，同为 vendored 依赖。
// 若已装了 node_modules/three，仍可用 THREE_JSM 覆盖。
const PKG_JSM = process.env.THREE_JSM || join(ROOT, 'vendor', 'three-jms');
const needs = scanAddons();
mkdirSync(ADDONS, { recursive: true });

// RoomEnvironment 是 archive-lighting 直接引的，确保在内
needs.add('environments/RoomEnvironment.js');

const copied = [];
const missing = [];
for (const rel of needs) (copyAddon(rel) ? copied : missing).push(rel);
if (missing.length) {
  console.error('以下 addons 在 three 包里找不到：\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log(`three addons 已同步 ${copied.length} 个：${copied.map((c) => c.split('/').pop()).join(', ')}`);

/* ------------------------------------------------------------ 2. 打包入口 -- */

const posix = (p) => p.replace(/\\/g, '/');
const entry = [
  `export * from ${JSON.stringify(posix(join(SRC, 'three.module.js')))};`,
  ...copied.map((rel) => {
    const name = rel.split('/').pop().replace(/\.js$/, '');
    return `export { ${name} } from ${JSON.stringify(posix(join(ADDONS, rel)))};`;
  }),
].join('\n');

const banner = `/*!
 * three.js r183 + 所用 addons —— 由 kbapp/build-three.mjs 从 vendor/three-src 打包。
 * 许可：MIT，见 vendor/three-src/LICENSE。
 * 打包成经典脚本是因为 pywebview 以 file:// 加载页面，无法使用 ES module。
 */`;

const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'THREE',
  platform: 'browser',
  target: ['chrome110'],
  minify: false,
  legalComments: 'none',
  banner: { js: banner },
  alias: { three: join(SRC, 'three.module.js') },
  outfile: OUT,
  logLevel: 'warning',
  metafile: true,
});

/* ---------------------------------------------------------------- 3. 报告 -- */

const size = statSync(OUT).size;
writeFileSync(
  join(HERE, 'web', 'vendor', 'three.manifest.json'),
  JSON.stringify(
    {
      name: 'three',
      version: '0.183.0',
      license: 'MIT',
      source: 'vendor/three-src（取自 npm three@0.183.0）',
      builtBy: 'kbapp/build-three.mjs',
      format: 'iife（经典脚本，暴露全局 THREE）',
      addons: copied,
      bytes: size,
      inputs: Object.keys(result.metafile.inputs).length,
    },
    null,
    2,
  ) + '\n',
);

console.log(
  `three.global.js 已生成：${(size / 1024).toFixed(1)} KB（${Object.keys(result.metafile.inputs).length} 个输入模块）`,
);
