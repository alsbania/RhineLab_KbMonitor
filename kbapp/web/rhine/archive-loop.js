/*
 * 移植自 RhineLabUI src/archive-loop.ts（2454 字节）
 * 由 kbapp/port-rhine.mjs 用 esbuild 剥类型生成 —— 逻辑与源码逐行一致，请勿手改。
 * 要改行为请改上游源码后重新移植，或在 kbapp/port-overrides/ 下放改写版。
 */
import { archiveColumns, columnFiles, fileLocation } from "./data.js";
const LOOP_COLUMNS = 9;
const LOOP_ROWS = 32;
const COLUMN_SPACING = 5.2;
const ROW_SPACING = 0.62;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];
function wrap(value, count) {
  return (value % count + count) % count;
}
function nearestOccurrence(value, center, period) {
  return value + Math.floor((center - value + period / 2) / period) * period;
}
function fileAtCell({ lane, row }) {
  const files = columnFiles(wrap(lane, archiveColumns.length));
  return files[wrap(row - 12, files.length)];
}
function selectionCell(index, current, navigation) {
  if (navigation && "cell" in navigation) return { ...navigation.cell };
  const next = fileLocation(index);
  const row = nearestOccurrence(
    next.row,
    current.row,
    columnFiles(next.lane).length
  );
  if (navigation?.axis === "row") {
    return { lane: current.lane, row: current.row + navigation.direction };
  }
  return {
    lane: navigation?.axis === "lane" ? current.lane + navigation.direction : nearestOccurrence(next.lane, current.lane, archiveColumns.length),
    row
  };
}
function poolCell(index) {
  return {
    lane: POOL_LANES[Math.floor(index / LOOP_ROWS)],
    row: index % LOOP_ROWS
  };
}
function visibleCell(index, center) {
  return {
    lane: nearestOccurrence(
      POOL_LANES[Math.floor(index / LOOP_ROWS)],
      center.lane,
      LOOP_COLUMNS
    ),
    row: nearestOccurrence(index % LOOP_ROWS, center.row, LOOP_ROWS)
  };
}
function cellKey(cell) {
  return `${cell.lane}:${cell.row}`;
}
function sameCell(a, b) {
  return a.lane === b.lane && a.row === b.row;
}
export {
  COLUMN_SPACING,
  LOOP_COLUMNS,
  LOOP_ROWS,
  ROW_SPACING,
  cellKey,
  fileAtCell,
  nearestOccurrence,
  poolCell,
  sameCell,
  selectionCell,
  visibleCell,
  wrap
};
