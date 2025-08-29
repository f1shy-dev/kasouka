import { inject } from "@vercel/analytics";
inject();
import { VirtualCanvasTable, makeCsvData } from "kasouka";
import { EveryUUIDVirtualDataSource } from "kasouka/datasource/everyuuid";

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
    baseFont:
      "14px Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    overscan: 4,
    header: {
      enabled: true,
      background: "#fff",
      text: "#222",
      border: "#eee",
      height: 24,
    },
    cells: {
      background: "#ffffff",
      text: "#222",
      height: 24,
    },
    bottomRow: {
      enabled: true,
      background: "#fff",
      text: "#666",
      font: "12px Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      height: 24,
      modules: [
        "scroll-position",
        "total-rows",
        {
          type: "github-link",
          position: "right",
          url: "https://github.com/f1shy-dev/kasouka",
        },
      ],
    },
    selectedHighlight: () => "hsl(260deg, 91.2%, 59.8%, 0.15)",
    hoverHighlight: (alpha: number) => `hsl(260deg, 91.2%, 59.8%,${alpha})`,
    scrollerHeight: 32_000,
  }
);

const csvInput = document.createElement("input");
csvInput.type = "file";
csvInput.accept = ".csv";
csvInput.style.display = "none";
document.body.appendChild(csvInput);

function updateTogglePosition() {
  if (!uuidRadio || !toggleBg) return;

  if (!uuidRadio.checked) {
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
