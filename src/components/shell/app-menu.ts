import { t, getLocale, setLocale } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import { TemplateElement } from "../shared/element.ts";
import template from "./app-menu.html?raw";
const menus = ["file", "edit", "view"] as const;
export class AppMenuElement extends TemplateElement {
  protected template = template;
  private lifecycle?: AbortController;
  set panelVisible(value: boolean) {
    this.querySelector("#toggle-panel")!.textContent = value
      ? t("hideWorkPanel")
      : t("showWorkPanel");
  }
  closeMenus() {
    for (const name of menus) {
      this.querySelector<HTMLElement>(`#${name}-options`)!.hidden = true;
      this.querySelector(`#${name}-menu`)!.setAttribute(
        "aria-expanded",
        "false",
      );
    }
  }
  private updateLocaleOptions() {
    this.querySelectorAll<HTMLButtonElement>("[data-locale]").forEach(
      (button) => {
        button.setAttribute(
          "aria-checked",
          String(button.dataset.locale === getLocale()),
        );
      },
    );
  }
  connectedCallback() {
    super.connectedCallback();
    this.lifecycle?.abort();
    this.lifecycle = new AbortController();
    const signal = this.lifecycle.signal;
    this.updateLocaleOptions();
    this.addEventListener(
      "click",
      (event) => {
        const button =
          event.target instanceof Element
            ? event.target.closest<HTMLButtonElement>("[data-locale]")
            : null;
        if (!button) return;
        setLocale(button.dataset.locale as Locale);
        this.updateLocaleOptions();
        this.closeMenus();
        this.querySelector<HTMLButtonElement>("#view-menu")!.focus();
      },
      { signal },
    );
    window.addEventListener("localechange", () => this.updateLocaleOptions(), {
      signal,
    });
    for (const name of menus) {
      const button = this.querySelector<HTMLButtonElement>(`#${name}-menu`)!;
      button.addEventListener(
        "click",
        () => {
          const options = this.querySelector<HTMLElement>(`#${name}-options`)!;
          const opening = options.hidden;
          this.closeMenus();
          options.hidden = !opening;
          button.setAttribute("aria-expanded", String(opening));
        },
        { signal },
      );
      button.addEventListener(
        "pointerenter",
        (event) => {
          if (event.pointerType === "touch") return;
          if (
            menus.some(
              (menu) =>
                !this.querySelector<HTMLElement>(`#${menu}-options`)!.hidden,
            ) &&
            this.querySelector<HTMLElement>(`#${name}-options`)!.hidden
          )
            button.click();
        },
        { signal },
      );
    }
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest(".menu-wrap") || target.closest("[data-action]"))
          this.closeMenus();
      },
      { signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") this.closeMenus();
      },
      { signal },
    );
  }
  disconnectedCallback() {
    this.lifecycle?.abort();
  }
}
