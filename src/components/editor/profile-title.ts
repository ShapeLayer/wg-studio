export interface ProfileRenameDetail {
  id: number;
  name: string;
}
export class ProfileTitleElement extends HTMLElement {
  private owner?: number;
  private editing = false;
  private lifecycle?: AbortController;
  private get input() {
    return this.querySelector<HTMLInputElement>("input")!;
  }
  update(id: number, name: string) {
    if (this.owner === id && this.editing) return;
    this.owner = id;
    this.editing = false;
    this.input.readOnly = true;
    this.input.value = name;
  }
  connectedCallback() {
    this.lifecycle?.abort();
    this.lifecycle = new AbortController();
    const signal = this.lifecycle.signal;
    this.input.addEventListener(
      "click",
      () => {
        if (this.editing) return;
        this.editing = true;
        this.input.readOnly = false;
        this.input.focus();
        this.input.select();
      },
      { signal },
    );
    this.input.addEventListener("blur", () => this.finish(true), { signal });
    this.input.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.finish(event.key === "Enter");
        this.input.blur();
      },
      { signal },
    );
  }
  private finish(commit: boolean) {
    if (!this.editing || this.owner === undefined) return;
    this.editing = false;
    this.input.readOnly = true;
    this.dispatchEvent(
      new CustomEvent<ProfileRenameDetail>("profile-rename", {
        bubbles: true,
        detail: { id: this.owner, name: commit ? this.input.value.trim() : "" },
      }),
    );
  }
  disconnectedCallback() {
    this.lifecycle?.abort();
    this.editing = false;
  }
}
