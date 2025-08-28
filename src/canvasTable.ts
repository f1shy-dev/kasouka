import type {
  Column,
  CsvData,
  InitElements,
  VirtualTableOptions,
} from "./types";
import { estimateCsvWidths } from "./measure";

export class VirtualCanvasTable {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private columns: Column[] = [];
  private colX: number[] = [];
  private colW: number[] = [];
  private tableWidth = 0;
  private selectedRow = -1;
  private hoveredRow = -1;
  private hoverAlpha = 0;
  private rafId = 0;
  private needsDraw = true;
  private scrollScale = { domMax: 0, virtMax: 0, k: 1 };
  private csv?: CsvData;

  constructor(
    private els: InitElements,
    private opts: Required<VirtualTableOptions>
  ) {
    const ctx = els.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    this.bind();
  }

  setColumns(columns: Column[]): void {
    this.columns = columns.slice();
    this.computeColumns();
  }

  setCsv(csv: CsvData): void {
    this.csv = csv;
    // first column is #, the rest from csv header
    this.setColumns([
      { key: "id", label: "#", min: 60, align: "right" },
      ...csv.header.map((h, i) => ({
        key: `csv_${i}`,
        label: String(h ?? `col${i + 1}`),
        min: 120,
        align: "left" as const,
      })),
    ]);
    this.updateScrollScale();
    this.els.spacer.style.height = `${
      this.opts.headerHeight + Math.max(0, 16000000 - this.opts.headerHeight)
    }px`;
    this.els.viewport.scrollTop = this.opts.headerHeight;
    this.schedule();
  }

  private bind(): void {
    this.els.viewport.addEventListener(
      "scroll",
      () => {
        this.needsDraw = true;
        this.schedule();
      },
      { passive: true }
    );
    window.addEventListener("resize", () => {
      this.resize();
      this.needsDraw = true;
      this.schedule();
    });
    this.els.canvas.addEventListener("click", (e) => {
      const rect = this.els.canvas.getBoundingClientRect();
      const y = e.clientY - rect.top;
      if (y < this.opts.headerHeight) return;
      const row = this.pointToRowIndex(y);
      if (row >= 0 && this.csv && row < this.csv.rows) {
        this.selectedRow = row;
        this.needsDraw = true;
        this.schedule();
      }
    });
    this.resize();
  }

  private schedule(): void {
    if (!this.rafId) this.rafId = requestAnimationFrame(() => this.draw());
  }

  private resize(): void {
    const cssWidth = this.els.viewport.clientWidth;
    const cssHeight = this.els.viewport.clientHeight;
    const nextDpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const targetW = Math.floor(cssWidth * nextDpr);
    const targetH = Math.floor(cssHeight * nextDpr);
    if (
      this.els.canvas.width !== targetW ||
      this.els.canvas.height !== targetH ||
      nextDpr !== this.dpr
    ) {
      this.dpr = nextDpr;
      this.els.canvas.width = targetW;
      this.els.canvas.height = targetH;
      this.els.canvas.style.width = `${cssWidth}px`;
      this.els.canvas.style.height = `${cssHeight}px`;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(this.dpr, this.dpr);
      this.ctx.imageSmoothingEnabled = false;
      this.computeColumns();
    }
  }

  private updateScrollScale(): void {
    const visibleContent = Math.max(
      0,
      this.els.viewport.clientHeight - this.opts.headerHeight
    );
    const virt = this.csv
      ? Math.max(0, this.csv.rows * this.opts.rowHeight - visibleContent)
      : 0;
    const domMax = Math.max(
      0,
      Math.max(0, 16000000 - this.opts.headerHeight) -
        this.els.viewport.clientHeight
    );
    const k = domMax > 0 ? virt / domMax : 0;
    this.scrollScale = { domMax, virtMax: virt, k };
  }

  private computeColumns(): void {
    this.colX.length = 0;
    this.colW.length = 0;
    let x = 0;
    if (this.csv && this.columns.length) {
      const csv = this.csv as CsvData;
      const { widths, tableWidth } = estimateCsvWidths(
        this.ctx,
        this.columns,
        csv,
        this.opts.font
      );
      for (let i = 0; i < this.columns.length; i++) {
        this.colX.push(x);
        const w = widths[i] ?? 120;
        this.colW.push(w);
        x += w;
      }
      this.tableWidth = tableWidth;
    } else {
      for (let i = 0; i < this.columns.length; i++) {
        const min = this.columns[i]?.min ?? 120;
        const w = Math.max(
          min,
          Math.floor(
            this.els.viewport.clientWidth / Math.max(1, this.columns.length)
          )
        );
        this.colX.push(x);
        this.colW.push(w);
        x += w;
      }
      this.tableWidth = x;
    }
    this.els.spacer.style.width = `${Math.max(
      this.tableWidth,
      this.els.viewport.clientWidth
    )}px`;
  }

