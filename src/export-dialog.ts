import { panel } from "./panel.ts";
import { exportZip } from "./export.ts";
import type {
  ExportDocument,
  ExportFormat,
  ExportSelection,
} from "./export.ts";

export function createExportController(
  getDocuments: () => readonly ExportDocument[],
  notify: (message: string) => void,
) {
  function element<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing export element: ${id}`);
    return el as T;
  }
  const list = element<HTMLDivElement>("export-list");
  const error = element<HTMLParagraphElement>("export-error");
  const summary = element<HTMLSpanElement>("export-summary");
  const save = element<HTMLButtonElement>("export-save");
  const close = element<HTMLButtonElement>("export-close");
  let rows: ExportSelection[] = [],
    busy = false;

  function updateSummary() {
    const conf = rows.filter((row) => row.format === "conf").length;
    const qr = rows.filter((row) => row.format === "qr").length;
    summary.textContent = `${conf + qr}개 선택 · .conf ${conf}개 · QR코드 ${qr}개`;
    save.disabled = busy || conf + qr === 0;
  }
  function setBusy(value: boolean) {
    busy = value;
    save.textContent = value ? "저장 준비 중…" : "저장하기";
    close.disabled = value;
    list
      .querySelectorAll("select")
      .forEach((select) => (select.disabled = value));
    updateSummary();
  }
  async function download(selections: readonly ExportSelection[]) {
    const bytes = await exportZip(selections);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "wireguard-configs.zip";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("설정을 ZIP 파일로 다운로드했습니다.");
  }
  close.onclick = () => panel.close("export-dialog");
  save.onclick = async () => {
    if (busy) return;
    error.textContent = "";
    setBusy(true);
    try {
      await download(rows.map((row) => ({ ...row })));
      panel.close("export-dialog");
    } catch (reason) {
      error.textContent =
        reason instanceof Error ? reason.message : String(reason);
    } finally {
      setBusy(false);
    }
  };
  function refreshRows() {
    const scrollTop = list.scrollTop;
    const formats = new Map(rows.map((row) => [row.id, row.format]));
    rows = getDocuments().map((doc) => ({
      ...doc,
      format: formats.get(doc.id) ?? "conf",
    }));
    list.replaceChildren();
    error.textContent = "";
    rows.forEach((row) => {
      const label = document.createElement("label");
      label.className = "export-row";
      const name = document.createElement("span");
      name.className = "export-name";
      name.textContent = row.name;
      name.title = row.name;
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${row.name} 내보내기 형식`);
      for (const [value, text] of [
        ["conf", ".conf"],
        ["qr", "QR코드"],
        ["exclude", "제외"],
      ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.value = row.format;
      select.onchange = () => {
        row.format = select.value as ExportFormat;
        error.textContent = "";
        updateSummary();
      };
      label.append(name, select);
      list.append(label);
    });
    updateSummary();
    list.scrollTop = scrollTop;
  }
  window.addEventListener("panelactivate", (event) => {
    if (
      (event as CustomEvent<{ view?: string }>).detail?.view ===
        "export-dialog" &&
      !busy
    )
      refreshRows();
  });
  return {
    open() {
      if (busy) return;
      if (!panel.has("export-dialog")) rows = [];
      refreshRows();
      panel.show("export-dialog");
    },
    async saveAll() {
      if (busy) return;
      setBusy(true);
      try {
        await download(
          getDocuments().map((doc) => ({ ...doc, format: "conf" })),
        );
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
  };
}
