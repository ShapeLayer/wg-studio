import { PanelTabs } from "./panel-tabs.ts";
import type { PanelTab } from "./panel-tabs.ts";
function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing panel element: ${id}`);
  return el as T;
}
class SidePanel {
  private root = required("right-panel");
  private state = new PanelTabs();
  private width = 480;
  private concealed = false;
  private pending = new Map<string, (value: string) => void>();
  constructor() {
    const handle = required("panel-resize");
    let drag: { pointer: number; start: number; width: number } | null = null;
    const resize = (width: number) => {
      this.width = Math.min(
        Math.max(300, width),
        Math.max(300, window.innerWidth - 280),
      );
      document.documentElement.style.setProperty(
        "--panel-width",
        `${Math.min(this.width, window.innerWidth)}px`,
      );
      handle.setAttribute("aria-valuenow", String(Math.round(this.width)));
      handle.setAttribute(
        "aria-valuemax",
        String(Math.max(300, window.innerWidth - 280)),
      );
    };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      drag = { pointer: e.pointerId, start: e.clientX, width: this.width };
      document.body.classList.add("resizing-panel");
    });
    handle.addEventListener("pointermove", (e) => {
      if (drag?.pointer === e.pointerId)
        resize(drag.width + drag.start - e.clientX);
    });
    const finish = () => {
      drag = null;
      document.body.classList.remove("resizing-panel");
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        resize(this.width + (e.key === "ArrowLeft" ? 32 : -32));
      }
    });
    window.addEventListener("resize", () => resize(this.width));
    resize(this.width);
    required("panel-close").onclick = () => {
      if (this.pending.size) this.close();
      else {
        this.concealed = true;
        this.refresh();
      }
    };
    this.initializeTabs();
    this.root.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const button = (e as SubmitEvent).submitter as HTMLButtonElement | null;
        this.close(
          form.closest<HTMLElement>("[data-panel-view]")!.id,
          button?.value || "cancel",
        );
      });
    });
  }
  get active() {
    return this.state.active?.view;
  }
  get editorId() {
    return this.state.active?.documentId;
  }
  get visible() {
    return !!this.state.active && !this.concealed;
  }
  get taskOpen() {
    return this.visible && this.active !== "inspector";
  }
  has(key: string) {
    return this.state.tabs.some((tab) => tab.key === key);
  }
  toggle() {
    if (!this.state.active) {
      window.dispatchEvent(new Event("panelopeneditor"));
      return;
    }
    this.concealed = !this.concealed;
    this.refresh();
  }
  private saveScroll() {
    if (this.state.active)
      this.state.active.scrollTop = required("panel-content").scrollTop;
  }
  private renderTabs() {
    const bar = required("panel-tabs");
    bar.replaceChildren();
    for (const tab of this.state.tabs) {
      const wrapper = document.createElement("div");
      wrapper.className = "panel-tab";
      const button = document.createElement("button");
      button.type = "button";
      button.id = `panel-tab-${tab.key}`;
      button.dataset.panelTab = tab.key;
      button.setAttribute("role", "tab");
      button.setAttribute(
        "aria-selected",
        String(tab.key === this.state.activeKey),
      );
      button.setAttribute("aria-controls", tab.view);
      button.tabIndex = tab.key === this.state.activeKey ? 0 : -1;
      button.textContent = tab.title;
      button.title = tab.title;
      button.disabled =
        this.pending.size > 0 && tab.key !== this.state.activeKey;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.dataset.panelTabClose = tab.key;
      close.setAttribute("aria-label", `${tab.title} 탭 닫기`);
      close.disabled =
        this.pending.size > 0 && tab.key !== this.state.activeKey;
      wrapper.append(button, close);
      bar.append(wrapper);
    }
    const view = this.state.active && required(this.state.active.view);
    if (view) {
      view.setAttribute("role", "tabpanel");
      view.setAttribute("aria-labelledby", `panel-tab-${this.state.activeKey}`);
    }
  }
  private initializeTabs() {
    const bar = required("panel-tabs");
    bar.addEventListener("click", (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("button")
          : null;
      if (!target || target.disabled) return;
      if (target.dataset.panelTabClose)
        this.close(target.dataset.panelTabClose);
      else if (target.dataset.panelTab) this.activate(target.dataset.panelTab);
    });
    bar.addEventListener("keydown", (event) => {
      if (this.pending.size) return;
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const tabs = this.state.tabs,
        index = tabs.findIndex((tab) => tab.key === this.state.activeKey);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
              tabs.length;
      if (!tabs[next]) return;
      this.activate(tabs[next].key);
      required(`panel-tab-${tabs[next].key}`).focus();
    });
  }
  private refresh(activate = false) {
    this.root.hidden = !this.visible;
    document.body.classList.toggle("panel-open", this.visible);
    this.root
      .querySelectorAll<HTMLElement>("[data-panel-view]")
      .forEach((view) => (view.hidden = view.id !== this.active));
    const waiting = this.visible && this.pending.size > 0;
    required("canvas").inert = waiting;
    document.querySelector<HTMLElement>(".floating-chrome")!.inert = waiting;
    this.renderTabs();
    if (activate) {
      const tab = this.state.active;
      window.dispatchEvent(
        new CustomEvent<PanelTab | undefined>("panelactivate", { detail: tab }),
      );
      required("panel-content").scrollTop = tab?.scrollTop ?? 0;
    }
    window.dispatchEvent(new Event("panelresize"));
  }
  activate(key: string) {
    if (this.pending.size && key !== this.state.activeKey) return;
    this.saveScroll();
    this.state.activate(key);
    this.concealed = false;
    this.refresh(true);
  }
  openEditor(documentId: number, title: string) {
    this.open({
      key: `editor-${documentId}`,
      view: "inspector",
      title,
      documentId,
    });
  }
  private open(tab: PanelTab) {
    if (this.pending.size && tab.key !== this.state.activeKey) return;
    this.saveScroll();
    this.concealed = false;
    this.state.open(tab);
    this.refresh(true);
  }
  show(id: string, push = false) {
    if (id === "inspector") {
      window.dispatchEvent(new Event("panelopeneditor"));
      return;
    }
    const titles: Record<string, string> = {
      "batch-dialog": "여러 설정 만들기",
      "connect-dialog": "피어 연결",
      "import-dialog": "텍스트 가져오기",
      "name-dialog": "이름 변경",
      "confirm-dialog": "확인",
      "export-dialog": "내보내기",
      "key-inventory": "키 쌍",
    };
    this.open({
      key: id,
      view: id,
      title: titles[id] || id,
      ...(push ? { returnTo: this.state.activeKey } : {}),
    });
  }
  syncDocuments(documents: readonly { id: number; name: string }[]) {
    const before = this.state.activeKey;
    this.state.syncDocuments(documents);
    this.refresh(before !== this.state.activeKey);
  }
  close(id = this.state.activeKey, result = "cancel") {
    if (!id) return;
    const key =
      id === "inspector"
        ? this.state.tabs.find(
            (tab) =>
              tab.view === "inspector" && tab.key === this.state.activeKey,
          )?.key
        : id;
    if (!key || !this.has(key)) return;
    if (this.pending.size && !this.pending.has(key)) return;
    this.saveScroll();
    this.pending.get(key)?.(result);
    this.pending.delete(key);
    this.state.close(key);
    this.refresh(true);
  }
  ask(id: string): Promise<string> {
    this.show(id, true);
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.refresh();
    });
  }
}
export const panel = new SidePanel();
