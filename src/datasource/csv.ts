import type { DataSource } from ".";
import type { Column, CsvData } from "../types";
import { splitCsvLine } from "../csv";

export class CsvDataSource implements DataSource {
  private columns: Column[];
  constructor(private csv: CsvData) {
    this.columns = [
      { key: "id", label: "#", min: 60, align: "right" },
      ...csv.header.map((h, i) => ({
        key: `csv_${i}`,
        label: String(h ?? `col${i + 1}`),
        min: 120,
        align: "left" as const,
      })),
    ];
  }
  getRowCount(): number {
    return this.csv.rows;
  }
  getColumns(): Column[] {
    return this.columns;
  }
  getRow(index: number): string[] {
    const out: string[] = new Array(this.columns.length);
    out[0] = String(index);
    const start = this.csv.offsets[index + 1];
    const end = this.csv.offsets[index + 2] ?? this.csv.text.length;
    if (start == null || start >= this.csv.text.length) return out;
    const line = this.csv.text.slice(
      start,
      Math.min(end, this.csv.text.length)
    );
    const cells = splitCsvLine(line);
    for (let c = 1; c < this.columns.length; c++) out[c] = cells[c - 1] ?? "";
    return out;
  }
  *sampleRows(max: number): Iterable<string[]> {
    const total = this.getRowCount();
    const take = Math.min(Math.max(50, max), 1000);
    if (take <= 0 || total <= 0) return;
    const step = Math.max(1, Math.floor(total / take));
    for (let r = 0; r < total; r += step) yield this.getRow(r);
  }
}
