import { t, th } from "../../i18n/index.ts";
import { TemplateElement } from "../shared/element.ts";
import template from "./key-library.html?raw";
import { escapeHTML as esc } from "../shared/html.ts";
import type { ConfigDocument } from "../../core/types.ts";
export interface KeyEntry {
  publicKey: string;
  privateKeys: Set<string>;
  privateUses: string[];
  publicUses: string[];
  invalid?: boolean;
}
export class KeyLibraryElement extends TemplateElement {
  protected template = template;
  update(
    snapshot: readonly Pick<
      ConfigDocument,
      "id" | "name" | "internalId" | "model" | "error"
    >[],
    entries: ReadonlyMap<string, KeyEntry>,
  ) {
    this.querySelector<HTMLElement>("#" + "key-pair-count")!.textContent = t(
      "total",
      { v0: entries.size },
    );
    this.querySelector<HTMLElement>("#" + "dummy-key-controls")!.innerHTML =
      `<div class="keys-section-heading"><h3>${th("connectWithDummyKey")}</h3><span class="keys-tag">${th("forConnectionDisplay")}</span></div><p class="dummy-description">${th("showRelationshipsWithoutEnteringRealKeysReplaceDummyKeys")}</p><div class="dummy-key-list">${snapshot
        .map((d) => {
          const dummyKey = `dummy:${d.internalId.slice(0, 7)}`;
          const applied = d.model.sections.some(
            (s) =>
              s.type === "Interface" &&
              s.fields.some(
                (f) => f.key === "PrivateKey" && f.value === dummyKey,
              ),
          );
          return `<div class="dummy-key-row"><span class="dummy-file-icon" aria-hidden="true">▤</span><div class="dummy-profile"><strong>${esc(d.name)}</strong><code tabindex="0" data-tooltip="${esc(d.internalId)}">${esc(d.internalId.slice(0, 7) || t("preparing"))}</code></div><button class="dummy-apply ${applied ? "is-applied" : ""}" data-dummy-key="${d.id}" ${!d.internalId || d.error || applied ? "disabled" : ""}>${applied ? t("applied") : t("apply")}</button></div>`;
        })
        .join("")}</div>`;
    const uses = (locations: string[]) =>
      locations.length
        ? `<ul class="key-usage-list">${locations.map((location) => `<li><span aria-hidden="true">↳</span>${esc(location)}</li>`).join("")}</ul>`
        : `<p class="key-no-usage">${th("noOpenConfigurationUsesThisField")}</p>`;
    this.querySelector("#key-inventory-list")!.innerHTML =
      `<div class="keys-section-heading"><h3>${th("keysInUse")}</h3><span class="keys-section-meta">${th("groupedByPublicKey")}</span></div>` +
      ([...entries.values()]
        .map((item, index) => {
          const dummy = item.publicKey.startsWith("dummy:");
          const title = item.invalid
            ? t("keyNeedsReview")
            : dummy
              ? t("dummyKeyPair")
              : item.privateKeys.size
                ? t("keyPairs")
                : t("publicKeyOnly");
          const kind = item.invalid
            ? t("needsReview")
            : dummy
              ? t("dummy")
              : item.privateKeys.size
                ? "X25519"
                : t("remoteKey");
          return `<article class="key-pair ${dummy ? "is-dummy" : ""}"><div class="key-pair-heading"><span class="key-pair-symbol" aria-hidden="true">${dummy ? "⇄" : "⌘"}</span><h4>${title} <span class="key-pair-number">${String(index + 1).padStart(2, "0")}</span></h4><span class="keys-tag">${kind}</span></div><div class="key-detail"><label>${th("publicKey")} <span>${th("publicKey2")}</span><input readonly aria-label="${th("publicKey")}" value="${esc(item.invalid ? t("cannotDerive") : item.publicKey)}" spellcheck="false"></label><div class="key-usage-heading">${th("usedIn")} <span>${item.publicUses.length}</span></div>${uses(item.publicUses)}</div><div class="key-detail"><label>${th("privateKey")} <span>${th("privateKey2")}</span>${[...item.privateKeys].map((key) => `<input readonly aria-label="${th("privateKey")}" value="${esc(key)}" spellcheck="false">`).join("") || `<span class="key-missing">${th("noPrivateKeyInOpenConfigurations")}</span>`}</label><div class="key-usage-heading">${th("usedIn")} <span>${item.privateUses.length}</span></div>${uses(item.privateUses)}</div></article>`;
        })
        .join("") ||
        `<div class="keys-empty"><span aria-hidden="true">⌘</span><strong>${th("noKeysYet")}</strong><p>${th("generateAKeyOrApplyADummyKeyIn")}</p></div>`);
  }
}
