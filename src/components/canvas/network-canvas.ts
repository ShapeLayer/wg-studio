import { t, th } from "../../i18n/index.ts";
import { TemplateElement } from "../shared/element.ts";
import template from "./network-canvas.html?raw";
import { dotGrid, edgeCurve, hasReverseConnection } from "../../core/canvas.ts";
import { parse } from "../../core/wireguard.ts";
import { escapeHTML as esc } from "../shared/html.ts";
import type {
  Camera,
  ConfigDocument,
  KeyConnection,
} from "../../core/types.ts";
import type { ConfigCardElement } from "./config-card.ts";
export class NetworkCanvasElement extends TemplateElement {
  protected template = template;
  private element(id: string) {
    return this.querySelector<HTMLElement>("#" + id)!;
  }
  setCamera(camera: Camera) {
    const grid = dotGrid(camera);
    // Layout zoom repaints text and SVG at the actual display resolution instead
    // of magnifying a cached composited layer with transform: scale().
    this.element("canvas-world").style.left = `${camera.x}px`;
    this.element("canvas-world").style.top = `${camera.y}px`;
    this.element("canvas-content").style.zoom = String(camera.scale);
    this.element("canvas").style.backgroundSize =
      `${grid.spacing}px ${grid.spacing}px`;
    this.element("canvas").style.backgroundPosition = `${grid.x}px ${grid.y}px`;
    this.element("zoom-reset").textContent =
      `${Math.round(camera.scale * 100)}%`;
    for (const badge of this.element(
      "connections",
    ).querySelectorAll<SVGElement>(".edge-warning")) {
      badge.setAttribute(
        "transform",
        `translate(${badge.dataset.midX} ${badge.dataset.midY}) scale(${1 / camera.scale})`,
      );
    }
  }
  updateCards(documents: ConfigDocument[], active: number) {
    const container = this.element("canvas-cards");
    for (const el of container.querySelectorAll<HTMLElement>("[data-document]"))
      if (!documents.some((d) => d.id === Number(el.dataset.document)))
        el.remove();
    for (const d of documents) {
      try {
        parse(d.text);
        d.error = "";
      } catch (error) {
        d.error = error instanceof Error ? error.message : String(error);
      }
    }
    for (const d of documents) {
      let card = container.querySelector<ConfigCardElement>(
        `[data-document="${d.id}"]`,
      );
      if (!card) {
        card = document.createElement("wg-config-card") as ConfigCardElement;
        container.append(card);
      }
      card.update(d, active, documents);
    }
  }
  updateConnections(
    documents: readonly ConfigDocument[],
    edges: readonly KeyConnection[],
    active: number,
    camera: Camera,
  ) {
    const byId = new Map(documents.map((d) => [d.id, d]));
    this.element("connections").innerHTML =
      `<defs><marker id="key-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="currentColor" stroke-width="1.5"/></marker></defs>` +
      edges
        .map((edge) => {
          const from = byId.get(edge.source)!,
            to = byId.get(edge.target)!,
            line = edgeCurve(from, to, Math.min(edge.peer - 1, 6) * 12);
          const warning = !hasReverseConnection(edge, edges)
            ? t("warningIsConfiguredToCommunicateWithButTheReverse", {
                v0: from.name,
                v1: to.name,
              })
            : "";
          const badge = warning
            ? `<g class="edge-warning" data-tooltip="${esc(warning)}" data-mid-x="${line.midX}" data-mid-y="${line.midY}" transform="translate(${line.midX} ${line.midY}) scale(${1 / camera.scale})"><circle r="11"/><text text-anchor="middle" dominant-baseline="central" aria-hidden="true">!</text></g>`
            : "";
          return `<g data-tooltip="${th("peerInterfaceMatchingPublicKey", { v0: String(from.name), v1: edge.peer, v2: String(to.name), v3: warning ? `. ${String(warning)}` : "" })}" class="key-edge ${edge.source === active || edge.target === active ? "highlighted" : ""}" data-edge-source="${edge.source}" data-edge-section="${edge.section}" data-edge-target="${edge.target}" role="button" tabindex="0" aria-label="${th("peerConnectsToInterface", { v8: String(from.name), v9: edge.peer, v10: String(to.name), v11: warning ? `. ${String(warning)}` : "" })}"><path class="edge-hit" d="${line.path}"/><path class="edge-line" d="${line.path}" marker-end="url(#key-arrow)"/><circle cx="${line.x1}" cy="${line.y1}" r="5"/><circle cx="${line.x2}" cy="${line.y2}" r="5"/>${badge}</g>`;
        })
        .join("");
    const summary = this.querySelector("#canvas-summary");
    if (summary)
      summary.textContent = t("configurationsKeyConnections", {
        v0: documents.length,
        v1: edges.length,
      });
  }
  redrawConnections(
    documents: readonly ConfigDocument[],
    edges: readonly KeyConnection[],
    camera: Camera,
  ) {
    const byId = new Map(documents.map((d) => [d.id, d]));
    for (const el of this.element("connections").querySelectorAll<SVGElement>(
      "[data-edge-source]",
    )) {
      const edge = edges.find(
        (e) =>
          e.source === Number(el.dataset.edgeSource) &&
          e.section === Number(el.dataset.edgeSection) &&
          e.target === Number(el.dataset.edgeTarget),
      );
      if (!edge) continue;
      const line = edgeCurve(
        byId.get(edge.source)!,
        byId.get(edge.target)!,
        Math.min(edge.peer - 1, 6) * 12,
      );
      el.querySelectorAll("path").forEach((p) =>
        p.setAttribute("d", line.path),
      );
      const circles = el.querySelectorAll("circle");
      circles[0].setAttribute("cx", String(line.x1));
      circles[0].setAttribute("cy", String(line.y1));
      circles[1].setAttribute("cx", String(line.x2));
      circles[1].setAttribute("cy", String(line.y2));
      const badge = el.querySelector<SVGElement>(".edge-warning");
      if (badge) {
        badge.dataset.midX = String(line.midX);
        badge.dataset.midY = String(line.midY);
        badge.setAttribute(
          "transform",
          `translate(${line.midX} ${line.midY}) scale(${1 / camera.scale})`,
        );
      }
    }
  }
}
