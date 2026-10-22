import { test } from "node:test";
import assert from "node:assert/strict";
import { PanelTabs } from "../src/core/panel-tabs.ts";
test("multiple document editors and tasks keep distinct tabs without duplicates", () => {
  const tabs = new PanelTabs();
  tabs.open({
    key: "editor-1",
    view: "inspector",
    title: "a.conf",
    documentId: 1,
  });
  tabs.open({
    key: "editor-2",
    view: "inspector",
    title: "b.conf",
    documentId: 2,
  });
  tabs.open({ key: "export-dialog", view: "export-dialog", title: "내보내기" });
  tabs.activate("editor-1");
  assert.equal(tabs.active?.documentId, 1);
  tabs.active!.scrollTop = 120;
  tabs.open({ key: "export-dialog", view: "export-dialog", title: "내보내기" });
  assert.equal(tabs.tabs.length, 3);
  tabs.activate("editor-1");
  assert.equal(tabs.active?.scrollTop, 120);
});
test("closing a background tab preserves the active view, closing a prompt returns to its owner", () => {
  const tabs = new PanelTabs();
  tabs.open({
    key: "editor-1",
    view: "inspector",
    title: "a.conf",
    documentId: 1,
  });
  tabs.open({ key: "export-dialog", view: "export-dialog", title: "内보내기" });
  tabs.open({
    key: "name-dialog",
    view: "name-dialog",
    title: "이름 변경",
    returnTo: "editor-1",
  });
  tabs.close("export-dialog");
  assert.equal(tabs.activeKey, "name-dialog");
  tabs.close("name-dialog");
  assert.equal(tabs.activeKey, "editor-1");
  tabs.close("editor-1");
  assert.equal(tabs.active, undefined);
});
test("renaming and closing files synchronizes editor tabs without removing task tabs", () => {
  const tabs = new PanelTabs();
  tabs.open({
    key: "editor-1",
    view: "inspector",
    title: "old.conf",
    documentId: 1,
  });
  tabs.open({
    key: "editor-2",
    view: "inspector",
    title: "b.conf",
    documentId: 2,
  });
  tabs.open({ key: "export-dialog", view: "export-dialog", title: "내보내기" });
  tabs.syncDocuments([{ id: 1, name: "new.conf" }]);
  assert.deepEqual(
    tabs.tabs.map((tab) => tab.title),
    ["new.conf", "내보내기"],
  );
  assert.equal(tabs.activeKey, "export-dialog");
  tabs.activate("missing");
  assert.equal(tabs.activeKey, "export-dialog");
});
