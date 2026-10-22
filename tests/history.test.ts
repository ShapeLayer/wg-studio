import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberDocument, travelHistory } from "../src/core/history.ts";
import { newConfig } from "../src/core/wireguard.ts";
import type { ConfigDocument } from "../src/core/types.ts";
function document(): ConfigDocument {
  return {
    id: 1,
    internalId: "a".repeat(64),
    name: "wg.conf",
    model: newConfig(),
    selected: 0,
    text: "A",
    saved: "A",
    history: [],
    future: [],
    handle: null,
    x: 0,
    y: 0,
  };
}
test("undo and redo preserve original text and section selection across multiple steps", () => {
  const d = document();
  rememberDocument(d);
  d.text = "B";
  d.selected = 1;
  rememberDocument(d);
  d.text = "[invalid source";
  d.selected = 2;
  assert.equal(travelHistory(d, "undo"), true);
  assert.equal(d.text, "B");
  assert.equal(d.selected, 1);
  travelHistory(d, "undo");
  assert.equal(d.text, "A");
  assert.equal(travelHistory(d, "undo"), false);
  travelHistory(d, "redo");
  assert.equal(d.text, "B");
  assert.equal(d.selected, 1);
  travelHistory(d, "redo");
  assert.equal(d.text, "[invalid source");
  assert.equal(d.selected, 2);
  assert.equal(travelHistory(d, "redo"), false);
});
test("a new edit clears redo only for the edited document and history is bounded", () => {
  const a = document(),
    b = document();
  rememberDocument(a);
  a.text = "B";
  travelHistory(a, "undo");
  assert.equal(a.future.length, 1);
  rememberDocument(b);
  b.text = "other";
  assert.equal(a.future.length, 1);
  rememberDocument(a);
  a.text = "new branch";
  assert.equal(travelHistory(a, "redo"), false);
  for (let i = 0; i < 100; i++) {
    rememberDocument(a);
    a.text = String(i);
  }
  assert.equal(a.history.length, 80);
});
