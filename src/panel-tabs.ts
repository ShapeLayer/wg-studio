export interface PanelTab {
  key: string;
  view: string;
  title: string;
  documentId?: number;
  returnTo?: string;
  scrollTop?: number;
}
export class PanelTabs {
  tabs: PanelTab[] = [];
  activeKey?: string;
  get active() {
    return this.tabs.find((tab) => tab.key === this.activeKey);
  }
  open(tab: PanelTab) {
    const existing = this.tabs.find((item) => item.key === tab.key);
    if (existing) Object.assign(existing, tab);
    else this.tabs.push(tab);
    this.activeKey = tab.key;
  }
  activate(key: string) {
    if (this.tabs.some((tab) => tab.key === key)) this.activeKey = key;
  }
  close(key: string) {
    const index = this.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    const [removed] = this.tabs.splice(index, 1);
    if (this.activeKey === key)
      this.activeKey =
        this.tabs.find((tab) => tab.key === removed.returnTo)?.key ??
        this.tabs[Math.max(0, index - 1)]?.key;
  }
  syncDocuments(documents: readonly { id: number; name: string }[]) {
    const names = new Map(documents.map((doc) => [doc.id, doc.name]));
    for (const tab of [...this.tabs])
      if (tab.documentId !== undefined) {
        const name = names.get(tab.documentId);
        if (name === undefined) this.close(tab.key);
        else tab.title = name;
      }
  }
}
