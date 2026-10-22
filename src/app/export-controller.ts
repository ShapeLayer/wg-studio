import { panel } from "./panel.ts";
import type { ExportDocument } from "../core/export.ts";
import type { ExportViewElement } from "../components/export/export-view.ts";

export function createExportController(
  getDocuments: () => readonly ExportDocument[],
  notify: (message: string) => void,
) {
  const view = document.querySelector<ExportViewElement>("wg-export-view")!;
  view.configure(getDocuments, notify, panel);
  return { open: () => view.open(), saveAll: () => view.saveAll() };
}
