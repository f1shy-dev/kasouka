import type { Column } from "../types";
import type { DataSource, DataSourceStatus, Unsubscribe } from ".";
import { SimpleEvent } from "../utils/events";
import { splitDelimitedLine } from "../utils/csv";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function indexLineOffsets(text: string): Uint32Array {
  let count = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  if (text.length && text.charCodeAt(text.length - 1) !== 10) count++;
  const out = new Uint32Array(count);
  let idx = 0;
  out[idx++] = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out[idx++] = i + 1;
  if (idx < count) out[idx] = text.length;
  return out;
}

export type Delimiter = "," | "\t" | string;

export interface FileTableOptions {
  delimiter?: Delimiter;
  encoding?: string;
  batchSize?: number;
  streamingThresholdBytes?: number; // default 25MB
  loadingText?: string;
}

export class FileTableDataSource implements DataSource {
  private columns: Column[] = [{ key: "id", label: "#", min: 60, align: "right" }];
  private headerParsed = false;
  private text: string = "";
  private offsets: Uint32Array = new Uint32Array([0, 0]);
  private rows = 0;
  private status: DataSourceStatus = { state: "idle", progress: 0, message: "Idle" };
  private statusEv = new SimpleEvent<DataSourceStatus>();
  private opts: Required<FileTableOptions>;

  constructor(private file: File | Blob, options: FileTableOptions = {}) {
    this.opts = {
      delimiter: options.delimiter ?? ",",
      encoding: options.encoding ?? "utf-8",
      batchSize: Math.max(32, options.batchSize ?? 4096),
      streamingThresholdBytes: options.streamingThresholdBytes ?? 25 * 1024 * 1024,
      loadingText: options.loadingText ?? "Loading file",
    };
    queueMicrotask(() => void this.load());
  }

  onStatus(listener: (status: DataSourceStatus) => void): Unsubscribe {
    return this.statusEv.on(listener);
  }
  getStatus(): DataSourceStatus {
    return this.status;
  }

  private setStatus(next: DataSourceStatus): void {
    this.status = next;
    this.statusEv.emit(next);
  }

  private setColumnsFromHeaderLine(headerLine: string): void {
    const delimiter = this.opts.delimiter ?? ",";
    const header = splitDelimitedLine(headerLine, delimiter);
    this.columns = [
      { key: "id", label: "#", min: 60, align: "right" },
      ...header.map((h, i) => ({
        key: `col_${i}`,
        label: String(h ?? `col${i + 1}`),
        min: 120,
        align: "left" as const,
      })),
    ];
    this.headerParsed = true;
  }

  private async load(): Promise<void> {
    const size = this.file.size;
    this.setStatus({ state: "loading", progress: 0, message: this.opts.loadingText });

    if (size <= this.opts.streamingThresholdBytes) {
      const text = await (this.file as File).text();
      const normalized = normalizeNewlines(text);
      // Header
      const firstNl = normalized.indexOf("\n");
      const headerLine = firstNl >= 0 ? normalized.slice(0, firstNl) : normalized;
      this.setColumnsFromHeaderLine(headerLine);
      this.text = normalized;
      this.offsets = indexLineOffsets(this.text);
      this.rows = Math.max(0, this.offsets.length - 2);
      this.setStatus({ state: "ready", progress: 1, message: `Loaded ${this.rows.toLocaleString()} rows` });
      return;
    }

    // Stream read into string builder, normalize newlines per chunk, batch-scan for line offsets
    const reader = (this.file as File).stream().getReader();
    const decoder = new TextDecoder(this.opts.encoding);
    let bytesRead = 0;
    let headerFound = false;
    const parts: string[] = [];
    const offs: number[] = [0];
    let charBase = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      const chunkText = decoder.decode(value, { stream: true });
      const chunkNorm = chunkText.replace(/\r\n?/g, "\n");
      parts.push(chunkNorm);
      // batch-scan for newlines
      const len = chunkNorm.length;
      for (let i = 0; i < len; i++) {
        if (chunkNorm.charCodeAt(i) === 10) offs.push(charBase + i + 1);
      }
      if (!headerFound) {
        const sofar = parts.join("");
        const nl = sofar.indexOf("\n");
        if (nl >= 0) {
          headerFound = true;
          const headerLine = sofar.slice(0, nl);
          this.setColumnsFromHeaderLine(headerLine);
        }
      }
      charBase += len;
      this.setStatus({
        state: "loading",
        progress: Math.min(1, bytesRead / Math.max(1, size)),
        message: `${this.opts.loadingText} (${((bytesRead / Math.max(1, size)) * 100).toFixed(1)}%)`,
      });
    }
    // finalize decoding
    const finalTail = decoder.decode();
    if (finalTail) {
      const tailNorm = finalTail.replace(/\r\n?/g, "\n");
      parts.push(tailNorm);
      for (let i = 0; i < tailNorm.length; i++) if (tailNorm.charCodeAt(i) === 10) offs.push(charBase + i + 1);
      charBase += tailNorm.length;
    }
    this.text = parts.join("");
    // ensure last offset is text length
    if (offs[offs.length - 1] !== this.text.length) offs.push(this.text.length);
    this.offsets = Uint32Array.from(offs);
    this.rows = Math.max(0, this.offsets.length - 2);
    if (!this.headerParsed) {
      const firstNl = this.text.indexOf("\n");
      const headerLine = firstNl >= 0 ? this.text.slice(0, firstNl) : this.text;
      this.setColumnsFromHeaderLine(headerLine);
    }
    this.setStatus({ state: "ready", progress: 1, message: `Loaded ${this.rows.toLocaleString()} rows` });
  }

  getRowCount(): number {
    return this.rows;
  }
  getColumns(): Column[] {
    return this.columns;
  }
  getRow(index: number): string[] {
    const out: string[] = new Array(this.columns.length);
    out[0] = String(index);
    if (!this.text || !this.offsets) return out;
    const start = this.offsets[index + 1];
    const end = this.offsets[index + 2] ?? this.text.length;
    if (start == null || start >= this.text.length) return out;
    const line = this.text.slice(start, Math.min(end, this.text.length));
    const cells = splitDelimitedLine(line, this.opts.delimiter);
    for (let c = 1; c < this.columns.length; c++) out[c] = cells[c - 1] ?? "";
    return out;
  }
  *sampleRows(max: number): Iterable<string[]> {
    const total = this.getRowCount();
    const take = Math.min(Math.max(50, max), 1000);
    if (take <= 0 || total <= 0) return;
    const step = Math.max(1, Math.floor(total / take));
    for (let r = 0; r < total; r += step) yield this.getRow(r);
  }
}
