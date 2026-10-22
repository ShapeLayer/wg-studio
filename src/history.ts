import type { ConfigDocument } from "./types.ts";
export function rememberDocument(doc: ConfigDocument) {
  doc.history.push({ text: doc.text, selected: doc.selected });
  if (doc.history.length > 80) doc.history.shift();
  doc.future.length = 0;
}
export function travelHistory(
  doc: ConfigDocument,
  direction: "undo" | "redo",
): boolean {
  const from = direction === "undo" ? doc.history : doc.future;
  const to = direction === "undo" ? doc.future : doc.history;
  const state = from.pop();
  if (!state) return false;
  to.push({ text: doc.text, selected: doc.selected });
  doc.text = state.text;
  doc.selected = state.selected;
  return true;
}
