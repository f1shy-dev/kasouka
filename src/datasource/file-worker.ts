/* Web Worker for FileTableDataSource */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMsg = any;

interface InitMsg {
  type: "init";
  file: File;
  encoding?: string;
  delimiter?: string;
}
interface IndexMsg { type: "index" }
interface LoadWindowMsg {
  type: "loadWindow";
  id: number;
  startOffset: number;
  endOffset: number;
  startRow: number;
  count: number;
  colCount: number;
}
interface CancelMsg { type: "cancel"; ids: number[] }

type InMsg = InitMsg | IndexMsg | LoadWindowMsg | CancelMsg;

/// <reference lib="WebWorker" />

const g = {
  file: null as File | null,
  enc: "utf-8",
  delimiter: ",",
};

const canceled = new Set<number>();

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    g.file = msg.file;
    g.enc = msg.encoding || "utf-8";
    g.delimiter = msg.delimiter || ",";
    return;
  }
  if (msg.type === "index") {
    void indexFile();
    return;
  }
  if (msg.type === "loadWindow") {
    void loadWindow(msg);
    return;
  }
  if (msg.type === "cancel") {
    for (const id of msg.ids) canceled.add(id);
    return;
  }
};

function splitQuotedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line.charCodeAt(i);
    if (ch === 34) {
      i++;
      let start = i;
      let buf = "";
      while (i < n) {
        const c = line.charCodeAt(i);
        if (c === 34) {
          if (i + 1 < n && line.charCodeAt(i + 1) === 34) {
            buf += `${line.slice(start, i)}"`;
            i += 2;
            start = i;
            continue;
          }
          buf += line.slice(start, i);
          i++;
          break;
        }
        i++;
      }
      if (i < n && line.startsWith(delimiter, i)) i += delimiter.length;
      cells.push(buf);
    } else {
      const start = i;
      const next = delimiter === "\t" ? line.indexOf("\t", i) : line.indexOf(delimiter, i);
      if (next === -1) {
        cells.push(line.slice(start, n));
        i = n;
      } else {
        cells.push(line.slice(start, next));
        i = next + delimiter.length;
      }
    }
  }
  return cells;
}

async function indexFile(): Promise<void> {
  const file = g.file as File;
  const size = file.size;
  const reader = file.stream().getReader();
  const offsets: number[] = [0];
  let byteBase = 0;
  let bytesRead = 0;
  let headerFound = false;
  const headerBufs: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = value as Uint8Array;
    // scan for LFs
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x0a) {
        const next = byteBase + i + 1;
        offsets.push(next);
        if (!headerFound) {
          const before = chunk.subarray(0, i);
          if (headerBufs.length) {
            const total = headerBufs.reduce((a, b) => a + b.length, 0) + before.length;
            const joined = new Uint8Array(total);
            let o = 0;
            for (const seg of headerBufs) { joined.set(seg, o); o += seg.length; }
            joined.set(before, o);
            postMessage({ type: "header", header: new TextDecoder(g.enc).decode(joined) });
          } else {
            postMessage({ type: "header", header: new TextDecoder(g.enc).decode(before) });
          }
          headerFound = true;
        }
      }
    }
    if (!headerFound) headerBufs.push(chunk);
    byteBase += chunk.length;
    bytesRead += chunk.length;
    postMessage({ type: "index-progress", bytesRead, size });
  }
  if (offsets[offsets.length - 1] !== size) offsets.push(size);
  const rows = Math.max(0, offsets.length - 2);
  const arr = new Uint32Array(offsets);
  (postMessage as any)({ type: "index-done", offsets: arr, rows }, { transfer: [arr.buffer] as any });
}

async function loadWindow(msg: LoadWindowMsg): Promise<void> {
  const id = msg.id;
  canceled.delete(id);
  const file = g.file as File;
  const reader = file.slice(msg.startOffset, msg.endOffset).stream().getReader();
  const td = new TextDecoder(g.enc);
  const parts: string[] = [];
  let total = 0;
  while (true) {
    if (canceled.has(id)) {
      try { await reader.cancel(); } catch {}
      postMessage({ type: "window-canceled", id });
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    parts.push(td.decode(value, { stream: true }));
    total += (value as Uint8Array).byteLength;
  }
  parts.push(td.decode());
  const text = parts.join("");
  const lines = text.split("\n");
  const rows: string[][] = new Array(msg.count);
  for (let i = 0; i < rows.length; i++) {
    let line = lines[i] ?? "";
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const cells = splitQuotedLine(line, g.delimiter);
    const rowIdx = msg.startRow + i;
    const out: string[] = new Array(msg.colCount);
    out[0] = String(rowIdx);
    for (let c = 1; c < msg.colCount; c++) out[c] = cells[c - 1] ?? "";
    rows[i] = out;
  }
  postMessage({ type: "window-done", id, startRow: msg.startRow, rows, bytes: total });
}
