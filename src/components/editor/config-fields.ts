import { t, th } from "../../i18n/index.ts";
import { keys, listKeys, splitList } from "../../core/wireguard.ts";
import type { ConfigField, ConfigSection } from "../../core/types.ts";
import { escapeHTML as esc } from "../shared/html.ts";

export class ConfigFieldsElement extends HTMLElement {
  update(section: ConfigSection, hints: Readonly<Record<string, string>>) {
    this.innerHTML = section.fields
      .map((f, i) => {
        if (!f.key) return "";
        const opts = [...new Set([...keys[section.type], f.key])];
        const secret = ["PrivateKey", "PresharedKey"].includes(f.key),
          isList = listKeys.includes(f.key);
        return `<div class="field" data-field="${i}"><div class="field-top"><span class="field-key"><select aria-label="${th("fieldName", { v1: i + 1 })}" data-key="${i}">${opts.map((k) => `<option ${k === f.key ? "selected" : ""}>${esc(k)}</option>`).join("")}<option value="__custom">${th("custom")}</option></select><svg class="select-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span><button class="remove-field" data-remove="${i}" aria-label="${th("removeField", { v5: String(f.key) })}">×</button></div><div class="field-value"><input aria-label="${th("value", { v6: String(f.key) })}" data-value="${i}" class="${secret ? "key-input" : ""}" type="${secret ? "password" : "text"}" value="${esc(f.value)}" placeholder="${f.key === "Endpoint" ? "vpn.example.com:51820" : f.key.includes("Key") ? t("base64EncodedKey") : t("enterAValue")}" spellcheck="false" autocomplete="off">${secret ? `<button class="reveal" data-reveal="${i}" aria-label="${th("toggleVisibilityOf", { v1: String(f.key) })}">◉</button>` : ""}</div><div class="field-help"><span>${esc(hints[f.key] || t("customConfigurationField"))}</span>${f.key === "PrivateKey" ? `<span class="key-field-actions"><button data-field-dummy="${i}">${th("connectWithDummyKey")}</button><button data-generate="${i}">${th("generateKey")}</button></span>` : f.key === "PresharedKey" ? `<button data-generate="${i}">${th("generateSharedKey")}</button>` : isList ? `<span>${th("commaSeparated")}</span>` : ""}</div>${isList ? `<div class="chips" data-list="${i}">${this.listHTML(f, i)}</div>` : ""}</div>`;
      })
      .join("");
  }
  private listHTML(field: ConfigField, index: number) {
    return (
      splitList(field.value)
        .map((item, j) => this.listItemHTML(field.key, index, j, item))
        .join("") +
      `<button class="list-add" data-item-add="${index}">${th("addItem")}</button>`
    );
  }
  private listItemHTML(
    key: string,
    index: number,
    item: number,
    value: string,
  ) {
    return `<div class="list-item"><span>↳</span><input data-item="${index}:${item}" aria-label="${th("item", { v2: String(key), v3: item + 1 })}" value="${esc(value)}" placeholder="${th("enterAnAddress")}" spellcheck="false"><button data-item-remove="${index}:${item}" aria-label="${th("removeItem", { v7: item + 1 })}">×</button></div>`;
  }
  updateList(field: ConfigField, index: number) {
    const list = this.querySelector(`[data-list="${index}"]`);
    if (list) list.innerHTML = this.listHTML(field, index);
  }
  appendListItem(field: ConfigField, index: number) {
    const list = this.querySelector(`[data-list="${index}"]`);
    if (!list) return;
    const row = document.createElement("div");
    row.innerHTML = this.listItemHTML(
      field.key,
      index,
      list.querySelectorAll(".list-item").length,
      "",
    );
    const item = row.firstElementChild!;
    list.insertBefore(item, list.lastElementChild);
    item.querySelector("input")!.focus();
  }
}
