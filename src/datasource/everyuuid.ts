import type { DataSource } from ".";
import type { Column } from "../types";

// Maps each index in [0, 2^122) bijectively to a UUID v4 (RFC 4122)
// by filling the 122 random bits and fixing version/variant bits.
export class EveryUUIDVirtualDataSource implements DataSource {
  private static readonly TOTAL_UUIDS_BIG = 1n << 122n; // 2^122 unique v4 UUIDs
  private readonly columns: Column[] = [
    { key: "id", label: "#", align: "left", theme: { rowText: "#666" } },
    { key: "uuid", label: "UUID", align: "left" },
  ];

  getRowCount(): number {
    // Cap to max safe int for number-based APIs
    return Number.MAX_SAFE_INTEGER;
  }

  getRowCountBig?(): bigint {
    return EveryUUIDVirtualDataSource.TOTAL_UUIDS_BIG;
  }

  getColumns(): Column[] {
    return this.columns;
  }

  getRow(index: number): string[] {
    const id = String(index);
    const uuid = this.indexToUuid(BigInt(index));
    return [id, uuid];
  }

  getRowBig?(index: bigint): string[] {
    const id = index.toString();
    const uuid = this.indexToUuid(index);
    return [id, uuid];
  }

  *sampleRows(max: number): Iterable<string[]> {
    const take = Math.min(Math.max(50, max), 1000);
    if (take <= 0) return;
    const step = Math.max(1, Math.floor(Number.MAX_SAFE_INTEGER / take));
    for (let r = 0; r < Number.MAX_SAFE_INTEGER; r += step) {
      if (r >= Number.MAX_SAFE_INTEGER) break;
      yield this.getRow(r);
    }
  }

  private indexToUuid(index: bigint): string {
    const total = EveryUUIDVirtualDataSource.TOTAL_UUIDS_BIG;
    let v = ((index % total) + total) % total; // normalize
    const bytes = new Uint8Array(16);

    // Fill bytes 15..9 (56 bits)
    for (let i = 15; i >= 9; i--) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }

    // Byte 8: lower 6 bits are random
    bytes[8] = Number(v & 0x3fn);
    v >>= 6n;

    // Byte 7: full 8 random bits
    bytes[7] = Number(v & 0xffn);
    v >>= 8n;

    // Byte 6: lower 4 random bits; high 4 will be version (0100)
    bytes[6] = Number(v & 0x0fn);
    v >>= 4n;

    // Bytes 5..0 (48 bits)
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }

    // Set version (0100) and variant (10)
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      ""
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16
    )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
}
