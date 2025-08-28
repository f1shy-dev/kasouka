import { VirtualCanvasTable, makeCsvData } from "kasouka";

import { EveryUUIDVirtualDataSource } from "kasouka/datasource/every-uuid";
import { CsvDataSource } from "kasouka/datasource/csv";

const $ = <T extends HTMLElement>(selector: string) =>
  document.querySelector(selector) as T | null;

const viewport = $("#viewport");
const spacer = $("#spacer");
const canvas = $<HTMLCanvasElement>("#layer");
const csvRadio = $<HTMLInputElement>("#dataSourceCsv");
const uuidRadio = $<HTMLInputElement>("#dataSourceUuid");
const toggleBg = $("#toggleBackground");

if (!viewport || !spacer || !canvas || !csvRadio || !uuidRadio || !toggleBg) {
  throw new Error("Missing required elements");
}

const table = new VirtualCanvasTable(
  { viewport, spacer, canvas },
  {
    headerHeight: 24,
    rowHeight: 24,
    overscan: 4,
    font: "14px Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    zebra: false,
  }
);

const csvInput = document.createElement("input");
csvInput.type = "file";
csvInput.accept = ".csv";
csvInput.style.display = "none";
document.body.appendChild(csvInput);

function updateTogglePosition() {
  if (!uuidRadio || !toggleBg) return;

  if (uuidRadio.checked) {
    toggleBg.style.transform = "translateX(calc(100% + 2px))";
  } else {
    toggleBg.style.transform = "translateX(-2px)";
  }
}

function switchToVirtualData() {
  table.setDataSource(new EveryUUIDVirtualDataSource());
}

async function handleCsvUpload() {
  const file = csvInput.files?.[0];
  if (!file) return;

  const text = await file.text();
  const csv = makeCsvData(text);
  table.setDataSource(new CsvDataSource(csv));
}

csvRadio.addEventListener("change", () => {
  updateTogglePosition();
  csvInput.click();
});

uuidRadio.addEventListener("change", () => {
  updateTogglePosition();
  switchToVirtualData();
});

csvInput.addEventListener("change", handleCsvUpload);

switchToVirtualData();
updateTogglePosition();
