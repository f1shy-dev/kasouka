import type { Column } from "../types";

export type DataSourceState = "idle" | "loading" | "ready" | "error";

export interface DataSourceStatus {
  state: DataSourceState;
  progress?: number; // 0..1
  message?: string;
}

export type Unsubscribe = () => void;

export interface DataWindowEvent {
  start: number;
  end: number;
  reason?: "prefetch" | "cache-evict" | "update";
}

export interface DataSourceEvents {
  onStatus?(listener: (status: DataSourceStatus) => void): Unsubscribe;
  getStatus?(): DataSourceStatus;
  onDataWindow?(listener: (ev: DataWindowEvent) => void): Unsubscribe;
}

export interface DataSource extends DataSourceEvents {
  getRowCount(): number;
  getRowCountBig?(): bigint;
  getColumns(): Column[];
  getRow(index: number): string[];
  getRowBig?(index: bigint): string[];
  isRowReady?(index: number): boolean;
  getRowAsync?(index: number): Promise<string[]>;
  prefetch?(start: number, end: number): void;
  sampleRows(max: number): Iterable<string[]>;
}
