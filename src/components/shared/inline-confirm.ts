import { t } from "../../i18n/index.ts";
import { defineElement } from "./element.ts";
let cancelActive: (() => void) | undefined;
export function dismissInlineConfirm() {
  cancelActive?.();
}

export class InlineConfirmElement extends HTMLElement {
  private finish?: (result: boolean) => void;
  private lifecycle?: AbortController;
  private positionFrame = 0;
  ask(
    anchor: HTMLElement,
    title: string,
    message: string,
    acceptLabel: string,
    placement: "inline" | "below-tab" = "inline",
  ): Promise<boolean> {
    this.className = "inline-confirm";
    this.classList.toggle("tab-close-confirm", placement === "below-tab");
    this.setAttribute("role", "alertdialog");
    this.setAttribute("aria-label", title);
    this.lifecycle = new AbortController();
    const signal = this.lifecycle.signal;
    const heading = document.createElement("strong");
    heading.textContent = title;
    const description = document.createElement("p");
    description.textContent = message;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = t("cancel");
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "primary";
    accept.textContent = acceptLabel;
    actions.append(cancel, accept);
    this.replaceChildren(heading, description, actions);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        this.lifecycle?.abort();
        cancelAnimationFrame(this.positionFrame);
        cancelActive = undefined;
        this.finish = undefined;
        this.remove();
        if (anchor.isConnected) anchor.focus({ preventScroll: true });
        resolve(result);
      };
      this.finish = finish;
      const cancelled = () => finish(false);
      cancel.onclick = cancelled;
      accept.onclick = () => finish(true);
      document.addEventListener(
        "pointerdown",
        (event) => {
          if (
            event.target instanceof Node &&
            !this.contains(event.target) &&
            !anchor.contains(event.target)
          )
            finish(false);
        },
        { capture: true, signal },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopImmediatePropagation();
          finish(false);
        },
        { capture: true, signal },
      );
      window.addEventListener("panelactivate", cancelled, { signal });
      cancelActive = cancelled;
      if (placement === "below-tab") {
        const position = () => {
          if (!anchor.isConnected) {
            finish(false);
            return;
          }
          const rect = (
            anchor.closest(".file-tab") || anchor
          ).getBoundingClientRect();
          this.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - this.offsetWidth - 12))}px`;
          this.style.top = `${rect.bottom + 8}px`;
          this.positionFrame = requestAnimationFrame(position);
        };
        position();
      } else this.scrollIntoView({ block: "nearest", inline: "nearest" });
      cancel.focus({ preventScroll: true });
    });
  }
  disconnectedCallback() {
    this.finish?.(false);
    this.lifecycle?.abort();
    cancelAnimationFrame(this.positionFrame);
  }
}
defineElement("wg-inline-confirm", InlineConfirmElement);

export function confirmInline(
  anchor: HTMLElement,
  title: string,
  message: string,
  acceptLabel = t("continue"),
  placement: "inline" | "below-tab" = "inline",
): Promise<boolean> {
  dismissInlineConfirm();
  const host =
    placement === "below-tab"
      ? document.body
      : (anchor.closest<HTMLElement>(
          ".field,#peer-profile-link,#dummy-key-controls,.editor-panel",
        ) ?? anchor.parentElement);
  if (!host) return Promise.resolve(false);
  const popup = document.createElement(
    "wg-inline-confirm",
  ) as InlineConfirmElement;
  host.append(popup);
  return popup.ask(anchor, title, message, acceptLabel, placement);
}
