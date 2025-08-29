export type TextAlign = "left" | "right" | "center";

export interface CellTheme {
  background: string | ((rowIndex: bigint) => string);
  text: string | ((rowIndex: bigint) => string);
  separator_x: string | false;
  separator_y: string | false;
  height: number;

  separator_y_hover: string | false;
}

export interface Column {
  key: string;
  label: string;
  min?: number;
  weight?: number;
  align?: TextAlign;
  theme?: Partial<Pick<CellTheme, "background" | "text">>;
}

export interface CsvData {
  text: string;
  offsets: Uint32Array; // line start offsets; offsets[0] = 0; offsets[1] = header end + 1
  header: string[];
  rows: number; // number of data rows (excludes header)
}

export type BottomRowModule = "scroll-position" | "total-rows" | "github-link";

export interface BottomRowModuleConfig {
  type: BottomRowModule;
  position?: "left" | "right";
  url?: string; // For github-link module
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

export interface VirtualTableOptions {
  baseFont: string;
  overscan: number;

  header: {
    enabled: boolean;
    background: string;
    text: string;
    border: string;
    height: number;
  };

  cells: CellTheme;

  bottomRow: {
    enabled: boolean;
    background: string;
    text: string;
    font: string;
    height: number;
    modules: (BottomRowModule | BottomRowModuleConfig)[];
  };

  selectedHighlight: (alpha: number) => string;
  hoverHighlight: (alpha: number) => string;
  scrollerHeight: number;
}
