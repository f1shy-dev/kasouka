export type TextAlign = "left" | "right" | "center";

export interface Theme {
  headerBg?: string;
  headerText?: string;
  headerBorder?: string;
  rowBg?: string | ((rowIndex: bigint) => string);
  rowText?: string;
  rowSeparator?: string;
  columnSeparator?: string;
  selectedHighlight?: (alpha: number) => string;
  hoverHighlight?: (alpha: number) => string;
  hoverSeparator?: boolean;

  bottomRowBg?: string;
  bottomRowText?: string;
  bottomRowFont?: string;
}

export interface Column {
  key: string;
  label: string;
  min?: number;
  weight?: number;
  align?: TextAlign;
  theme?: Partial<Theme>;
}

export type BottomRowModule = "dynamic-progress" | "scroll-position" | "total-rows" | "fps" | "github-link";

export interface BottomRowModuleConfig {
  type: BottomRowModule;
  position?: "left" | "right";
  url?: string; // For github-link module
  loadingText?: string; // For dynamic-progress
}

export interface VirtualTableOptions {
  headerHeight?: number;
  rowHeight?: number;
  overscan?: number;
  font?: string;
  theme?: Theme;
  scrollerHeight?: number;
  bottomRowModules?: (BottomRowModule | BottomRowModuleConfig)[];
  bottomRowHeight?: number;
}

export interface MeasureResult {
  widths: number[];
  tableWidth: number;
}

export interface InitElements {
  viewport: HTMLElement;
  spacer: HTMLElement;
  canvas: HTMLCanvasElement;
}
