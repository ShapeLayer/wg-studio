import { localize } from "../../i18n/index.ts";
/** Light DOM keeps the shared theme, form labels and delegated events intact. */
export abstract class TemplateElement extends HTMLElement {
  protected abstract template: string;
  private mounted = false;
  protected mount() {
    if (this.mounted) return;
    this.innerHTML = this.template;
    this.mounted = true;
    localize(this);
  }
  connectedCallback() {
    this.mount();
  }
}
export function defineElement(
  name: string,
  constructor: CustomElementConstructor,
) {
  if (!customElements.get(name)) customElements.define(name, constructor);
}
