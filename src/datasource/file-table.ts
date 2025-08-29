import type { Column } from "../types";
import type {
  DataSource,
  DataSourceStatus,
  Unsubscribe,
  DataWindowEvent,
} from ".";
import { SimpleEvent } from "../utils/events";
import { splitDelimitedLine } from "../utils/csv";

export type Delimiter = "," | "\t" | string;

export interface FileTableOptions {
  delimiter?: Delimiter;
  encoding?: string;
  windowRows?: number;
  maxWindows?: number;
  cacheBudgetMB?: number;
  prefetchDebounceMs?: number;
  loadingText?: string;
}

export class FileTableDataSource implements DataSource {
  private columns: Column[] = [{ key: "id", label: "#", min: 60, align: "right" }];
  private headerParsed = false;
  private offsetsBytes: Uint32Array = new Uint32Array([0]);
  private totalRows = 0;
  private status: DataSourceStatus = { state: "idle", progress: 0, message: "Idle" };
  private statusEv = new SimpleEvent<DataSourceStatus>();
  private dataEv = new SimpleEvent<DataWindowEvent>();

  private readonly enc: string;
  private readonly delimiter: Delimiter;
  private readonly windowRows: number;
  private readonly maxWindows: number;
  private readonly budgetBytes: number;
  private readonly prefetchDebounceMs: number;

  private cache = new Map<number, { rows: string[][]; bytes: number }>();
  private loading = new Map<number, Promise<void>>();
  private lru: number[] = [];
  private cacheBytes = 0;

  private worker?: Worker;
  private loadGen = 0;
  private wantedKeys = new Set<number>();
  private wantedAnchor = 0;
  private prefetchTimer: number | undefined;
  private inflightId: number | null = null;
  private inflightKey: number | null = null;
  private canceledIds = new Set<number>();

  constructor(private file: File | Blob, options: FileTableOptions = {}) {
    this.enc = options.encoding ?? "utf-8";
    this.delimiter = options.delimiter ?? ",";
    this.windowRows = Math.max(64, options.windowRows ?? 1024);
    this.maxWindows = Math.max(2, options.maxWindows ?? 16);
    this.budgetBytes = Math.max(8, options.cacheBudgetMB ?? 50) * 1024 * 1024;
    this.prefetchDebounceMs = Math.max(0, options.prefetchDebounceMs ?? 25);
    this.setStatus({ state: "loading", progress: 0, message: options.loadingText ?? "Loading file" });
    this.initWorker();
  }

  onStatus(listener: (status: DataSourceStatus) => void): Unsubscribe {
    return this.statusEv.on(listener);
  }
  getStatus(): DataSourceStatus {
    return this.status;
  }
  onDataWindow(listener: (ev: DataWindowEvent) => void): Unsubscribe {
    return this.dataEv.on(listener);
  }

  private setStatus(next: DataSourceStatus): void {
    this.status = next;
    this.statusEv.emit(next);
  }

