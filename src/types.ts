export type TextAlign = "left" | "right" | "center";

export interface Column {
  key: string;
  label: string;
  min?: number;
  weight?: number;
  align?: TextAlign;
}

export interface CsvData {
  text: string;
  offsets: Uint32Array; // line start offsets; offsets[0] = 0; offsets[1] = header end + 1
  header: string[];
  rows: number; // number of data rows (excludes header)
}

export interface VirtualTableOptions {
  headerHeight?: number;
  rowHeight?: number;
  overscan?: number;
  font?: string;
  zebra?: boolean;
}

export interface MeasureResult {
  widths: number[];
  tableWidth: number;
}

export interface InitElements {
  viewport: HTMLElement;
  spacer: HTMLElement;
  canvas: HTMLCanvasElement;
  debugOverlay?: HTMLElement | null;
}

