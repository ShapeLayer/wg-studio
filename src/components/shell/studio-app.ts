import { TemplateElement } from "../shared/element.ts";
import template from "./studio-app.html?raw";

export class StudioAppElement extends TemplateElement {
  protected template = template;
}
