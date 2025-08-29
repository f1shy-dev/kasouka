import { inject } from "@vercel/analytics";
inject();
import { VirtualCanvasTable } from "kasouka";
import { EveryUUIDVirtualDataSource } from "kasouka/datasource/everyuuid";
import { FileTableDataSource } from "kasouka/datasource/file-table";
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
    theme: {
      rowBg: "#ffffff",
      selectedHighlight: () => "hsl(260deg, 91.2%, 59.8%, 0.15)",
      hoverHighlight: (alpha: number) => `hsl(260deg, 91.2%, 59.8%,${alpha})`,
      hoverSeparator: false,
      bottomRowText: "#666",
      bottomRowFont:
        "12px Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    scrollerHeight: 32_000,
    bottomRowModules: [
      { type: "dynamic-progress", loadingText: "Loading file" },
      "total-rows",
      {
        type: "github-link",
        position: "right",
        url: "https://github.com/f1shy-dev/kasouka",
      },
    ],
    bottomRowHeight: 24,
  }
);

const csvInput = document.createElement("input");
csvInput.type = "file";
csvInput.accept = ".csv,.tsv,.txt";
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

  table.setDataSource(new FileTableDataSource(file));
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
