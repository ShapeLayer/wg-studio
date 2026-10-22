import {
  addressSuggestions,
  connectionContextValid,
} from "../../core/address-resolution.ts";
import { t } from "../../i18n/index.ts";
import { escapeHTML as esc } from "./html.ts";
import { defineElement } from "./element.ts";
import {
  addressConflicts,
  planAddressChange,
} from "../../core/address-conflicts.ts";
import type {
  AddressConflict,
  AddressChange,
  PeerConnectionContext,
} from "../../core/address-conflicts.ts";
import type { ConfigDocument, KeyConnection } from "../../core/types.ts";

export class AddressResolverElement extends HTMLElement {
  private lifecycle?: AbortController;
  disconnectedCallback() {
    this.lifecycle?.abort();
  }
  open(
    conflict: AddressConflict,
    getState: () => { documents: ConfigDocument[]; edges: KeyConnection[] },
    apply: (changes: AddressChange[]) => boolean,
    done: () => void,
    connection?: PeerConnectionContext,
  ) {
    this.className = "inline-confirm address-resolver";
    this.lifecycle?.abort();
    this.lifecycle = new AbortController();
    const previousFocus = document.activeElement;
    let settled = false;
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-label", t("addressConflictTitle"));
    const finish = () => {
      if (settled) return;
      settled = true;
      this.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
      done();
    };
    window.addEventListener("panelactivate", finish, {
      signal: this.lifecycle.signal,
    });
    const edit = (
      selected = connectionContextValid(
        getState().documents,
        getState().edges,
        connection,
      ) &&
      connection &&
      [conflict.first, conflict.second].includes(connection.target)
        ? connection.target
        : conflict.second,
      draft?: string,
    ) => {
      const { documents } = getState();
      const profiles = documents.filter(
        (d) => d.id === conflict.first || d.id === conflict.second,
      );
      if (profiles.length !== 2) return finish();
      this.innerHTML = `<div class="resolver-heading"><strong>${esc(t("addressConflictTitle"))}</strong><button class="icon stop" aria-label="${esc(t("addressStop"))}">×</button></div><p>${esc(t("connectedAddressConflict", { first: profiles[0].name, second: profiles[1].name, address: conflict.address }))}</p><label>${esc(t("addressProfile"))}<select>${profiles.map((d) => `<option value="${d.id}" ${d.id === selected ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label><label>${esc(t("addressSuggestions"))}<select class="resolver-suggestions" aria-label="${esc(t("addressSuggestions"))}"></select></label><p class="resolver-advice"></p><label>${esc(t("replacementAddress"))}<input spellcheck="false"></label><p class="resolver-error" role="alert"></p><div class="dialog-actions"><button class="secondary stop">${esc(t("addressStop"))}</button><button class="primary review">${esc(t("reviewAddressChange"))}</button></div>`;
      const select = this.querySelector("select")!,
        input = this.querySelector("input")!;
      const suggest = () => {
        const state = getState();
        const result = addressSuggestions(
          state.documents,
          state.edges,
          Number(select.value),
          conflict.address,
          connection,
        );
        const choices = this.querySelector<HTMLSelectElement>(
          ".resolver-suggestions",
        )!;
        choices.innerHTML =
          `<option value="">${esc(t("addressManualChoice"))}</option>` +
          result.options
            .map((option) => {
              const names = option.sources
                .map(
                  (id) => state.documents.find((d) => d.id === id)?.name || "",
                )
                .join(", ");
              const key =
                option.kind === "reserved"
                  ? "addressCandidateReserved"
                  : option.kind === "range"
                    ? "addressCandidateRange"
                    : "addressCandidateFree";
              return `<option value="${esc(option.address)}">${esc(t(key, { address: option.address, names }))}</option>`;
            })
            .join("");
        input.value = result.initial;
        choices.value = result.initial;
        const ambiguousKey = !result.options.length && result.ambiguous;
        this.querySelector(".resolver-advice")!.textContent = t(
          ambiguousKey
            ? "ambiguousAddressKey"
            : !result.options.length
              ? "addressNoSuggestion"
              : result.ambiguous || !result.initial
                ? "addressChoiceExplanation"
                : "addressSuggestionExplanation",
        );
        choices.onchange = () => {
          input.value = choices.value;
          input.focus({ preventScroll: true });
        };
        input.oninput = () => {
          choices.value = result.options.some((o) => o.address === input.value)
            ? input.value
            : "";
        };
      };
      suggest();
      if (draft !== undefined) {
        input.value = draft;
        this.querySelector<HTMLSelectElement>(".resolver-suggestions")!.value =
          draft;
      }
      select.onchange = suggest;
      this.querySelectorAll<HTMLButtonElement>(".stop").forEach(
        (b) => (b.onclick = finish),
      );
      this.querySelector<HTMLButtonElement>(".review")!.onclick = () => {
        try {
          const state = getState();
          if (
            !addressConflicts(state.documents, state.edges).some(
              (c) => c.id === conflict.id && c.connected,
            )
          )
            throw new Error(t("addressPlanExpired"));
          const owner = Number(select.value),
            replacement = input.value.trim();
          const changes = planAddressChange(
            state.documents,
            state.edges,
            owner,
            conflict.address,
            replacement,
          );
          const snapshot = state.documents.map((d) => ({
            id: d.id,
            text: d.text,
          }));
          this.innerHTML = `<div class="resolver-heading"><strong>${esc(t("reviewAddressChange"))}</strong></div><p>${esc(t("addressChangeReview"))}</p><div class="resolver-preview">${changes
            .map(
              (c) =>
                `<section><strong>${esc(state.documents.find((d) => d.id === c.id)!.name)}</strong><pre>${esc(
                  c.before
                    .split("\n")
                    .filter((line) =>
                      /^(Address|AllowedIPs)\s*=/.test(line.trim()),
                    )
                    .join("\n"),
                )}</pre><span>↓</span><pre>${esc(
                  c.after
                    .split("\n")
                    .filter((line) =>
                      /^(Address|AllowedIPs)\s*=/.test(line.trim()),
                    )
                    .join("\n"),
                )}</pre></section>`,
            )
            .join(
              "",
            )}</div><p class="resolver-error" role="alert"></p><div class="dialog-actions"><button class="secondary stop">${esc(t("addressStop"))}</button><button class="secondary undo">${esc(t("addressUndo"))}</button><button class="primary accept">${esc(t("addressContinue"))}</button></div>`;
          this.scrollIntoView({ block: "nearest", inline: "nearest" });
          this.querySelector<HTMLButtonElement>(".stop")!.onclick = finish;
          this.querySelector<HTMLButtonElement>(".undo")!.onclick = () =>
            edit(owner, replacement);
          this.querySelector<HTMLButtonElement>(".accept")!.onclick = () => {
            const now = getState().documents;
            if (
              snapshot.length !== now.length ||
              snapshot.some(
                (s) => now.find((d) => d.id === s.id)?.text !== s.text,
              ) ||
              !apply(changes)
            ) {
              this.querySelector(".resolver-error")!.textContent =
                t("addressPlanExpired");
              return;
            }
            finish();
          };
        } catch (error) {
          this.querySelector(".resolver-error")!.textContent = (
            error as Error
          ).message;
        }
      };
      this.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    this.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          finish();
        }
      },
      { signal: this.lifecycle.signal },
    );
    edit();
    this.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.querySelector("select")?.focus({ preventScroll: true });
  }
}
defineElement("wg-address-resolver", AddressResolverElement);
