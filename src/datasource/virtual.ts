import type { DataSource } from ".";
import type { Column } from "../types";

export class ExampleVirtualDataSource implements DataSource {
  private columns: Column[];
  private rows: number | bigint;
  constructor(config: {
    rows: number | bigint;
    getRow?: (index: number) => string[];
  }) {
    this.rows = config.rows;
    this.getRow = config.getRow ?? this.getRow;
    this.columns = [
      { key: "id", label: "#", min: 70, align: "right" },
      { key: "value", label: "Value", min: 320, align: "left" },
    ];
  }
  getRowCount(): number {
    if (typeof this.rows === "bigint") {
      return this.rows > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(this.rows);
    }
    return this.rows;
  }
  getRowCountBig?(): bigint {
    return typeof this.rows === "bigint" ? this.rows : BigInt(this.rows);
  }
  getColumns(): Column[] {
    return this.columns;
  }
  getRow(index: number): string[] {
    const id = String(index);
    const value = this.uuidFromIndex(index);
    return [id, value];
  }
  getRowBig?(index: bigint): string[] {
    const id = index.toString();
    // Reduce bigint to number chunks deterministically for UUID generation
    const mod = Number(index % BigInt(0xffffffff));
    const value = this.uuidFromIndex(mod);
    return [id, value];
  }
  *sampleRows(max: number): Iterable<string[]> {
    const total =
      typeof this.rows === "bigint"
        ? Number(
            this.rows > BigInt(Number.MAX_SAFE_INTEGER)
              ? BigInt(Number.MAX_SAFE_INTEGER)
              : this.rows
          )
        : this.rows;
    const take = Math.min(Math.max(50, max), 1000);
    if (take <= 0 || total <= 0) return;
    const step = Math.max(1, Math.floor(total / take));
    for (let r = 0; r < total; r += step) yield this.getRow(r);
  }
  private uuidFromIndex(index: number): string {
    let x = (index ^ 0x9e3779b9) >>> 0;
    const bytes = new Uint8Array(16);
    function xs() {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x >>> 0;
    }
    for (let i = 0; i < 16; i += 4) {
      const r = xs();
      bytes[i] = r & 255;
      bytes[i + 1] = (r >>> 8) & 255;
      bytes[i + 2] = (r >>> 16) & 255;
      bytes[i + 3] = (r >>> 24) & 255;
    }
    // biome-ignore lint/style/noNonNullAssertion: it won't be null
    bytes[6] = (bytes[6]! & 15) | 64;
    // biome-ignore lint/style/noNonNullAssertion: it won't be null
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
}
