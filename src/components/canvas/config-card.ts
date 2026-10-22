import { workspaceAddressMessages } from "../../core/address-conflicts.ts";
import { t, th } from "../../i18n/index.ts";
import type { ProfileRenameDetail } from "../editor/profile-title.ts";
import type { ConfigDocument } from "../../core/types.ts";
import { validate } from "../../core/wireguard.ts";
import { escapeHTML as esc } from "../shared/html.ts";
export class ConfigCardElement extends HTMLElement {
  private initialized = false;
  private editingName = false;
  private currentName = "";
  private lifecycle?: AbortController;
  connectedCallback() {
    this.lifecycle?.abort();
    this.lifecycle = new AbortController();
    const signal = this.lifecycle.signal;
    this.addEventListener(
      "click",
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(".card-name > strong")
        )
          this.beginRename();
      },
      { signal },
    );
    this.addEventListener(
      "keydown",
      (event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest(".card-name > strong")
        )
          return;
        if (this.editingName) {
          if (
            event.isComposing ||
            (event.key !== "Enter" && event.key !== "Escape")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          this.finishRename(event.key === "Enter");
          this.querySelector<HTMLElement>(".card-name > strong")!.focus();
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          this.beginRename();
        }
      },
      { signal },
    );
  }
  disconnectedCallback() {
    this.lifecycle?.abort();
    this.editingName = false;
    const title = this.querySelector<HTMLElement>(".card-name > strong");
    if (title) title.textContent = this.currentName;
  }
  private beginRename() {
    if (this.editingName) return;
    const title = this.querySelector<HTMLElement>(".card-name > strong");
    if (!title) return;
    this.editingName = true;
    title.setAttribute("role", "group");
    title.tabIndex = -1;
    const input = document.createElement("input");
    input.className = "card-name-input";
    input.value = this.currentName;
    input.setAttribute("aria-label", t("renameProfile"));
    input.spellcheck = false;
    input.autocomplete = "off";
    title.replaceChildren(input);
    input.addEventListener("blur", () => this.finishRename(true), {
      once: true,
    });
    input.focus({ preventScroll: true });
    input.select();
  }
  private finishRename(commit: boolean) {
    if (!this.editingName) return;
    const title = this.querySelector<HTMLElement>(".card-name > strong")!;
    const name = title.querySelector("input")!.value.trim();
    this.editingName = false;
    title.textContent = this.currentName;
    title.setAttribute("role", "button");
    title.tabIndex = 0;
    this.dispatchEvent(
      new CustomEvent<ProfileRenameDetail>("profile-rename", {
        bubbles: true,
        detail: { id: Number(this.dataset.document), name: commit ? name : "" },
      }),
    );
  }
  update(
    d: ConfigDocument,
    active: number,
    documents: readonly ConfigDocument[],
  ) {
    if (!this.initialized) {
      this.classList.add("config-card");
      this.setAttribute("role", "article");
      this.dataset.document = String(d.id);
      const id = d.id;
      this.innerHTML = `<div class="card-heading" data-drag="${id}"><span class="card-grip">⠿</span><div class="card-name"><strong role="button" tabindex="0"></strong><small></small></div><button class="text-button" data-edit="${id}" aria-label="${th("editConfiguration")}">${th("edit")}</button></div><div class="card-identity"></div><div class="card-peers"></div><div class="card-code-label"><span>${th("configSource")}</span></div><textarea class="canvas-source" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea><div class="card-footer"></div>`;
      this.initialized = true;
    }
    const edit = this.querySelector<HTMLButtonElement>("[data-edit]")!;
    edit.textContent = t("edit");
    edit.setAttribute("aria-label", t("editConfiguration"));
    this.querySelector(".card-code-label span")!.textContent =
      t("configSource");
    this.classList.toggle("selected", d.id === active);
    this.classList.toggle("has-error", !!d.error);
    this.style.left = `${d.x}px`;
    this.style.top = `${d.y}px`;
    this.setAttribute("aria-label", t("configurationCard", { v0: d.name }));
    this.currentName = d.name;
    const title = this.querySelector<HTMLElement>(".card-name > strong")!;
    if (!this.editingName) title.textContent = d.name;
    title.setAttribute("aria-label", `${t("renameProfile")}: ${d.name}`);
    title.dataset.tooltip = t("clickToRename");
    this.querySelector(".card-name small")!.textContent = t("peers", {
      v1: d.text !== d.saved ? t("unsaved") : t("saved"),
      v2: d.model.sections.filter((s) => s.type === "Peer").length,
    });
    const address =
      d.model.sections
        .find((s) => s.type === "Interface")
        ?.fields.find((f) => f.key === "Address")?.value || t("noAddressSet");
    this.querySelector(".card-identity")!.innerHTML =
      `<span class="identity-icon">⌘</span><div><strong>Interface</strong><small>${esc(address)}</small></div><span class="identity-port"></span>`;
    const peers = d.model.sections.filter((s) => s.type === "Peer");
    this.querySelector(".card-peers")!.innerHTML = peers.length
      ? peers
          .map(
            (p, i) =>
              `<span class="peer-chip" data-tooltip="${esc(p.fields.find((f) => f.key === "PublicKey")?.value || t("noPublicKeyEntered"))}">⇄ Peer ${i + 1}</span>`,
          )
          .join("")
      : `<span class="empty-peers">${th("noPeersYet")}</span>`;
    const input = this.querySelector<HTMLTextAreaElement>(".canvas-source")!;
    input.setAttribute("aria-label", t("configurationSource", { v0: d.name }));
    if (input.value !== d.text) input.value = d.text;
    const issues = d.error
      ? [d.error]
      : [...validate(d.model), ...workspaceAddressMessages(d, documents)];
    this.querySelector(".card-footer")!.innerHTML =
      `<span class="${issues.length ? "needs-check" : "valid"}"${issues.length ? ` tabindex="0" data-tooltip="${esc(issues.map((issue) => `• ${issue}`).join("\n"))}" aria-label="${esc(t("itemsToReview", { v0: issues.length, v1: issues.join("; ") }))}"` : ""}>${issues.length ? t("itemsToReview2", { v0: issues.length }) : t("configurationFormatChecked")}</span><button class="text-button" data-card-save="${d.id}">${th("save")}</button>`;
  }
}
