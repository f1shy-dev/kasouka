import type { Column, CsvData, MeasureResult } from "./types.ts";
import { splitCsvLine } from "./csv";

export function estimateCsvWidths(
  ctx: CanvasRenderingContext2D,
  columns: Column[],
  csv: CsvData,
  font: string,
  sampleCount = 300,
  padding = 16,
  maxColWidth = 1200
): MeasureResult {
  const widths = new Array(columns.length).fill(0);
  ctx.save();
  ctx.font = font;
  const idText = String(Math.max(0, csv.rows - 1));
  widths[0] = Math.min(
    maxColWidth,
    Math.max(
      columns[0]?.min ?? 60,
      Math.ceil(ctx.measureText(idText).width) + padding
    )
  );
  for (let c = 1; c < columns.length; c++) {
    const label = String(columns[c]?.label ?? "");
    widths[c] = Math.max(
      columns[c]?.min ?? 120,
      Math.ceil(ctx.measureText(label).width) + padding
    );
  }
  const total = csv.rows;
  const take = Math.min(Math.max(50, sampleCount), 1000);
  if (take > 0 && total > 0) {
    const step = Math.max(1, Math.floor(total / take));
    for (let r = 0; r < total; r += step) {
      const start = csv.offsets[r + 1];
      const end = csv.offsets[r + 2] ?? csv.text.length;
      if (start == null || start >= csv.text.length) continue;
      const line = csv.text.slice(start, Math.min(end, csv.text.length));
      const cells = splitCsvLine(line);
      for (let c = 1; c < columns.length; c++) {
        const cell = String(cells[c - 1] ?? "");
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
