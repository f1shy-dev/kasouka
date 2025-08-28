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
  windowRows?: number; // rows per cached window
  maxWindows?: number; // LRU window cap
  loadingText?: string;
}

export class FileTableDataSource implements DataSource {
  private columns: Column[] = [{ key: "id", label: "#", min: 60, align: "right" }];
  private headerParsed = false;
  private offsetsBytes: number[] = [0]; // byte offsets for line starts, incl header start and trailing file.size
  private totalRows = 0;
  private status: DataSourceStatus = { state: "idle", progress: 0, message: "Idle" };
  private statusEv = new SimpleEvent<DataSourceStatus>();
  private dataEv = new SimpleEvent<DataWindowEvent>();

  private readonly enc: string;
  private readonly delimiter: Delimiter;
  private readonly windowRows: number;
  private readonly maxWindows: number;

  private cache = new Map<number, string[][]>(); // key: windowStartRow, value: rows [ [id,...cells], ...]
  private loading = new Map<number, Promise<void>>();
  private lru: number[] = [];

  constructor(private file: File | Blob, options: FileTableOptions = {}) {
    this.enc = options.encoding ?? "utf-8";
    this.delimiter = options.delimiter ?? ",";
    this.windowRows = Math.max(64, options.windowRows ?? 1024);
    this.maxWindows = Math.max(2, options.maxWindows ?? 16);
    this.setStatus({ state: "loading", progress: 0, message: options.loadingText ?? "Loading file" });
    queueMicrotask(() => void this.indexFile());
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

  private async indexFile(): Promise<void> {
    const size = this.file.size;
    const reader = (this.file as File).stream().getReader();
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
      // Scan for LF bytes; record offsets in bytes
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          const lineStartNext = byteBase + i + 1;
          this.offsetsBytes.push(lineStartNext);
          if (!headerFound) {
            // header ends at i; gather header bytes [0..i)
            const before = chunk.subarray(0, i);
            if (headerBuf.length) {
              const totalLen = headerBuf.reduce((a, b) => a + b.length, 0) + before.length;
              const joined = new Uint8Array(totalLen);
              let o = 0;
              for (const seg of headerBuf) {
                joined.set(seg, o);
                o += seg.length;
              }
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
      this.setStatus({
        state: "loading",
        progress: Math.min(1, bytesRead / Math.max(1, size)),
        message: `${this.status.message ?? "Loading"} (${((bytesRead / Math.max(1, size)) * 100).toFixed(1)}%)`,
      });
    }
    // Ensure trailing offset equals file size
    if (this.offsetsBytes[this.offsetsBytes.length - 1] !== size) {
      this.offsetsBytes.push(size);
    }
    // Compute data rows (exclude header line)
    this.totalRows = Math.max(0, this.offsetsBytes.length - 2);
    if (!this.headerParsed) {
      // decode header from 0..first LF if somehow not found (no newline file)
      const headerEnd = Math.min(size, this.offsetsBytes[1] ?? size);
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
    if (this.totalRows === 0) return; // not indexed yet
    const s = Math.max(0, Math.min(start | 0, this.totalRows));
    const e = Math.max(s, Math.min(end | 0, this.totalRows));
    const firstKey = this.windowKeyForRow(s);
    const lastKey = this.windowKeyForRow(Math.max(0, e - 1));
    for (let k = firstKey; k <= lastKey; k += this.windowRows) {
      if (!this.cache.has(k) && !this.loading.has(k)) void this.loadWindow(k);
    }
  }

  private async loadWindow(startRow: number): Promise<void> {
    if (this.loading.has(startRow)) return this.loading.get(startRow)!;
    const p = (async () => {
      const startOffset = this.offsetsBytes[startRow + 1];
      const endRowExclusive = Math.min(this.totalRows, startRow + this.windowRows);
      const endOffset = this.offsetsBytes[endRowExclusive + 1] ?? this.file.size;
      if (startOffset == null || endOffset == null || endOffset <= startOffset) return;
      const blob = this.file.slice(startOffset, endOffset);
      const buf = await blob.arrayBuffer();
      let text = new TextDecoder(this.enc).decode(buf);
      // Split exact rows; slice boundaries align to newlines so this is safe
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
      this.cache.set(startRow, rows);
      this.touchLRU(startRow);
      this.enforceLRU();
      this.dataEv.emit({ start: startRow, end: endRowExclusive, reason: "prefetch" });
    })();
    this.loading.set(startRow, p);
    try {
      await p;
    } finally {
      this.loading.delete(startRow);
    }
  }

  private touchLRU(key: number): void {
    const idx = this.lru.indexOf(key);
    if (idx >= 0) this.lru.splice(idx, 1);
    this.lru.push(key);
  }
  private enforceLRU(): void {
    while (this.lru.length > this.maxWindows) {
      const evict = this.lru.shift();
      if (evict == null) break;
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
