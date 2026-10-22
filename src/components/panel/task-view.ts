import { TemplateElement } from "../shared/element.ts";
import batch from "./tasks/batch-dialog.html?raw";
import connect from "./tasks/connect-dialog.html?raw";
import plaintext from "./tasks/import-dialog.html?raw";
import name from "./tasks/name-dialog.html?raw";
import confirm from "./tasks/confirm-dialog.html?raw";

const templates: Readonly<Record<string, string>> = {
  batch,
  connect,
  import: plaintext,
  name,
  confirm,
};

export class TaskViewElement extends TemplateElement {
  protected get template() {
    return templates[this.getAttribute("kind") || ""] || "";
  }
}
