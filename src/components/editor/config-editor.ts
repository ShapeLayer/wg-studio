import { t, th } from "../../i18n/index.ts";
import { TemplateElement } from "../shared/element.ts";
import template from "./config-editor.html?raw";
import type { ConfigDocument } from "../../core/types.ts";
import type { ConfigFieldsElement } from "./config-fields.ts";
import { escapeHTML as esc } from "../shared/html.ts";
export class ConfigEditorElement extends TemplateElement {
  protected template = template;
  private element<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.querySelector<T>(selector)!;
  }
  updateSection(
    current: ConfigDocument,
    documents: readonly ConfigDocument[],
    hints: Readonly<Record<string, string>>,
  ) {
    const s = current.model.sections[current.selected];
    this.element("#peer-delete-confirm").hidden = true;
    this.element("#peer-profile-link").hidden = s.type !== "Peer";
    this.element("#delete-section").setAttribute(
      "aria-label",
      s.type === "Peer" ? t("deletePeer") : t("deleteInterface"),
    );
    const profileSelect = this.element<HTMLSelectElement>(
      "#peer-profile-select",
    );
    const previous = profileSelect.value;
    profileSelect.innerHTML =
      `<option value="">${th("selectAProfile")}</option>` +
      documents
        .filter((d) => d.id !== current.id)
        .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
        .join("") +
      `<option value="__new">${th("createNewConfiguration")}</option>`;
    if ([...profileSelect.options].some((option) => option.value === previous))
      profileSelect.value = previous;
    this.element<HTMLButtonElement>("#peer-profile-connect").disabled =
      !profileSelect.value;
    this.element<HTMLButtonElement>("#peer-profile-connect").textContent =
      profileSelect.value === "__new" ? t("createAndConnect") : t("connect");
    this.element("#peer-profile-status").textContent =
      documents.length > 1 ? t("applyTheRemoteProfileSPublicKeyToThis") : "";
    this.element("#section-title").textContent =
      s.type === "Interface"
        ? "Interface"
        : `Peer ${
            current.model.sections
              .slice(0, current.selected + 1)
              .filter((x) => x.type === "Peer").length
          }`;
    this.element("#section-description").textContent =
      s.type === "Interface"
        ? t("configureThisDeviceSNetworkInterface")
        : t("configureTheRemoteDeviceAndRouting");
    this.element("#section-icon").textContent =
      s.type === "Interface" ? "⌘" : "⇄";
    this.element("#section-tag").textContent = `[${s.type}]`;
    this.querySelector<ConfigFieldsElement>("#fields")!.update(s, hints);
  }
  updateSource(text: string, error: string) {
    const source = this.element<HTMLTextAreaElement>("#source");
    if (source.value !== text) source.value = text;
    this.element("#line-numbers").textContent = text
      .split("\n")
      .map((_, i) => String(i + 1).padStart(2, "0"))
      .join("\n");
    this.element("#parse-error").hidden = !error;
    this.element("#parse-error").textContent = error;
    this.element("#fields").inert = !!error;
  }
  updateValidation(issues: readonly string[], expanded: boolean) {
    this.element("#validation-title").textContent = issues.length
      ? t("reviewItems", { v0: issues.length })
      : t("configurationFormatIsValid");
    this.element("#validation-symbol").textContent = issues.length ? "◌" : "✓";
    this.element("#issues").innerHTML = issues
      .map(
        (issue) =>
          `<li data-severity="${issue.startsWith("Info:") ? "info" : "warning"}">${esc(issue)}</li>`,
      )
      .join("");
    if (issues.some((issue) => issue.startsWith("Warning:")))
      this.element("#issues").insertAdjacentHTML(
        "beforeend",
        `<li><button data-address-resolve>${th("addressResolveOpen")}</button></li>`,
      );
    this.element("#issues").hidden = !expanded;
    this.element("#validation-toggle").textContent = expanded
      ? t("collapse")
      : t("details");
  }
  showDerived(publicKey: string, copy: () => void) {
    const derived = this.element("#derived");
    derived.innerHTML = `<strong>${th("publicKeyForThisInterface")}</strong><input aria-label="${th("derivedInterfacePublicKey")}" readonly value="${esc(publicKey)}"><div class="field-help"><span>${th("derivedFromPrivatekeyNotWrittenToTheConfigFile")}</span><button id="copy-public">${th("copy")}</button></div>`;
    derived.hidden = false;
    this.element("#copy-public").onclick = copy;
  }
}
