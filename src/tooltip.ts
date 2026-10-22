// Keep tooltips outside the zoomed canvas and clipped panel containers.
const tooltip = document.createElement("div");
tooltip.id = "app-tooltip";
tooltip.className = "app-tooltip";
tooltip.role = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);
let anchor: Element | null = null;
let frame = 0;
function hide() {
  cancelAnimationFrame(frame);
  if (anchor) {
    const ids = (anchor.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== tooltip.id);
    if (ids.length) anchor.setAttribute("aria-describedby", ids.join(" "));
    else anchor.removeAttribute("aria-describedby");
  }
  anchor = null;
  tooltip.hidden = true;
}
function position() {
  if (!anchor?.isConnected) {
    hide();
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const width = tooltip.offsetWidth,
    height = tooltip.offsetHeight;
  tooltip.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
  const below = rect.bottom + 8;
  tooltip.style.top = `${Math.max(8, Math.min(innerHeight - height - 8, below + height <= innerHeight - 8 ? below : rect.top - height - 8))}px`;
  frame = requestAnimationFrame(position);
}
function show(target: EventTarget | null) {
  const next =
    target instanceof Element ? target.closest("[data-tooltip]") : null;
  if (next === anchor) return;
  hide();
  const text = next?.getAttribute("data-tooltip");
  if (!next || !text) return;
  anchor = next;
  tooltip.textContent = text;
  tooltip.hidden = false;
  anchor.setAttribute(
    "aria-describedby",
    [anchor.getAttribute("aria-describedby"), tooltip.id]
      .filter(Boolean)
      .join(" "),
  );
  position();
}
document.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "touch") show(event.target);
});
document.addEventListener("pointerout", (event) => {
  if (
    anchor &&
    !(
      event.relatedTarget instanceof Node &&
      anchor.contains(event.relatedTarget)
    )
  )
    hide();
});
document.addEventListener("focusin", (event) => show(event.target));
document.addEventListener("focusout", hide);
document.addEventListener("pointerdown", hide);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hide();
});
window.addEventListener("blur", hide);
