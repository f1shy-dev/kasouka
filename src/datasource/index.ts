import type { Column } from "../types";

export type DataSourceState = "idle" | "loading" | "ready" | "error";

export interface DataSourceStatus {
  state: DataSourceState;
  progress?: number; // 0..1
  message?: string;
}

export type Unsubscribe = () => void;

export interface DataSourceEvents {
  onStatus?(listener: (status: DataSourceStatus) => void): Unsubscribe;
  getStatus?(): DataSourceStatus;
}

export interface DataSource extends DataSourceEvents {
  getRowCount(): number;
  getRowCountBig?(): bigint;
  getColumns(): Column[];
  getRow(index: number): string[];
  getRowBig?(index: bigint): string[];
  sampleRows(max: number): Iterable<string[]>;
}
