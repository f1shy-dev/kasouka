export function forEachBatch(length: number, batchSize: number, fn: (start: number, end: number, batchIndex: number) => void) {
  const bs = Math.max(1, batchSize | 0);
  let i = 0;
  let b = 0;
  while (i < length) {
    const start = i;
    const end = Math.min(length, start + bs);
    fn(start, end, b++);
    i = end;
  }
}
