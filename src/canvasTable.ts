import type {
  Column,
  CsvData,
  InitElements,
  VirtualTableOptions,
} from "./types";
import { estimateCsvWidths } from "./measure";
import type { DataSource } from "./datasource";

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
  private ds?: DataSource;
  private debugEnabled = false;
  private debugText = "";

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
    this.ds = undefined;
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
    const safeContentPx = Math.max(0, 16000000 - this.opts.headerHeight);
    this.els.spacer.style.height = `${
      this.opts.headerHeight + safeContentPx
    }px`;
    this.els.viewport.scrollTop = this.opts.headerHeight;
    this.schedule();
  }

  setDataSource(ds: DataSource): void {
    this.ds = ds;
    this.csv = undefined;
    this.setColumns(ds.getColumns());
    this.updateScrollScale();
    const safeContent = Math.max(0, 16000000 - this.opts.headerHeight);
    this.els.spacer.style.height = `${this.opts.headerHeight + safeContent}px`;
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
    window.addEventListener(
      "scroll",
      () => {
        this.syncCanvasPosition();
      },
      { passive: true }
    );
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
      this.updateScrollScale();
    }
    this.syncCanvasPosition();
  }

  private syncCanvasPosition(): void {
    const rect = this.els.viewport.getBoundingClientRect();
    this.els.canvas.style.top = `${rect.top}px`;
    this.els.canvas.style.left = `${rect.left}px`;
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (!enabled) this.debugText = "";
    this.needsDraw = true;
    this.schedule();
  }

  // Map DOM scroll (px) into a BigInt row index and fractional offset-in-row (px)
  private computeFirstRow(
    domContent: number,
    viewportHeight: number
  ): {
    firstRowBig: bigint;
    offsetWithin: number;
  } {
    const domMax = Math.max(1, Math.floor(this.scrollScale.domMax));
    const domContentClamped = Math.max(
      0,
      Math.min(Math.floor(domContent), domMax)
    );
    const totalRowsBig: bigint = this.csv
      ? BigInt(this.csv.rows)
      : this.ds
      ? this.ds.getRowCountBig && this.ds.getRowCountBig() !== undefined
        ? (this.ds.getRowCountBig() as bigint)
        : BigInt(this.ds.getRowCount())
      : BigInt(0);
    const visibleRows = Math.floor(
      (viewportHeight - this.opts.headerHeight) / this.opts.rowHeight
    );
    const visibleRowsBig = BigInt(visibleRows < 0 ? 0 : visibleRows);
    const scrollableRowsBig =
      totalRowsBig > visibleRowsBig ? totalRowsBig - visibleRowsBig : BigInt(0);
    if (scrollableRowsBig === BigInt(0)) {
      return { firstRowBig: BigInt(0), offsetWithin: 0 };
    }
    const numer = BigInt(domContentClamped) * scrollableRowsBig;
    const denom = BigInt(domMax);
    const firstRowBig = numer / denom;
    const rem = numer % denom; // < denom
    const offsetWithin =
      (Number(rem) / Math.max(1, Number(denom))) * this.opts.rowHeight;
    return { firstRowBig, offsetWithin };
  }

  private updateScrollScale(): void {
    const visible = Math.max(
      0,
      this.els.viewport.clientHeight - this.opts.headerHeight
    );
    const totalRows = this.csv?.rows ?? this.ds?.getRowCount() ?? 0;
    const virt = Math.max(0, totalRows * this.opts.rowHeight - visible);
    const safeContentPx = Math.max(0, 16000000 - this.opts.headerHeight);
    // Align DOM scroll range with the coordinate used in computeFirstRow,
    // which is based on (scrollTop - headerHeight). The maximum value of
    // that expression is (safeContentPx - viewport.clientHeight).
    const domMax = Math.max(0, safeContentPx - this.els.viewport.clientHeight);
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
      this.els.viewport.scrollTop - this.opts.headerHeight
    );
    const { firstRowBig, offsetWithin } = this.computeFirstRow(
      domContent,
      this.els.viewport.clientHeight
    );
    const yStart = this.opts.headerHeight - offsetWithin;
    const rowInView = Math.max(
      0,
      Math.floor((y - yStart) / this.opts.rowHeight)
    );
    const idxBig = firstRowBig + BigInt(rowInView);
    return idxBig > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(idxBig);
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

    // visible rows (BigInt-safe)
    const domContent = Math.max(0, scrollTop - this.opts.headerHeight);
    const { firstRowBig, offsetWithin } = this.computeFirstRow(domContent, h);
    const firstRowLocal =
      firstRowBig > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(firstRowBig);
    const yStart = this.opts.headerHeight - offsetWithin;
    const maxVisible =
      Math.ceil((h - yStart) / this.opts.rowHeight) + this.opts.overscan;
    const totalRowsBig: bigint = this.csv
      ? BigInt(this.csv.rows)
      : this.ds
      ? this.ds.getRowCountBig
        ? (this.ds.getRowCountBig() as bigint)
        : BigInt(this.ds.getRowCount())
      : BigInt(0);
    const rowsRemainingBig =
      totalRowsBig > firstRowBig ? totalRowsBig - firstRowBig : BigInt(0);
    const rowCount = Math.min(
      maxVisible,
      Number(
        rowsRemainingBig > BigInt(maxVisible)
          ? BigInt(maxVisible)
          : rowsRemainingBig
      )
    );

    // rows
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.opts.headerHeight, w, h - this.opts.headerHeight);
    ctx.clip();
    ctx.save();
    ctx.translate(-scrollLeft, 0);

    for (let i = 0; i < rowCount; i++) {
      const rowIndexBig = firstRowBig + BigInt(i);
      const rowIndex =
        rowIndexBig > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(rowIndexBig);
      const y = yStart + i * this.opts.rowHeight;
      if (y > h) break;
      const isEven = (rowIndexBig & 1n) === 0n;
      ctx.fillStyle = this.opts.zebra
        ? isEven
          ? "#ffffff"
          : "#fafafa"
        : "#ffffff";
      ctx.fillRect(0, y, this.tableWidth, this.opts.rowHeight);

      if (rowIndex === this.selectedRow) {
        ctx.fillStyle = "rgba(59,130,246,0.15)";
        ctx.fillRect(0, y, w, this.opts.rowHeight);
      }

      let rowData: string[] = [];
      if (this.csv) {
        rowData = this.getCsvRow(rowIndex);
      } else if (this.ds) {
        if (
          this.ds.getRowBig &&
          rowIndexBig > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          const bigGetter = this.ds.getRowBig;
          rowData = bigGetter ? bigGetter.call(this.ds, rowIndexBig) : [];
        } else {
          rowData = this.ds.getRow(rowIndex);
        }
      }
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

    // Debug overlay (drawn in-canvas)
    if (this.debugEnabled) {
      this.debugText = [
        `domMax=${this.scrollScale.domMax.toFixed(1)}`,
        `domContent=${domContent.toFixed(1)}`,
        `firstRow=${firstRowBig.toString()}`,
        `offsetWithin=${offsetWithin.toFixed(2)}`,
        `rowCount=${rowCount}`,
        `tableWidth=${this.tableWidth}`,
      ].join("\n");
      ctx.save();
      ctx.translate(8 - scrollLeft, h - 8);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, -76, 300, 76);
      ctx.fillStyle = "#ffffff";
      ctx.font = "11px Geist Mono, ui-monospace, monospace";
      const lines = this.debugText.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i] ?? "";
        ctx.fillText(lineText, 8, -60 + i * 12);
      }
      ctx.restore();
    }
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
