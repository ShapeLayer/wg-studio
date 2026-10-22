let cancelActive: (() => void) | undefined;

export function dismissInlineConfirm() {
  cancelActive?.();
}

export function confirmInline(
  anchor: HTMLElement,
  title: string,
  message: string,
  acceptLabel = "계속",
): Promise<boolean> {
  dismissInlineConfirm();
  const host =
    anchor.closest<HTMLElement>(
      ".field,#peer-profile-link,#dummy-key-controls,.editor-panel",
    ) ?? anchor.parentElement;
  if (!host) return Promise.resolve(false);
  const popup = document.createElement("div");
  popup.className = "inline-confirm";
  popup.setAttribute("role", "alertdialog");
  popup.setAttribute("aria-label", title);
  const heading = document.createElement("strong");
  heading.textContent = title;
  const description = document.createElement("p");
  description.textContent = message;
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = "취소";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary";
  accept.textContent = acceptLabel;
  actions.append(cancel, accept);
  popup.append(heading, description, actions);
  host.append(popup);
  return new Promise((resolve) => {
    const finish = (result: boolean) => {
      popup.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("panelactivate", cancelled);
      cancelActive = undefined;
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
      resolve(result);
    };
    const cancelled = () => finish(false);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.contains(event.target) &&
        !anchor.contains(event.target)
      )
        finish(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(false);
      }
    };
    cancel.onclick = cancelled;
    accept.onclick = () => finish(true);
    cancelActive = cancelled;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("panelactivate", cancelled);
    popup.scrollIntoView({ block: "nearest", inline: "nearest" });
    cancel.focus({ preventScroll: true });
  });
}