  private pointToRowIndex(y: number): number {
    const domContent = Math.max(
      0,
      Math.min(
        this.els.viewport.scrollTop - this.opts.headerHeight,
        this.scrollScale.domMax
      )
    );
    const virtualOffset = domContent * this.scrollScale.k;
    const firstRowLocal = Math.floor(virtualOffset / this.opts.rowHeight);
    const offsetWithin = virtualOffset - firstRowLocal * this.opts.rowHeight;
    const yStart = this.opts.headerHeight - offsetWithin;
    const rowInView = Math.floor((y - yStart) / this.opts.rowHeight);
    return firstRowLocal + rowInView;
  }

  private draw(): void {
    this.rafId = 0;
    if (!this.needsDraw) return;
    this.needsDraw = false;
    const w = this.els.viewport.clientWidth;
    const h = this.els.viewport.clientHeight;
    const scrollTop = this.els.viewport.scrollTop;
    const scrollLeft = this.els.viewport.scrollLeft;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // header bg
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, w, this.opts.headerHeight);
    ctx.strokeStyle = "#d1d5db";
    ctx.beginPath();
    ctx.moveTo(0, this.opts.headerHeight + 0.5);
    ctx.lineTo(w, this.opts.headerHeight + 0.5);
    ctx.stroke();

    // header text
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, this.opts.headerHeight);
    ctx.clip();
    ctx.save();
    ctx.translate(-scrollLeft, 0);
    ctx.fillStyle = "#111827";
    ctx.font = this.opts.font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const headerY = Math.floor(this.opts.headerHeight / 2);
    for (let i = 0; i < this.columns.length; i++) {
      const lx = (this.colX[i] ?? 0) + 8;
      const label = this.columns[i]?.label ?? "";
      ctx.fillText(label, lx, headerY);
    }
    ctx.restore();
    ctx.restore();

    // visible rows
    const domContent = Math.max(
      0,
      Math.min(scrollTop - this.opts.headerHeight, this.scrollScale.domMax)
    );
    const virtualOffset = domContent * this.scrollScale.k;
    const firstRowLocal = Math.floor(virtualOffset / this.opts.rowHeight);
    const offsetWithin = virtualOffset - firstRowLocal * this.opts.rowHeight;
    const yStart = this.opts.headerHeight - offsetWithin;
    const maxVisible =
      Math.ceil((h - yStart) / this.opts.rowHeight) + this.opts.overscan;
    const totalRows = this.csv?.rows ?? 0;
    const rowCount = Math.min(
      totalRows - firstRowLocal,
      Math.max(0, maxVisible)
    );

    // rows
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.opts.headerHeight, w, h - this.opts.headerHeight);
    ctx.clip();
    ctx.save();
    ctx.translate(-scrollLeft, 0);

    for (let i = 0; i < rowCount; i++) {
      const rowIndex = firstRowLocal + i;
      const y = yStart + i * this.opts.rowHeight;
      if (y > h) break;
      ctx.fillStyle = this.opts.zebra
        ? (rowIndex & 1) === 0
          ? "#ffffff"
          : "#fafafa"
        : "#ffffff";
      ctx.fillRect(0, y, this.tableWidth, this.opts.rowHeight);

      if (rowIndex === this.selectedRow) {
        ctx.fillStyle = "rgba(59,130,246,0.15)";
        ctx.fillRect(0, y, w, this.opts.rowHeight);
      }

      const rowData = this.csv ? this.getCsvRow(rowIndex) : [];
      ctx.fillStyle = "#111827";
      ctx.textBaseline = "middle";
      ctx.font = this.opts.font;
      for (let c = 0; c < this.columns.length; c++) {
        const cw = this.colW[c] ?? 0;
        const cx = this.colX[c] ?? 0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx + 1, y + 1, Math.max(0, cw - 2), this.opts.rowHeight - 2);
        ctx.clip();
        if ((this.columns[c]?.align ?? "left") === "right") {
          ctx.textAlign = "right";
          ctx.fillText(
            rowData[c] ?? "",
            cx + (cw - 8),
            y + this.opts.rowHeight / 2
          );
        } else {
          ctx.textAlign = "left";
          ctx.fillText(rowData[c] ?? "", cx + 8, y + this.opts.rowHeight / 2);
        }
        ctx.restore();
      }
    }

    // vertical grid
    ctx.strokeStyle = "#e5e7eb";
    ctx.beginPath();
    for (let i = 0; i < this.columns.length; i++) {
      const x = (this.colX[i] ?? 0) + (this.colW[i] ?? 0) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // row separators
    ctx.strokeStyle = "#f1f5f9";
    ctx.beginPath();
    for (let i = 0; i < rowCount; i++) {
      const y = yStart + i * this.opts.rowHeight + this.opts.rowHeight + 0.5;
      if (y > h) break;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  private getCsvRow(index: number): string[] {
    const out: string[] = new Array(this.columns.length);
    out[0] = String(index);
    if (!this.csv) return out;
    const start = this.csv.offsets[index + 1];
    const end = this.csv.offsets[index + 2] ?? this.csv.text.length;
    if (start == null || start >= this.csv.text.length) return out;
    const line = this.csv.text.slice(
      start,
      Math.min(end, this.csv.text.length)
    );
    const cells = line ? line.split(",") : [];
    for (let c = 1; c < this.columns.length; c++) out[c] = cells[c - 1] ?? "";
    return out;
  }
}
