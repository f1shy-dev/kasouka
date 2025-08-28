import { VirtualCanvasTable } from "virtual-ts";
import { makeCsvData } from "virtual-ts";

const viewport = document.getElementById("viewport") as HTMLElement | null;
const spacer = document.getElementById("spacer") as HTMLElement | null;
const canvas = document.getElementById("layer") as HTMLCanvasElement | null;
const debugOverlay = document.getElementById(
  "debugOverlay"
) as HTMLDivElement | null;
const csvInput = document.getElementById("csvInput") as HTMLInputElement | null;
if (!viewport || !spacer || !canvas || !csvInput)
  throw new Error("Missing required elements");
const table = new VirtualCanvasTable(
  { viewport, spacer, canvas, debugOverlay },
  {
    headerHeight: 24,
    rowHeight: 24,
    overscan: 4,
    font: "13px Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    zebra: true,
  }
);

csvInput.addEventListener("change", async () => {
  const f = csvInput.files?.[0];
  if (!f) return;
  const text = await f.text();
  const csv = makeCsvData(text);
  table.setCsv(csv);
});
