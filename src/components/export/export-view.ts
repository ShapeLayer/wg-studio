import { t } from "../../i18n/index.ts";
import { TemplateElement } from "../shared/element.ts";
import template from "./export-view.html?raw";
import { exportZip } from "../../core/export.ts";
import type {
  ExportDocument,
  ExportFormat,
  ExportSelection,
} from "../../core/export.ts";
import type { WorkPanelElement } from "../panel/work-panel.ts";
export interface ExportController {
  open(): void;
  saveAll(): Promise<void>;
}
export class ExportViewElement extends TemplateElement {
  protected template = template;
  private lifecycle?: AbortController;
  private controller?: ExportController;
  private rows: ExportSelection[] = [];
  private busy = false;
  private configuration?: {
    getDocuments: () => readonly ExportDocument[];
    notify: (message: string) => void;
    panel: WorkPanelElement;
  };
  connectedCallback() {
    super.connectedCallback();
    if (this.configuration && !this.lifecycle)
      this.configure(
        this.configuration.getDocuments,
        this.configuration.notify,
        this.configuration.panel,
      );
  }
  disconnectedCallback() {
    this.lifecycle?.abort();
    this.lifecycle = undefined;
  }
  open() {
    this.controller?.open();
  }
  async saveAll() {
    await this.controller?.saveAll();
  }
  configure(
    getDocuments: () => readonly ExportDocument[],
    notify: (message: string) => void,
    panel: WorkPanelElement,
  ) {
    this.configuration = { getDocuments, notify, panel };
    this.lifecycle?.abort();
    this.lifecycle = new AbortController();
    const element = <T extends HTMLElement>(id: string): T => {
      const el = this.querySelector("#" + id);
      if (!el) throw new Error(`Missing export element: ${id}`);
      return el as T;
    };
    const list = element<HTMLDivElement>("export-list");
    const error = element<HTMLParagraphElement>("export-error");
    const summary = element<HTMLSpanElement>("export-summary");
    const save = element<HTMLButtonElement>("export-save");
    const close = element<HTMLButtonElement>("export-close");
    let rows = this.rows,
      busy = this.busy;
    const view = this;

    function updateSummary() {
      const conf = rows.filter((row) => row.format === "conf").length;
      const qr = rows.filter((row) => row.format === "qr").length;
      summary.textContent = t("selectedConfQrCodes", {
        v0: conf + qr,
        v1: conf,
        v2: qr,
      });
      save.disabled = busy || conf + qr === 0;
    }
    function setBusy(value: boolean) {
      busy = value;
      view.busy = value;
      save.textContent = value ? t("preparingDownload") : t("save2");
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
      notify(t("configurationsDownloadedAsAZipFile"));
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
      view.rows = rows;
      list.replaceChildren();
      error.textContent = "";
      rows.forEach((row) => {
        const label = document.createElement("label");
        label.className = "export-row";
        const name = document.createElement("span");
        name.className = "export-name";
        name.textContent = row.name;
        name.dataset.tooltip = row.name;
        const select = document.createElement("select");
        select.setAttribute(
          "aria-label",
          t("exportFormatFor", { v0: row.name }),
        );
        for (const [value, text] of [
          ["conf", ".conf"],
          ["qr", t("qrCode")],
          ["exclude", t("exclude")],
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
    window.addEventListener(
      "panelactivate",
      (event) => {
        if (
          (event as CustomEvent<{ view?: string }>).detail?.view ===
            "export-dialog" &&
          !busy
        )
          refreshRows();
      },
      { signal: this.lifecycle!.signal },
    );
    window.addEventListener(
      "localechange",
      () => {
        if (!busy) refreshRows();
        else setBusy(true);
      },
      { signal: this.lifecycle!.signal },
    );
    this.controller = {
      open() {
        if (busy) return;
        if (!panel.has("export-dialog")) rows = view.rows = [];
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
}