  private setColumnsFromHeaderBytes(headerBytes: Uint8Array): void {
    let header = new TextDecoder(this.enc).decode(headerBytes);
    if (header.endsWith("\r")) header = header.slice(0, -1);
    const cells = splitDelimitedLine(header, this.delimiter);
    this.columns = [
      { key: "id", label: "#", min: 60, align: "right" },
      ...cells.map((h, i) => ({
        key: `col_${i}`,
        label: String(h ?? `col${i + 1}`),
        min: 120,
        align: "left" as const,
      })),
    ];
    this.headerParsed = true;
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL("./file-worker.ts", import.meta.url), { type: "module" });
      const file = this.file as File;
      this.worker.postMessage({ type: "init", file, encoding: this.enc, delimiter: this.delimiter });
      this.worker.onmessage = (ev: MessageEvent) => this.onWorkerMessage(ev.data);
      this.worker.postMessage({ type: "index" });
    } catch (e) {
      // Fallback to main-thread indexing
      void this.indexFileMain();
    }
  }


  while (true) {
    if (canceled.has(id)) { try { await reader.cancel(); } catch (_) {} postMessage({ type: 'window-canceled', id }); return; }
    const { value, done } = await reader.read(); if (done) break; if (!value) continue;
    parts.push(td.decode(value, { stream: true })); total += value.byteLength;
  }
  parts.push(td.decode());
  let text = parts.join('');
  const lines = text.split('\n');
  const rows = new Array(msg.count);
  for (let i = 0; i < msg.count; i++) {
    let line = lines[i] || ''; if (line.endsWith('\r')) line = line.slice(0,-1);
    const cells = splitQuotedLine(line, g.delimiter);
    const rowIdx = msg.startRow + i;
    const out = new Array(msg.colCount);
    out[0] = String(rowIdx);
    for (let c = 1; c < msg.colCount; c++) out[c] = cells[c - 1] || '';
    rows[i] = out;
  }
  postMessage({ type: 'window-done', id, startRow: msg.startRow, rows, bytes: total });
}
`;
  }

  private onWorkerMessage(msg: any): void {
    if (msg.type === "index-progress") {
      const size = (this.file as File).size;
      this.setStatus({ state: "loading", progress: Math.min(1, (msg.bytesRead || 0) / Math.max(1, size)), message: this.status.message });
      return;
    }
    if (msg.type === "header") {
      const h = msg.header as string;
      let header = h.endsWith("\r") ? h.slice(0, -1) : h;
      const cells = splitDelimitedLine(header, this.delimiter);
      this.columns = [
        { key: "id", label: "#", min: 60, align: "right" },
        ...cells.map((t: string, i: number) => ({ key: `col_${i}`, label: String(t ?? `col${i + 1}`), min: 120, align: "left" as const })),
      ];
      this.headerParsed = true;
      return;
    }
    if (msg.type === "index-done") {
      this.offsetsBytes = msg.offsets as Uint32Array;
      this.totalRows = msg.rows as number;
      this.setStatus({ state: "ready", progress: 1, message: `Loaded ${this.totalRows.toLocaleString()} rows` });
      return;
    }
    if (msg.type === "window-done") {
      const { id, startRow, rows, bytes } = msg as { id: number; startRow: number; rows: string[][]; bytes: number };
      if (this.canceledIds.has(id)) return; // dropped due to cancel
      this.cache.set(startRow, { rows, bytes });
      this.cacheBytes += bytes;
      this.touchLRU(startRow);
      this.enforceLRU();
      this.dataEv.emit({ start: startRow, end: startRow + rows.length, reason: "prefetch" });
      if (this.inflightId === id) { this.inflightId = null; this.inflightKey = null; }
      this.processQueue();
      return;
    }
    if (msg.type === "window-canceled") {
      // ignore
      return;
    }
  }

  private async indexFileMain(): Promise<void> {
    const size = this.file.size;
    const reader = (this.file as File).stream().getReader();
    const offsets: number[] = [0];
    let byteBase = 0;
    let bytesRead = 0;
    let headerFound = false;
    let headerBuf: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      const chunk = value as Uint8Array;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          offsets.push(byteBase + i + 1);
          if (!headerFound) {
            const before = chunk.subarray(0, i);
            if (headerBuf.length) {
              const totalLen = headerBuf.reduce((a, b) => a + b.length, 0) + before.length;
              const joined = new Uint8Array(totalLen);
              let o = 0;
              for (const seg of headerBuf) { joined.set(seg, o); o += seg.length; }
              joined.set(before, o);
              this.setColumnsFromHeaderBytes(joined);
              headerBuf = [];
            } else {
              this.setColumnsFromHeaderBytes(before);
            }
            headerFound = true;
          }
        }
      }
      if (!headerFound) headerBuf.push(chunk);
      byteBase += chunk.length;
      this.setStatus({ state: "loading", progress: Math.min(1, bytesRead / Math.max(1, size)), message: this.status.message });
    }
    if (offsets[offsets.length - 1] !== size) offsets.push(size);
    this.offsetsBytes = Uint32Array.from(offsets);
    this.totalRows = Math.max(0, offsets.length - 2);
    if (!this.headerParsed) {
      const headerEnd = Math.min(size, offsets[1] ?? size);
      const buf = new Uint8Array(await (this.file.slice(0, headerEnd)).arrayBuffer());
      this.setColumnsFromHeaderBytes(buf);
    }
    this.setStatus({ state: "ready", progress: 1, message: `Loaded ${this.totalRows.toLocaleString()} rows` });
  }

  private windowKeyForRow(index: number): number {
    return Math.floor(index / this.windowRows) * this.windowRows;
  }

  isRowReady(index: number): boolean {
    const k = this.windowKeyForRow(index);
    const win = this.cache.get(k);
    return !!(win && index >= k && index < k + win.length);
  }

  async getRowAsync(index: number): Promise<string[]> {
    const k = this.windowKeyForRow(index);
    if (!this.cache.has(k)) await this.loadWindow(k);
    return this.getRow(index);
  }

  getRow(index: number): string[] {
    const out: string[] = new Array(this.columns.length);
    out[0] = String(index);
    const k = this.windowKeyForRow(index);
    const win = this.cache.get(k);
    if (win) {
      const row = win[index - k];
      if (row) return row;
    } else {
      // kick off async load
      this.prefetch(index, index + 1);
    }
    // placeholder
    for (let c = 1; c < this.columns.length; c++) out[c] = "";
    return out;
  }

  prefetch(start: number, end: number): void {
    if (this.totalRows === 0) return;
    const s = Math.max(0, Math.min(start | 0, this.totalRows));
    const e = Math.max(s, Math.min(end | 0, this.totalRows));
    this.wantedKeys.clear();
    const firstKey = this.windowKeyForRow(s);
    const lastKey = this.windowKeyForRow(Math.max(0, e - 1));
    for (let k = firstKey; k <= lastKey; k += this.windowRows) this.wantedKeys.add(k);
    this.wantedAnchor = Math.floor((s + e) / 2);
    if (this.prefetchTimer) window.clearTimeout(this.prefetchTimer);
    this.prefetchTimer = window.setTimeout(() => this.processQueue(), this.prefetchDebounceMs);
  }

  private processQueue(): void {
    // Cancel inflight if no longer wanted
    if (this.inflightKey != null && !this.wantedKeys.has(this.inflightKey)) {
      if (this.inflightId != null && this.worker) {
        this.canceledIds.add(this.inflightId);
        this.worker.postMessage({ type: "cancel", ids: [this.inflightId] });
      }
      this.inflightId = null;
      this.inflightKey = null;
    }
    if (this.inflightId != null) return; // busy
    // Pick next wanted key not cached
    const anchorKey = this.windowKeyForRow(this.wantedAnchor);
    let bestKey: number | null = null;
    let bestDist = Infinity;
    for (const k of this.wantedKeys) {
      if (this.cache.has(k)) continue;
      if (this.loading.has(k)) continue;
      const dist = Math.abs(k - anchorKey);
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = k;
      }
    }
    if (bestKey == null) return;
    // Dispatch load
    const startRow = bestKey;
    const endRowExclusive = Math.min(this.totalRows, startRow + this.windowRows);
    const startOffset = this.offsetsBytes[startRow + 1];
    const endOffset = this.offsetsBytes[endRowExclusive + 1] ?? (this.file.size as number);
    if (startOffset == null || endOffset == null || endOffset <= startOffset) return;
    if (this.worker) {
      const id = ++this.loadGen;
      this.inflightId = id;
      this.inflightKey = bestKey;
      this.worker.postMessage({
        type: "loadWindow",
        id,
        startOffset,
        endOffset,
        startRow,
        count: endRowExclusive - startRow,
        colCount: this.columns.length,
      });
    } else {
      // Fallback main thread
      void this.loadWindowMain(bestKey);
    }
  }

  private async loadWindowMain(startRow: number): Promise<void> {
    if (this.loading.has(startRow)) return this.loading.get(startRow)!;
    const p = (async () => {
      const startOffset = this.offsetsBytes[startRow + 1];
      const endRowExclusive = Math.min(this.totalRows, startRow + this.windowRows);
      const endOffset = this.offsetsBytes[endRowExclusive + 1] ?? this.file.size;
      if (startOffset == null || endOffset == null || endOffset <= startOffset) return;
      const blob = this.file.slice(startOffset, endOffset);
      const buf = await blob.arrayBuffer();
      const bytes = (buf as ArrayBuffer).byteLength;
      const text = new TextDecoder(this.enc).decode(buf);
      const lines = text.split("\n");
      const rows: string[][] = new Array(endRowExclusive - startRow);
      for (let i = 0; i < rows.length; i++) {
        let line = lines[i] ?? "";
        if (line.endsWith("\r")) line = line.slice(0, -1);
        const cells = splitDelimitedLine(line, this.delimiter);
        const rowIdx = startRow + i;
        const out: string[] = new Array(this.columns.length);
        out[0] = String(rowIdx);
        for (let c = 1; c < this.columns.length; c++) out[c] = cells[c - 1] ?? "";
        rows[i] = out;
      }
      this.cache.set(startRow, { rows, bytes });
      this.cacheBytes += bytes;
      this.touchLRU(startRow);
      this.enforceLRU();
      this.dataEv.emit({ start: startRow, end: endRowExclusive, reason: "prefetch" });
    })();
    this.loading.set(startRow, p);
    try {
      await p;
    } finally {
      this.loading.delete(startRow);
      this.processQueue();
    }
  }

  private touchLRU(key: number): void {
    const idx = this.lru.indexOf(key);
    if (idx >= 0) this.lru.splice(idx, 1);
    this.lru.push(key);
  }
  private enforceLRU(): void {
    while (this.lru.length > this.maxWindows || this.cacheBytes > this.budgetBytes) {
      const evict = this.lru.shift();
      if (evict == null) break;
      const meta = this.cache.get(evict);
      if (meta) this.cacheBytes -= meta.bytes || 0;
      this.cache.delete(evict);
      this.dataEv.emit({ start: evict, end: evict + this.windowRows, reason: "cache-evict" });
    }
  }

  getRowCount(): number {
    return this.totalRows;
  }
  getColumns(): Column[] {
    return this.columns;
  }
  *sampleRows(max: number): Iterable<string[]> {
    const total = this.getRowCount();
    const take = Math.min(Math.max(50, max), 1000);
    if (take <= 0 || total <= 0) return;
    const step = Math.max(1, Math.floor(total / take));
    for (let r = 0; r < total; r += step) yield this.getRow(r);
  }
}
