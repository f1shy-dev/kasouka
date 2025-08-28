import type { Column } from "../types";

export interface DataSource {
  getRowCount(): number;
  getRowCountBig?(): bigint;
  getColumns(): Column[];
  getRow(index: number): string[];
  getRowBig?(index: bigint): string[];
  sampleRows(max: number): Iterable<string[]>;
}
