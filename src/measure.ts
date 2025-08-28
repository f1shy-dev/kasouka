import type { Column, MeasureResult } from "./types.ts";
import type { DataSource } from "./datasource";

export function estimateDataSourceWidths(
  ctx: CanvasRenderingContext2D,
  columns: Column[],
  ds: DataSource,
  font: string,
  sampleTop = 64,
  sampleBottom = 64,
  padding = 16,
  maxColWidth = 1200
): MeasureResult {
  const widths = new Array(columns.length).fill(0);
  ctx.save();
  ctx.font = font;
  // Estimate id column width from total row count
  const totalNum = ds.getRowCount();
  const totalBig = ds.getRowCountBig ? ds.getRowCountBig() : BigInt(totalNum);
  const idWorst = totalBig > 0n ? (totalBig - 1n).toString() : "0";
  widths[0] = Math.min(
    maxColWidth,
    Math.max(
      columns[0]?.min ?? 60,
      Math.ceil(ctx.measureText(idWorst).width) + padding
    )
  );
  // Initialize with header label widths for data columns
  for (let c = 1; c < columns.length; c++) {
    const label = String(columns[c]?.label ?? "");
    widths[c] = Math.max(
      columns[c]?.min ?? 120,
      Math.ceil(ctx.measureText(label).width) + padding
    );
  }
  // Top sampling (number API)
  const topCount = Math.max(
    0,
    Math.min(sampleTop, Number.isFinite(totalNum) ? totalNum : sampleTop)
  );
  for (let r = 0; r < topCount; r++) {
    const row = ds.getRow(r);
    for (let c = 0; c < Math.min(columns.length, row.length); c++) {
      const cell = String(row[c] ?? "");
      const w = Math.ceil(ctx.measureText(cell).width) + padding;
      if (w > widths[c]) widths[c] = Math.min(maxColWidth, w);
    }
  }
  // Bottom sampling (BigInt API if available)
  if (ds.getRowCountBig && ds.getRowBig) {
    const totalB = ds.getRowCountBig() as bigint;
    const desired = BigInt(Math.max(0, sampleBottom));
    let taken = 0n;
    for (let i = 0n; i < desired; i++) {
      if (totalB === 0n) break;
      const idx = totalB - 1n - i;
      if (idx < 0n) break;
      const row = ds.getRowBig(idx) as string[];
      for (let c = 0; c < Math.min(columns.length, row.length); c++) {
        const cell = String(row[c] ?? "");
        const w = Math.ceil(ctx.measureText(cell).width) + padding;
        if (w > widths[c]) widths[c] = Math.min(maxColWidth, w);
      }
      taken++;
    }
  } else if (Number.isFinite(totalNum)) {
    const bottomCountNum = Math.max(0, Math.min(sampleBottom, totalNum));
    for (let i = 0; i < bottomCountNum; i++) {
      const idx = totalNum - 1 - i;
      if (idx < 0) break;
      const row = ds.getRow(idx);
      for (let c = 0; c < Math.min(columns.length, row.length); c++) {
        const cell = String(row[c] ?? "");
        const w = Math.ceil(ctx.measureText(cell).width) + padding;
        if (w > widths[c]) widths[c] = Math.min(maxColWidth, w);
      }
    }
  }
  ctx.restore();
  let x = 0;
  for (let i = 0; i < widths.length; i++) x += widths[i] ?? 0;
  return { widths, tableWidth: x };
}
