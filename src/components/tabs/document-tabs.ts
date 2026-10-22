import { t, th } from "../../i18n/index.ts";
import type { ConfigDocument } from "../../core/types.ts";
import { escapeHTML as esc } from "../shared/html.ts";
export class DocumentTabsElement extends HTMLElement {
  update(documents: readonly ConfigDocument[], active: number) {
    this.innerHTML = documents
      .map(
        (d) =>
          `<div class="file-tab ${d.id === active ? "active" : ""}"><button role="tab" aria-selected="${d.id === active}" data-tab="${d.id}"><span aria-hidden="true">▤</span> ${esc(d.name)}${d.text !== d.saved ? ` <span data-tooltip="${th("unsaved2")}">•</span>` : ""}</button><button class="close-tab" data-close="${d.id}" aria-label="${th("close", { v6: String(d.name) })}">×</button></div>`,
      )
      .join("");
  }
}
export class SectionNavElement extends HTMLElement {
  update(doc: ConfigDocument) {
    let peers = 0;
    this.innerHTML = doc.model.sections
      .map((s, i) => {
        const n = s.type === "Peer" ? ++peers : 0;
        return `<button class="section-nav-button ${i === doc.selected ? "active" : ""}" data-section="${i}" aria-current="${i === doc.selected ? "true" : "false"}"><span class="nav-symbol">${n ? "⇄" : "⌘"}</span><span>${n ? `Peer ${String(n).padStart(2, "0")}` : "Interface"}<small>${n ? t("remoteDevice") : t("thisDevice")}</small></span><span class="nav-arrow">›</span></button>`;
      })
      .join("");
  }
}
