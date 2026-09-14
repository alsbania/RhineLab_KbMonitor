/**
 * 把 RhineLabUI 的 TypeScript 源码逐行移植成浏览器可直接用的 JavaScript。
 *
 * 为什么要有这个脚本：
 *   手工重写会抄错（第一版就把 smooth() 的三次平滑写成了源码的五次平滑）。
 *   这里用 esbuild 剥离类型注解 —— 只做「类型 → 无类型」的机械转换，
 *   函数体、常量、注释全部原样保留，避免人手引入偏差。
 *
 * 只做两件事实换：
 *   1. 剥类型（esbuild loader=ts）
 *   2. 相对导入补 .js 扩展名、去掉 `with { type: "json" }`
 * 其余一律不动。产物头部标注来源文件，方便回溯核对。
 *
 * 少数与应用强耦合或需要改写的文件，放在 port-overrides/ 下，
 * 由本脚本直接取用（例如 data.ts 依赖档案 JSON，这里要换成课表数据）。
 *
 *   node kbapp/port-rhine.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// 源项目就在 kbapp\RhineLabUI-main（2026-09-14 由用户剪切过来），
// 也可用 RHINE_SRC 环境变量指向别处。
const SRC = process.env.RHINE_SRC || join(HERE, 'RhineLabUI-main', 'src');
const OUT = join(HERE, 'web', 'rhine');
const OVERRIDES = join(HERE, 'port-overrides');
const CHECK = process.argv.includes('--check');

/** 要移植的文件，按依赖顺序排列（先底层后编排）。 */
const FILES = [
  // 纯逻辑：零依赖
  'motion.ts',
  'archive-drag.ts',
  'theme-motion.ts',
  'archive-play-motion.ts',
  'render-quality.ts',
  'glass-reveal.ts',
  'decryption.ts',
  // 数据与循环
  'data.ts',
  'archive-loop.ts',
  // 资源与状态
  'three-resources.ts',
  'render-state.ts',
  'instance-updates.ts',
  'archive-visibility.ts',
  'asset-url.ts',
  'brand.ts',
  'viewport-layout.ts',
  // 材质、光照与后处理
  'theme-material.ts',
  'archive-lighting.ts',
  'internal-optics.ts',
  'appearance.ts',
  'shared-depth.ts',
  'quality-renderer.ts',
  // 编排层（最大，最后搬）
  'scene.ts',
];

const HEADER = (name, bytes) =>
  `/*\n * 移植自 RhineLabUI src/${name}（${bytes} 字节）\n` +
  ` * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。\n` +
  ` * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。\n` +
  ` */\n`;

async function portOne(name) {
  const override = join(OVERRIDES, name.replace(/\.ts$/, '.js'));
  if (existsSync(override)) {
    return { name, code: readFileSync(override, 'utf8'), from: 'override' };
  }

  const path = join(SRC, name);
  if (!existsSync(path)) return { name, error: `源文件不存在: ${path}` };

  const source = readFileSync(path, 'utf8');
  const result = await transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'chrome110',
    // 保留注释（源码注释是理解行为的关键）
    legalComments: 'inline',
  });

  let code = result.code;

  // 相对导入统一补 .js 扩展名。
  // 注意源码里写的是 `from "./data.ts"` —— .ts 也算"有扩展名"，
  // 但它指向 TypeScript 源文件，必须改写成 .js，否则解析不到。
  code = code.replace(
    /(\bfrom\s*["'])(\.\.?\/[^"']+?)(["'])/g,
    (m, head, spec, tail) => {
      if (/\.tsx?$/.test(spec)) return `${head}${spec.replace(/\.tsx?$/, '.js')}${tail}`;
      if (/\.[a-z]+$/i.test(spec)) return m;      // 已有 .js / .json 等
      return `${head}${spec}.js${tail}`;
    },
  );
  // JSON 导入断言在浏览器里不支持；data.ts 走 override，这里兜底去掉
  code = code.replace(/\s*with\s*\{\s*type:\s*["']json["']\s*\}/g, '');

  return { name, code: HEADER(name, source.length) + code, from: 'esbuild' };
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const results = [];
  for (const name of FILES) results.push(await portOne(name));

  const failed = results.filter((r) => r.error);
  for (const r of results) {
    if (r.error) continue;
    const dest = join(OUT, r.name.replace(/\.ts$/, '.js'));
    if (CHECK) {
      const same = existsSync(dest) && readFileSync(dest, 'utf8') === r.code;
      console.log(`${same ? '同步' : '待更新'}  ${r.name}  (${r.from})`);
    } else {
      writeFileSync(dest, r.code);
      console.log(`移植  ${r.name.padEnd(24)} -> rhine/${basename(dest)}  (${r.from}, ${(r.code.length / 1024).toFixed(1)} KB)`);
    }
  }

  if (failed.length) {
    console.error('\n以下文件未能移植：');
    for (const f of failed) console.error(`  ${f.name}: ${f.error}`);
    process.exit(1);
  }

  const count = readdirSync(OUT).filter((f) => f.endsWith('.js')).length;
  console.log(`\n共 ${count} 个模块在 kbapp/web/rhine/`);
}

await main();
