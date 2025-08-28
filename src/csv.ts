import type { CsvData } from "./types.ts";

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function indexLineOffsets(text: string): Uint32Array {
  let count = 1; // start with first offset 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  // if text doesn't end with newline, last line still counts
  if (text.length && text.charCodeAt(text.length - 1) !== 10) count++;
  const out = new Uint32Array(count);
  let idx = 0 as number;
  out[idx] = 0;
  idx++;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) out[idx++] = i + 1;
  }
  if (idx < count) out[idx] = text.length;
  return out;
}

export function parseHeader(text: string, offsets: Uint32Array): string[] {
  const headerEnd = offsets[1] ?? text.indexOf("\n");
  const headerLine = text.slice(0, headerEnd >= 0 ? headerEnd : text.length);
  return splitCsvLine(headerLine);
}

export function makeCsvData(text: string): CsvData {
  const normalized = normalizeNewlines(text);
  const offsets = indexLineOffsets(normalized);
  const header = parseHeader(normalized, offsets);
  const rows = Math.max(0, offsets.length - 2);
  return { text: normalized, offsets, header, rows };
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0 as number;
  const n = line.length;
  while (i < n) {
    const ch = line.charCodeAt(i);
    if (ch === 34) {
      // quoted
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
      if (i < n && line.charCodeAt(i) === 44) i++;
      cells.push(buf);
    } else {
      const start = i;
      while (i < n && line.charCodeAt(i) !== 44) i++;
      cells.push(line.slice(start, i));
      if (i < n && line.charCodeAt(i) === 44) i++;
    }
  }
  return cells;
}
