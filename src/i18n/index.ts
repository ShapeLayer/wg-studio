import { en } from "./en.ts";
import type { MessageKey } from "./en.ts";
import { ko } from "./ko.ts";
import { detectLocale, localePreferenceKey } from "./locale.ts";
import type { Locale } from "./locale.ts";
export type { Locale, MessageKey };
let locale = detectLocale();
export function getLocale(): Locale {
  return locale;
}
export function t(
  key: MessageKey,
  values: Readonly<Record<string, unknown>> = {},
): string {
  const message = (locale === "ko" ? ko[key] : en[key]) || en[key];
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
/** Escape the completed message when interpolating it into HTML markup. */
export function th(
  key: MessageKey,
  values: Readonly<Record<string, unknown>> = {},
): string {
  return t(key, values).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
export function localize(root: ParentNode) {
  const attributes = [
    "aria-label",
    "data-tooltip",
    "placeholder",
    "title",
  ] as const;
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n as MessageKey);
  });
  for (const attribute of attributes) {
    root
      .querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)
      .forEach((element) => {
        element.setAttribute(
          attribute,
          t(element.getAttribute(`data-i18n-${attribute}`) as MessageKey),
        );
      });
  }
}
function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.title = t("appTitle");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", t("appDescription"));
}
export function setLocale(next: Locale, persist = true) {
  if (persist) {
    try {
      if (typeof window !== "undefined")
        window.localStorage.setItem(localePreferenceKey, next);
    } catch {
      /* Switching still works without storage. */
    }
  }
  if (locale === next) return;
  locale = next;
  updateDocument();
  if (typeof document !== "undefined") localize(document);
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent<Locale>("localechange", { detail: locale }),
    );
}
updateDocument();
