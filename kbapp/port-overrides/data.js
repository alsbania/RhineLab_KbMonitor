/**
 * data.js —— 改写版（放在 kbapp/port-overrides/，由 port-rhine.mjs 优先取用）
 *
 * 上游 src/data.ts 从 content/archives.json 读 40 份虚构档案，并把它们
 * 按五个栏目分列。KbMonitor 没有档案，有的是课表；但阵列的编排逻辑
 * （列宽 COLUMN_SPACING、行距 ROW_SPACING、每列 8 份、行坐标 = 12 + 列内序号）
 * 完全依赖这个数据形状，所以这里保持**接口逐行一致**，只换数据来源。
 *
 * 对应关系：
 *   上游 archiveColumns  五类档案        -> KbMonitor 周一…周五
 *   上游 records         40 份档案       -> 当周课程
 *   上游 columnFiles(l)  该列档案索引    -> 该天的课程索引
 *   上游 fileLocation(i) 档案的行列坐标  -> 同一套坐标公式，原样保留
 *
 * 课程数据由宿主调用 setRecords() 注入（见 scene-host.js），
 * 避免这个模块去 import 应用层的 app.js。
 */

/** @type {Array<{id:string,title:string,en:string,department:string,category:string,date:string,lead:string,clearance:string,abstract:string,findings:string[],source:string}>} */
export let records = [];

/** 栏目名。上游由 JSON 提供，这里是课表的七天。 */
export const categories = ['全部课表', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 阵列的列 = 一周七天。
 *
 * 曾经只有周一到周五，两个后果都是坏的：
 *   1. 周六 / 周日的课 category 不在表里，fileLocation 的 indexOf 得到 -1，
 *      lane 变成 -1、slot 变成负数，那份课在阵列里根本摆不出来；
 *   2. 某一天一节课都没有时（很常见：导入的课表、没排课的那天），
 *      fileAtCell 会从空列里取出 undefined，fileLocation(undefined) 读
 *      .category 直接抛 TypeError —— 点一下卡片就崩。
 * 七列都在表里，这两种情况就都不存在了。
 * 列数变了不影响别的：selectionCell 等一律按 archiveColumns.length 取模，
 * 而循环池 LOOP_COLUMNS = 9 够宽。
 */
export const archiveColumns = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 注入课程。宿主在每次课表变化后调用。 */
export function setRecords(list) {
  records = Array.isArray(list) ? list : [];
}

/**
 * 同一列（同一天）内的课程索引。
 * 与上游逐行一致：按 category 过滤后取原始下标。
 */
export function columnFiles(lane) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}

/**
 * 课程的行列坐标。上游这里是 `12 + 列内序号`，行 12 是阵列的基准行 ——
 * 阵列纵向留出 12 行作为「上方余量」，循环池 32 行，所以 12 不能改。
 */
export function fileLocation(index) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}

/** 与 fileLocation 互逆。越界时钳到该列最后一份，与上游一致。 */
export function fileAtSlot(slot) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
