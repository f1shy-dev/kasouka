export function splitDelimitedLine(line: string, delimiter = ","): string[] {
  if (delimiter === ",") return splitCsvLine(line);
  if (delimiter === "\t") return splitTsvLine(line);
  // Generic: fast path without quotes
  if (!line.includes("\"")) return line.split(delimiter);
  // Fallback: CSV rules with custom delimiter treated as separator
  return splitQuotedLine(line, delimiter);
}

export function splitCsvLine(line: string): string[] {
  return splitQuotedLine(line, ",");
}

export function splitTsvLine(line: string): string[] {
  // TSV rarely uses quotes; support simple quoted cells as well
  return splitQuotedLine(line, "\t");
}

function splitQuotedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let i = 0;
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
