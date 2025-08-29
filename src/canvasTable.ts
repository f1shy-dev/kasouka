import type {
  Column,
  InitElements,
  VirtualTableOptions,
  Theme,
  BottomRowModule,
  BottomRowModuleConfig,
} from "./types";
import { estimateDataSourceWidths } from "./measure";
import type { DataSource, DataSourceStatus } from "./datasource";
import { ICONS, renderIcon } from "./misc-icons";

export class VirtualCanvasTable {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private columns: Column[] = [];
  private colX: number[] = [];
  private colW: number[] = [];
  private tableWidth = 0;
  private selectedRowBig: bigint | null = null;
  private hoveredRowBig: bigint | null = null;
  private hoverAlpha = 0;
  private rafId = 0;
  private needsDraw = true;
  private scrollScale = { domMax: 0, virtMax: 0, k: 1 };
  private ds?: DataSource;
  private dsStatus: DataSourceStatus = { state: "idle", progress: 0, message: "" };
  private dsUnsub?: () => void;
  private debugEnabled = false;
  private debugText = "";
  private dynamicWidths?: number[];
  private SAFE_CONTENT_PX = 16_000_000;
  private bottomRowClickableAreas: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    url: string;
  }> = [];

  private getTheme(): Required<Theme> {
    const defaultTheme: Required<Theme> = {
      headerBg: "#f3f4f6",
      headerText: "#111827",
      headerBorder: "#d1d5db",
      rowBg: (rowIndex: bigint) =>
        (rowIndex & 1n) === 0n ? "#ffffff" : "#fafafa",
      rowText: "#111827",
      rowSeparator: "#f1f5f9",
      columnSeparator: "#e5e7eb",
      selectedHighlight: () => "rgba(59,130,246,0.15)",
      hoverHighlight: (alpha: number) => `rgba(59,130,246,${alpha})`,
      hoverSeparator: true,

      bottomRowBg: "#f3f4f6",
      bottomRowText: "#111827",
      bottomRowFont: this.opts.font,
    };

    return {
      ...defaultTheme,
      ...this.opts.theme,
    };
  }

  private getBottomRowHeight(): number {
    return this.opts.bottomRowHeight ?? 0;
  }

  private hasBottomRow(): boolean {
    return Boolean(
      this.opts.bottomRowModules && this.opts.bottomRowModules.length > 0
    );
  }

  private normalizeBottomRowModule(
    module: BottomRowModule | BottomRowModuleConfig
  ): BottomRowModuleConfig {
    if (typeof module === "string") {
      return { type: module, position: "left" };
    }
    return { position: "left", ...module };
  }

  private renderBottomRow(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scrollLeft: number
  ): void {
    if (!this.hasBottomRow()) return;

    const bottomRowHeight = this.getBottomRowHeight();
    const bottomRowY = h - bottomRowHeight;
    const theme = this.getTheme();

    // Clear clickable areas
    this.bottomRowClickableAreas = [];

    // Draw bottom row background
    ctx.fillStyle = theme.bottomRowBg;
    ctx.fillRect(0, bottomRowY, w, bottomRowHeight);

    // Draw border above bottom row
    ctx.strokeStyle = theme.headerBorder;
    ctx.beginPath();
    ctx.moveTo(0, bottomRowY + 0.5);
    ctx.lineTo(w, bottomRowY + 0.5);
    ctx.stroke();

    // Render bottom row modules
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bottomRowY, w, bottomRowHeight);
    ctx.clip();

    ctx.fillStyle = theme.bottomRowText;
    ctx.font = theme.bottomRowFont;
    ctx.textBaseline = "middle";

    const moduleY = bottomRowY + bottomRowHeight / 2 + 1;

    if (!this.opts.bottomRowModules) return;

    // Separate left and right modules
    const leftModules: BottomRowModuleConfig[] = [];
    const rightModules: BottomRowModuleConfig[] = [];

    for (const rawModule of this.opts.bottomRowModules) {
      const module = this.normalizeBottomRowModule(rawModule);
      (module.position === "right" ? rightModules : leftModules).push(module);
    }

    const renderModule = (
      module: BottomRowModuleConfig,
      x: number,
      align: "left" | "right",
      isReversed = false
    ): number => {
      const spacing = 16;
      const iconSize = 14;

      if (module.type === "github-link" && module.url) {
        const moduleText = "GitHub";
        const moduleWidth = ctx.measureText(moduleText).width;

        const iconY = moduleY - iconSize / 2 - 1;
        const textOffset = iconSize + 4;

        let iconX: number;
        let textX: number;

        if (align === "left") {
          iconX = x;
          textX = x + textOffset;
          renderIcon(ctx, ICONS.github, iconX, iconY, iconSize);
          ctx.fillText(moduleText, textX, moduleY);
        } else {
          textX = x - moduleWidth;
          iconX = textX - textOffset;
          ctx.fillText(moduleText, textX + 44, moduleY);
          renderIcon(ctx, ICONS.github, iconX, iconY, iconSize);
        }

        const clickableX = align === "left" ? iconX : iconX;
        this.bottomRowClickableAreas.push({
          x: clickableX + scrollLeft,
          y: bottomRowY,
          width: iconSize + 4 + moduleWidth,
          height: bottomRowHeight,
          url: module.url,
        });

        return x + (isReversed ? -1 : 1) * (textOffset + moduleWidth + spacing);
      }

      if (module.type === "dynamic-progress") {
        const scrollPercent =
          this.els.viewport.scrollTop > 0
            ? Math.round(
                (this.els.viewport.scrollTop /
                  (this.els.spacer.clientHeight -
                    this.els.viewport.clientHeight)) *
                  100
              )
            : 0;
        const isLoading = this.dsStatus?.state === "loading";
        const iconY = moduleY - iconSize / 2;
        const textOffset = iconSize + 4;
        let iconX: number;
        let textX: number;
        if (isLoading) {
          const p = this.dsStatus.progress != null ? Math.round((this.dsStatus.progress || 0) * 100) : (Date.now() / 40) % 100;
          const loadingText = (module as any).loadingText || this.dsStatus.message || "Loading";
          const moduleText = this.dsStatus.progress != null ? `${loadingText} ${p}%` : `${loadingText}`;
          const moduleWidth = ctx.measureText(moduleText).width;
          if (align === "left") {
            iconX = x;
            textX = x + textOffset;
            renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [p]);
            ctx.fillText(moduleText, textX, moduleY);
            return x + textOffset + moduleWidth + spacing;
          } else {
            textX = x - moduleWidth;
            iconX = textX - textOffset;
            ctx.fillText(moduleText, textX, moduleY);
            renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [p]);
            return x - (textOffset + moduleWidth + spacing);
          }
        } else {
          const moduleText = `${scrollPercent}%`;
          const moduleWidth = ctx.measureText(moduleText).width;
          if (align === "left") {
            iconX = x;
            textX = x + textOffset;
            renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [scrollPercent]);
            ctx.fillText(moduleText, textX, moduleY);
            return x + textOffset + moduleWidth + spacing;
          } else {
            textX = x - moduleWidth;
            iconX = textX - textOffset;
            ctx.fillText(moduleText, textX, moduleY);
            renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [scrollPercent]);
            return x - (textOffset + moduleWidth + spacing);
          }
        }
      }

      if (module.type === "scroll-position") {
        const scrollPercent =
          this.els.viewport.scrollTop > 0
            ? Math.round(
                (this.els.viewport.scrollTop /
                  (this.els.spacer.clientHeight -
                    this.els.viewport.clientHeight)) *
                  100
              )
            : 0;
        const moduleText = `${scrollPercent}%`;
        const moduleWidth = ctx.measureText(moduleText).width;

        const iconY = moduleY - iconSize / 2;
        const textOffset = iconSize + 4;

        let iconX: number;
        let textX: number;

        if (align === "left") {
          iconX = x;
          textX = x + textOffset;
          renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [
            scrollPercent,
          ]);
          ctx.fillText(moduleText, textX, moduleY);
          return x + textOffset + moduleWidth + spacing;
        }

        textX = x - moduleWidth;
        iconX = textX - textOffset;
        ctx.fillText(moduleText, textX, moduleY);
        renderIcon(ctx, ICONS["loading-circle"], iconX, iconY, iconSize, [
          scrollPercent,
        ]);
        return x - (textOffset + moduleWidth + spacing);
      }

      if (module.type === "total-rows") {
        if (this.dsStatus?.state !== "ready") return x;
        let totalRows = 0n;
        if (this.ds && typeof this.ds.getRowCountBig === "function") {
          const val = this.ds.getRowCountBig();
          totalRows = val;
        } else if (this.ds && typeof this.ds.getRowCount === "function") {
          totalRows = BigInt(this.ds.getRowCount());
        }
        const moduleText = `${totalRows.toLocaleString()} rows`;
        const moduleWidth = ctx.measureText(moduleText).width;

        if (align === "left") {
          ctx.fillText(moduleText, x, moduleY);
          return x + moduleWidth + spacing;
        }
        ctx.fillText(moduleText, x, moduleY);
        return x - moduleWidth - spacing;
      }

      if (module.type === "fps") {
        const moduleText = "60 fps"; // Placeholder for actual FPS calculation
        const moduleWidth = ctx.measureText(moduleText).width;

        if (align === "left") {
          ctx.fillText(moduleText, x, moduleY);
          return x + moduleWidth + spacing;
        }
        ctx.fillText(moduleText, x, moduleY);
        return x - moduleWidth - spacing;
      }

      return x;
    };

    // Render left modules
    ctx.textAlign = "left";
    let leftX = 8 - scrollLeft;
    for (const module of leftModules) {
      leftX = renderModule(module, leftX, "left");
    }

    // Render right modules
    ctx.textAlign = "right";
    let rightX = w - 8 + scrollLeft;
    for (let i = rightModules.length - 1; i >= 0; i--) {
      const module = rightModules[i];
      if (!module) continue;
      rightX = renderModule(module, rightX, "right", true);
    }

    ctx.restore();
  }

  constructor(
    private els: InitElements,
    private opts: Required<
      Omit<
        VirtualTableOptions,
        "theme" | "scrollerHeight" | "bottomRowHeight" | "bottomRowModules"
      >
    > & {
      theme?: Theme;
      scrollerHeight?: number;
      bottomRowHeight?: number;
      bottomRowModules?: (BottomRowModule | BottomRowModuleConfig)[];
    }
  ) {
    this.SAFE_CONTENT_PX = opts.scrollerHeight ?? this.SAFE_CONTENT_PX;
    const ctx = els.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    this.bind();
  }

  setColumns(columns: Column[]): void {
    this.columns = columns.slice();
    this.computeColumns();
  }

  setDataSource(ds: DataSource): void {
    this.ds = ds;
    if (this.dsUnsub) {
      this.dsUnsub();
      this.dsUnsub = undefined;
    }
    if (typeof ds.onStatus === "function") {
      this.dsStatus = ds.getStatus ? ds.getStatus() : ({ state: "idle" } as DataSourceStatus);
      this.dsUnsub = ds.onStatus!((s) => {
        this.dsStatus = s;
        // Update scroll scale as row count may grow during indexing
        this.updateScrollScale();
        if (s.state === "ready") {
          this.setColumns(ds.getColumns());
        }
        this.needsDraw = true;
        this.schedule();
      });
    }
    if (typeof (ds as any).onDataWindow === "function") {
      (ds as any).onDataWindow?.(() => {
        // Redraw when data windows load or evict
        this.needsDraw = true;
        this.schedule();
      });
    }
    this.setColumns(ds.getColumns());
    this.updateScrollScale();
    const bottomRowHeight = this.hasBottomRow() ? this.getBottomRowHeight() : 0;
    const safeContent = Math.max(
      0,
      this.SAFE_CONTENT_PX - this.opts.headerHeight - bottomRowHeight
    );
    this.els.spacer.style.height = `${
      this.opts.headerHeight + safeContent + bottomRowHeight
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
    window.addEventListener(
      "scroll",
      () => {
        this.syncCanvasPosition();
      },
      { passive: true }
    );
    // Use viewport for click events since canvas has pointer-events: none
    this.els.viewport.addEventListener("click", (e) => {
      const rect = this.els.viewport.getBoundingClientRect();
      const x = e.clientX - rect.left + this.els.viewport.scrollLeft;
      const y = e.clientY - rect.top;
      const bottomRowHeight = this.hasBottomRow()
        ? this.getBottomRowHeight()
        : 0;
      const bottomRowStart = this.els.viewport.clientHeight - bottomRowHeight;

      // Check if click is in bottom row
      if (this.hasBottomRow() && y >= bottomRowStart) {
        // Check if click is on any clickable area
        for (const area of this.bottomRowClickableAreas) {
          if (
            x >= area.x &&
            x <= area.x + area.width &&
            y >= area.y &&
            y <= area.y + area.height
          ) {
            window.open(area.url, "_blank");
            return;
          }
        }
        return;
      }

      if (y < this.opts.headerHeight) return;

      // Calculate BigInt row identity for correctness beyond Number.MAX_SAFE_INTEGER
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
      this.selectedRowBig = firstRowBig + BigInt(rowInView);
      this.needsDraw = true;
      this.schedule();
    });
    this.els.viewport.addEventListener(
      "mousemove",
      (e) => {
        const rect = this.els.viewport.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const bottomRowHeight = this.hasBottomRow()
          ? this.getBottomRowHeight()
          : 0;
        const bottomRowStart = this.els.viewport.clientHeight - bottomRowHeight;
        if (y < this.opts.headerHeight) {
          if (this.hoveredRowBig != null) {
            this.hoveredRowBig = null;
            this.needsDraw = true;
            this.schedule();
          }
          return;
        }

        // Handle bottom row hover
        if (this.hasBottomRow() && y >= bottomRowStart) {
          // Check if hovering over clickable area
          let overClickableArea = false;
          const x = e.clientX - rect.left + this.els.viewport.scrollLeft;

          for (const area of this.bottomRowClickableAreas) {
            if (
              x >= area.x &&
              x <= area.x + area.width &&
              y >= area.y &&
              y <= area.y + area.height
            ) {
              overClickableArea = true;
              break;
            }
          }

          // Use viewport cursor since canvas has pointer-events: none
          this.els.viewport.style.cursor = overClickableArea
            ? "pointer"
            : "default";

          if (this.hoveredRowBig != null) {
            this.hoveredRowBig = null;
            this.needsDraw = true;
            this.schedule();
          }
          return;
        }

        // Reset cursor when not over bottom row
        this.els.viewport.style.cursor = "default";
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
        const nextHover = firstRowBig + BigInt(rowInView);
        if (this.hoveredRowBig !== nextHover) {
          this.hoveredRowBig = nextHover;
          this.hoverAlpha = 0;
          this.needsDraw = true;
          this.schedule();
        }
      },
      { passive: true }
    );
    this.els.viewport.addEventListener(
      "mouseleave",
      () => {
        this.hoveredRowBig = null;
        this.needsDraw = true;
        this.schedule();
      },
      { passive: true }
    );
    this.resize();
    // Ensure horizontal scrollbar can appear in host container
    if (!this.els.viewport.style.overflowX)
      this.els.viewport.style.overflowX = "auto";
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
    const totalRowsBig: bigint = this.ds
      ? this.ds.getRowCountBig && this.ds.getRowCountBig() !== undefined
        ? (this.ds.getRowCountBig() as bigint)
        : BigInt(this.ds.getRowCount())
      : BigInt(0);
    const bottomRowHeight = this.hasBottomRow() ? this.getBottomRowHeight() : 0;
    const visibleRows = Math.floor(
      (viewportHeight - this.opts.headerHeight - bottomRowHeight) /
        this.opts.rowHeight
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
    const bottomRowHeight = this.hasBottomRow() ? this.getBottomRowHeight() : 0;
    const visible = Math.max(
      0,
      this.els.viewport.clientHeight - this.opts.headerHeight - bottomRowHeight
    );
    const totalRows = this.ds?.getRowCount() ?? 0;
    const virt = Math.max(0, totalRows * this.opts.rowHeight - visible);
    const safeContentPx = Math.max(
      0,
      this.SAFE_CONTENT_PX - this.opts.headerHeight - bottomRowHeight
    );
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
    if (this.ds && this.columns.length) {
      const ds = this.ds as DataSource;
      const { widths, tableWidth } = estimateDataSourceWidths(
        this.ctx,
        this.columns,
        ds,
        this.opts.font
      );
      this.dynamicWidths = widths.slice();
      for (let i = 0; i < this.columns.length; i++) {
        this.colX.push(x);
        const w = widths[i] ?? 120;
        this.colW.push(w);
        x += w;
      }
      this.tableWidth = tableWidth;
    } else {
      // Fallback: distribute space but respect minimums
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

  // hover uses pointer position each frame; BigInt row helper removed

  private draw(): void {
    this.rafId = 0;
    if (!this.needsDraw) return;
    this.needsDraw = false;
    const w = this.els.viewport.clientWidth;
    const h = this.els.viewport.clientHeight;
    const scrollTop = this.els.viewport.scrollTop;
    const scrollLeft = this.els.viewport.scrollLeft;
    const ctx = this.ctx;
    // Hover easing: if we have a hovered row, ease in; else ease out
    const hoverTarget = this.hoveredRowBig != null ? 1 : 0;
    this.hoverAlpha += (hoverTarget - this.hoverAlpha) * 0.25;

    const theme = this.getTheme();
    ctx.clearRect(0, 0, w, h);

    // header bg
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, 0, w, this.opts.headerHeight);
    ctx.strokeStyle = theme.headerBorder;
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
    ctx.fillStyle = theme.headerText;
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
    const yStart = this.opts.headerHeight - offsetWithin;
    const maxVisible =
      Math.ceil((h - yStart) / this.opts.rowHeight) + this.opts.overscan;
    const totalRowsBig: bigint = this.ds
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

    // Prefetch visible window if supported
    if (this.ds && typeof (this.ds as any).prefetch === "function") {
      const start = Number(firstRowBig);
      const end = start + rowCount + this.opts.overscan;
      (this.ds as any).prefetch(start, end);
    }

    // rows
    ctx.save();
    ctx.beginPath();
    const bottomRowHeight = this.hasBottomRow() ? this.getBottomRowHeight() : 0;
    ctx.rect(
      0,
      this.opts.headerHeight,
      w,
      h - this.opts.headerHeight - bottomRowHeight
    );
    ctx.clip();
    ctx.save();
    ctx.translate(-scrollLeft, 0);

    let grew = false;
    const tableRemaining = Math.max(0, this.tableWidth - scrollLeft);
    const highlightW = this.tableWidth <= w ? w : Math.min(w, tableRemaining);
    // BigInt row index for hover this frame
    const hoveredRowBigForFrame = this.hoveredRowBig;
    for (let i = 0; i < rowCount; i++) {
      const rowIndexBig = firstRowBig + BigInt(i);
      const rowIndex =
        rowIndexBig > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(rowIndexBig);
      const y = yStart + i * this.opts.rowHeight;
      if (y > h) break;
      // Fill default row background first
      const defaultRowBg =
        typeof theme.rowBg === "function"
          ? theme.rowBg(rowIndexBig)
          : theme.rowBg;
      ctx.fillStyle = defaultRowBg;
      ctx.fillRect(0, y, this.tableWidth, this.opts.rowHeight);

      // Apply column-specific backgrounds if any columns have theme overrides
      for (let c = 0; c < this.columns.length; c++) {
        const column = this.columns[c];
        const columnTheme = column?.theme;
        if (columnTheme?.rowBg) {
          const cw = this.colW[c] ?? 0;
          const cx = this.colX[c] ?? 0;
          const columnRowBg =
            typeof columnTheme.rowBg === "function"
              ? columnTheme.rowBg(rowIndexBig)
              : columnTheme.rowBg;
          ctx.fillStyle = columnRowBg;
          ctx.fillRect(cx, y, cw, this.opts.rowHeight);
        }
      }

      const isSelected =
        this.selectedRowBig != null && rowIndexBig === this.selectedRowBig;
      if (isSelected) {
        ctx.fillStyle = theme.selectedHighlight(1);
        ctx.fillRect(0, y, highlightW, this.opts.rowHeight);
      }
      // hover highlight (under text), skip if selected; use BigInt identity
      const isHover =
        hoveredRowBigForFrame != null && rowIndexBig === hoveredRowBigForFrame;
      if (isHover && !isSelected) {
        const alpha = Math.max(0, Math.min(1, this.hoverAlpha)) * 0.1;
        if (alpha > 0.002) {
          ctx.fillStyle = theme.hoverHighlight(alpha);
          ctx.fillRect(0, y, highlightW, this.opts.rowHeight);
        }
      }

      let rowData: string[] = [];
      if (this.ds) {
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
      ctx.fillStyle = theme.rowText;
      ctx.textBaseline = "middle";
      ctx.font = this.opts.font;
      for (let c = 0; c < this.columns.length; c++) {
        const cw = this.colW[c] ?? 0;
        const cx = this.colX[c] ?? 0;
        const column = this.columns[c];
        const columnTheme = column?.theme;

        ctx.save();
        ctx.beginPath();
        ctx.rect(cx + 1, y + 1, Math.max(0, cw - 2), this.opts.rowHeight - 2);
        ctx.clip();

        // Apply column-level theme overrides
        if (columnTheme?.rowText) {
          ctx.fillStyle = columnTheme.rowText;
        }

        let text = rowData[c] ?? "";
        const isReady = !this.ds || !(this.ds as any).isRowReady || (this.ds as any).isRowReady(rowIndex);
        if (!isReady && c > 0) {
          text = "…";
          ctx.globalAlpha = 0.45;
        }
        if ((column?.align ?? "left") === "right") {
          ctx.textAlign = "right";
          ctx.fillText(text, cx + (cw - 8), y + this.opts.rowHeight / 2);
        } else {
          ctx.textAlign = "left";
          ctx.fillText(text, cx + 8, y + this.opts.rowHeight / 2);
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        // On-the-fly width growth based on measured text
        const measured = Math.ceil(ctx.measureText(text).width) + 16; // padding
        const minCol = this.columns[c]?.min ?? (c === 0 ? 60 : 120);
        const needed = Math.max(minCol, measured);
        if (needed > cw) {
          // Grow tracked width arrays lazily and schedule reflow
          this.colW[c] = needed;
          if (this.dynamicWidths) this.dynamicWidths[c] = needed;
          grew = true;
        }
      }
    }

    // vertical grid - draw column separators with column theme support
    for (let i = 0; i < this.columns.length; i++) {
      const column = this.columns[i];
      const columnTheme = column?.theme;
      const separatorColor =
        columnTheme?.columnSeparator ?? theme.columnSeparator;

      ctx.strokeStyle = separatorColor;
      ctx.beginPath();
      const x = (this.colX[i] ?? 0) + (this.colW[i] ?? 0) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // row separators
    ctx.strokeStyle = theme.rowSeparator;
    ctx.beginPath();
    for (let i = 0; i < rowCount; i++) {
      const rowIndexBig = firstRowBig + BigInt(i);
      const y = yStart + i * this.opts.rowHeight + this.opts.rowHeight + 0.5;
      if (y > h) break;

      // Skip separator if hoverSeparator is false and this row or next row is hovered
      if (!theme.hoverSeparator && hoveredRowBigForFrame != null) {
        const isCurrentRowHovered = rowIndexBig === hoveredRowBigForFrame;
        const isNextRowHovered =
          rowIndexBig + BigInt(1) === hoveredRowBigForFrame;
        if (isCurrentRowHovered || isNextRowHovered) {
          continue;
        }
      }

      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
    // If any column grew, recompute x positions and total width, then request redraw
    if (grew) {
      this.colX.length = 0;
      let nx = 0;
      for (let i = 0; i < this.colW.length; i++) {
        this.colX.push(nx);
        nx += this.colW[i] ?? 0;
      }
      this.tableWidth = nx;
      this.els.spacer.style.width = `${Math.max(
        this.tableWidth,
        this.els.viewport.clientWidth
      )}px`;
      this.needsDraw = true;
      this.schedule();
    }
    ctx.restore();

    // Render bottom row
    this.renderBottomRow(ctx, w, h, scrollLeft);

    // Continue hover animation during transitions
    if (hoverTarget === 0 && this.hoverAlpha < 0.01) {
      this.hoverAlpha = 0;
    }
    if (Math.abs(hoverTarget - this.hoverAlpha) > 0.01) {
      this.needsDraw = true;
      this.schedule();
    }

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

}
