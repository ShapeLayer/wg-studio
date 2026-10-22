import { peerForInterface } from "../core/peers.ts";
import { t } from "../i18n/index.ts";
import type { ConfigEditorElement } from "../components/editor/config-editor.ts";
import type { NetworkCanvasElement } from "../components/canvas/network-canvas.ts";
import type { AppMenuElement } from "../components/shell/app-menu.ts";
import type {
  ProfileTitleElement,
  ProfileRenameDetail,
} from "../components/editor/profile-title.ts";
import { escapeHTML as esc } from "../components/shared/html.ts";
import type {
  DocumentTabsElement,
  SectionNavElement,
} from "../components/tabs/document-tabs.ts";
import type { ConfigFieldsElement } from "../components/editor/config-fields.ts";
import type {
  KeyLibraryElement,
  KeyEntry,
} from "../components/keys/key-library.ts";
import "../components/shared/tooltip.ts";
import {
  confirmInline,
  dismissInlineConfirm,
} from "../components/shared/inline-confirm.ts";
import { panel } from "./panel.ts";
import { rememberDocument, travelHistory } from "../core/history.ts";
import { createExportController } from "./export-controller.ts";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  zoomAt,
  fitCamera,
  keyConnections,
} from "../core/canvas.ts";
import {
  keys,
  listKeys,
  splitList,
  parse,
  serialize,
  newConfig,
  newPeer,
  generatePrivateKey,
  decodeKey,
  generatePresharedKey,
  publicFromPrivate,
  validate,
} from "../core/wireguard.ts";
import type {
  ConfigDocument,
  ConfigField,
  ConfigModel,
  Camera,
  CanvasGesture,
  Point,
  KeyConnection,
} from "../core/types.ts";

type DomElements = {
  "#theme": HTMLButtonElement;
  "#file-menu": HTMLButtonElement;
  "#file-options": HTMLElement;
  "#tabs": DocumentTabsElement;
  "#inspector": HTMLElement;
  "#inspector-name": HTMLInputElement;
  "#section-count": HTMLElement;
  "#section-nav": SectionNavElement;
  "#section-icon": HTMLElement;
  "#section-title": HTMLElement;
  "#section-description": HTMLElement;
  "#delete-section": HTMLButtonElement;
  "#section-tag": HTMLElement;
  "#fields": ConfigFieldsElement;
  "#derived": HTMLElement;
  "#copy": HTMLButtonElement;
  "#preview-name": HTMLElement;
  "#line-numbers": HTMLElement;
  "#source": HTMLTextAreaElement;
  "#parse-error": HTMLElement;
  "#validation-symbol": HTMLElement;
  "#validation-title": HTMLElement;
  "#validation-toggle": HTMLButtonElement;
  "#issues": HTMLElement;
  "#canvas": HTMLElement;
  "#canvas-world": HTMLElement;
  "#connections": SVGSVGElement;
  "#canvas-cards": HTMLElement;
  "#canvas-summary": HTMLElement;
  "#zoom-out": HTMLButtonElement;
  "#zoom-reset": HTMLButtonElement;
  "#zoom-in": HTMLButtonElement;
  "#fit-canvas": HTMLButtonElement;
  "#batch-dialog": HTMLElement;
  "#batch-prefix": HTMLInputElement;
  "#batch-count": HTMLInputElement;
  "#batch-keys": HTMLInputElement;
  "#batch-error": HTMLElement;
  "#batch-submit": HTMLButtonElement;
  "#connect-dialog": HTMLElement;
  "#connect-source": HTMLSelectElement;
  "#connect-target": HTMLSelectElement;
  "#connect-mutual": HTMLInputElement;
  "#connect-error": HTMLElement;
  "#connect-submit": HTMLButtonElement;
  "#file-input": HTMLInputElement;
  "#import-dialog": HTMLElement;
  "#import-name": HTMLInputElement;
  "#import-source": HTMLTextAreaElement;
  "#import-error": HTMLElement;
  "#import-submit": HTMLButtonElement;
  "#name-dialog": HTMLElement;
  "#filename": HTMLInputElement;
  "#confirm-dialog": HTMLElement;
  "#confirm-title": HTMLElement;
  "#confirm-message": HTMLElement;
  "#toast": HTMLElement;
};
function $<S extends keyof DomElements>(selector: S): DomElements[S];
function $<T extends Element = HTMLElement>(selector: string): T;
function $(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing application element: ${selector}`);
  return element;
}
function eventElement<
  T extends HTMLElement | SVGElement = HTMLElement | SVGElement,
>(event: Event): T {
  if (!(
    event.target instanceof HTMLElement || event.target instanceof SVGElement
  )) {
    throw new Error("Expected an element event target.");
  }
  return event.target as T;
}
function data(element: HTMLElement | SVGElement, key: string): string {
  const value = element.dataset[key];
  if (value === undefined) throw new Error(`Missing element data: ${key}`);
  return value;
}
function editableField(index: number): ConfigField {
  const field = section().fields[index];
  if (!field || field.key === undefined)
    throw new Error("Expected an editable field.");
  return field;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
let documents: ConfigDocument[] = [],
  active: number,
  sequence = 0,
  sourceError = "",
  showIssues = false,
  toastTimer: ReturnType<typeof setTimeout> | undefined,
  derivedVersion = 0;
let camera: Camera = { x: 65, y: 270, scale: 0.9 },
  spaceDown = false,
  gesture: CanvasGesture | null = null,
  connectionRevision = 0,
  canvasEdges: KeyConnection[] = [];
let inventoryRevision = 0;
const publicKeyCache = new Map<string, Promise<string>>();
const editor = () =>
  document.querySelector<ConfigEditorElement>("wg-config-editor")!;
const network = () =>
  document.querySelector<NetworkCanvasElement>("wg-network-canvas")!;
const doc = (): ConfigDocument => {
  const current = documents.find((d) => d.id === active);
  if (!current) throw new Error("No active configuration.");
  return current;
};
const section = () => doc().model.sections[doc().selected];
function fieldHints(): Record<string, string> {
  return {
    PrivateKey: t("privateKeyForThisInterface"),
    PublicKey: t("publicKeyOfTheRemotePeer"),
    PresharedKey: t("sharedKeyForAdditionalSecurity"),
    Address: t("ipCidrAssignedToThisInterface"),
    AllowedIPs: t("ipCidrRoutedThroughThisPeer"),
    ListenPort: t("udpListeningPort"),
    DNS: t("dnsServersOrSearchDomains"),
    Endpoint: t("hostPortIpv6UsesAddressPort"),
    PersistentKeepalive: t("keepaliveIntervalInSeconds0DisablesIt"),
    PreUp: t("commandToRunBeforeTheInterfaceStarts"),
    PostUp: t("commandToRunAfterTheInterfaceStarts"),
    PreDown: t("commandToRunBeforeTheInterfaceStops"),
    PostDown: t("commandToRunAfterTheInterfaceStops"),
    SaveConfig: t("saveConfigurationOnExitTrueOrFalse"),
    MTU: t("maximumTransmissionUnitForThisInterface"),
    Table: t("routingTableNumberAutoOrOff"),
  };
}
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
function createDocument(name = "wg0.conf", text?: string) {
  let model = text === undefined ? newConfig() : parse(text);
  let slot = 0;
  while (
    documents.some(
      (d) =>
        Math.abs(d.x - (slot % 3) * 540) < CARD_WIDTH + 60 &&
        Math.abs(d.y - Math.floor(slot / 3) * 600) < CARD_HEIGHT + 60,
    )
  )
    slot++;
  const d: ConfigDocument = {
    id: ++sequence,
    internalId: "",
    name,
    model,
    selected: 0,
    text: text ?? serialize(model),
    saved: text ?? null,
    history: [],
    future: [],
    handle: null,
    x: (slot % 3) * 540,
    y: Math.floor(slot / 3) * 600,
    error: "",
  };
  void crypto.subtle
    .digest("SHA-256", crypto.getRandomValues(new Uint8Array(32)))
    .then((hash) => {
      d.internalId = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      renderKeyInventory();
    });
  documents.push(d);
  active = d.id;
  sourceError = "";
  render();
  if (panel.editorId !== d.id) panel.openEditor(d.id, d.name);
  return d;
}
function dirty(d: ConfigDocument) {
  return d.text !== d.saved;
}
function remember() {
  rememberDocument(doc());
}
function change(mutate: () => void) {
  if (sourceError) {
    toast(t("fixTheSourceSyntaxErrorFirst"));
    return;
  }
  remember();
  mutate();
  doc().text = serialize(doc().model);
  render();
}
function setField(index: number, value: string) {
  const f = section().fields[index];
  if (!f?.key) return;
  remember();
  f.value = value;
  delete f.original;
  doc().text = serialize(doc().model);
  updateSource();
  renderTabs();
  renderValidation();
  updateDerived();
}
function renderTabs() {
  panel.syncDocuments(documents);
  updateEditMenu();
  $("#tabs").update(documents, active);
  $("#preview-name").textContent = doc().name;
  document
    .querySelector<ProfileTitleElement>("wg-profile-title")!
    .update(doc().id, doc().name);
  renderCanvas();
}
function renderNav() {
  const d = doc();
  $("#section-count").textContent = String(d.model.sections.length);
  $("#section-nav").update(d);
}
function renderFields() {
  dismissInlineConfirm();
  editor().updateSection(doc(), documents, fieldHints());
}

function updateSource() {
  editor().updateSource(doc().text, sourceError);
}
function renderValidation() {
  editor().updateValidation(
    sourceError ? [sourceError] : validate(doc().model),
    showIssues,
  );
}
async function updateDerived() {
  const token = ++derivedVersion,
    d = doc(),
    s = section(),
    key = s.fields.find((f) => f.key === "PrivateKey")?.value;
  const el = $("#derived");
  el.hidden = true;
  if (!key || sourceError) return;
  try {
    const pub = await cachedPublic(key);
    if (token !== derivedVersion || active !== d.id) return;
    editor().showDerived(pub, () => copyText(pub));
  } catch (error) {
    if (token !== derivedVersion) return;
    el.textContent = errorMessage(error);
    el.hidden = false;
  }
}
function render() {
  renderTabs();
  renderNav();
  renderFields();
  updateSource();
  renderValidation();
  updateDerived();
  if (panel.active === "inspector" && panel.editorId !== active)
    panel.openEditor(doc().id, doc().name);
}
async function confirmAction(
  title: string,
  message: string,
  anchor?: HTMLElement,
): Promise<boolean> {
  if (anchor) return confirmInline(anchor, title, message);
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  return (await panel.ask("confirm-dialog")) === "ok";
}
async function askName(initial: string): Promise<string | null> {
  $("#filename").value = initial;
  const result = panel.ask("name-dialog");
  $("#filename").focus();
  return (await result) === "ok" ? $("#filename").value.trim() : null;
}
function safeName(name: string) {
  return (
    name.replace(/[\\/\u0000-\u001f]/g, "_").replace(/^\.+$/, "config") ||
    "config.conf"
  );
}
document
  .querySelector("wg-studio-app")!
  .addEventListener("profile-rename", (event) => {
    const { id, name } = (event as CustomEvent<ProfileRenameDetail>).detail;
    const owner = documents.find((d) => d.id === id);
    if (owner && name && safeName(name) !== owner.name) {
      owner.name = safeName(name);
      owner.handle = null;
    }
    renderTabs();
  });
async function save(as = false) {
  const d = doc();
  if (as) {
    const name = await askName(d.name);
    if (!name) return;
    d.name = safeName(name);
    d.handle = null;
  }
  if (sourceError) {
    toast(t("theSourceContainsASyntaxErrorFixItBefore"));
    return;
  }
  try {
    if (d.handle && !as) {
      const writable = await d.handle.createWritable();
      await writable.write(d.text);
      await writable.close();
    } else if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: d.name,
        types: [
          {
            description: t("wireguardConfigFile"),
            accept: { "text/plain": [".conf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(d.text);
      await writable.close();
      d.handle = handle;
      d.name = handle.name;
    } else {
      const url = URL.createObjectURL(
        new Blob([d.text], { type: "text/plain;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = d.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    d.saved = d.text;
    renderTabs();
    toast(t("configurationSaved"));
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      toast(t("saveFailed", { v0: errorMessage(error) }));
  }
}
async function openFiles() {
  try {
    if (window.showOpenFilePicker) {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: t("wireguardConfigFile"),
            accept: { "text/plain": [".conf", ".txt"] },
          },
        ],
      });
      for (const handle of handles) {
        const file = await handle.getFile();
        try {
          const d = createDocument(file.name, await file.text());
          d.handle = handle;
        } catch (error) {
          toast(`${file.name}: ${errorMessage(error)}`);
        }
      }
      fitAll();
    } else $("#file-input").click();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      toast(errorMessage(error));
  }
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copiedToClipboard"));
  } catch {
    toast(t("clipboardAccessWasBlockedSelectAndCopyTheSource"));
  }
}
function restoreHistory(direction: "undo" | "redo") {
  const d = doc();
  if (!travelHistory(d, direction)) {
    toast(direction === "undo" ? t("noChangesToUndo") : t("noChangesToRedo"));
    return;
  }
  try {
    d.model = parse(d.text);
    d.selected = Math.min(d.selected, d.model.sections.length - 1);
    sourceError = "";
  } catch (error) {
    d.selected = Math.max(0, Math.min(d.selected, d.model.sections.length - 1));
    sourceError = errorMessage(error);
  }
  render();
}
function updateEditMenu() {
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="undo"]')
    .forEach((button) => (button.disabled = !doc().history.length));
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="redo"]')
    .forEach((button) => (button.disabled = !doc().future.length));
}
const exportController = createExportController(() => documents, toast);
const actions: Record<string, () => unknown> = {
  keyinventory: () => {
    panel.show("key-inventory");
    renderKeyInventory();
  },
  saveall: exportController.saveAll,
  export: exportController.open,
  batch: () => {
    $("#batch-error").textContent = "";
    panel.show("batch-dialog");
  },
  connect: openConnect,
  fit: fitAll,
  togglepanel: () => panel.toggle(),
  new: () => {
    const d = createDocument(`wg${sequence}.conf`);
    focusCard(d);
  },
  open: openFiles,
  import: () => {
    $("#import-error").textContent = "";
    panel.show("import-dialog");
  },
  save: () => save(),
  saveas: () => save(true),
  rename: async () => {
    const name = await askName(doc().name);
    if (name) {
      doc().name = safeName(name);
      doc().handle = null;
      renderTabs();
    }
  },
  peer: () =>
    change(() => {
      doc().model.sections.push(newPeer());
      doc().selected = doc().model.sections.length - 1;
    }),
  field: () =>
    change(() => {
      const s = section();
      s.fields.push({
        key:
          keys[s.type].find((k) => !s.fields.some((f) => f.key === k)) ||
          keys[s.type][0],
        value: "",
      });
    }),
  undo: () => restoreHistory("undo"),
  redo: () => restoreHistory("redo"),
  preview: () => {
    $(".preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    $("#source").focus();
  },
};
document.addEventListener("click", async (e) => {
  const edit = eventElement(e).closest<HTMLElement>("[data-edit]");
  if (edit) {
    selectDocument(+data(edit, "edit"));
    openInspector();
    return;
  }
  const edge = eventElement(e).closest<HTMLElement>("[data-edge-source]");
  if (edge) {
    selectDocument(+data(edge, "edgeSource"));
    doc().selected = +data(edge, "edgeSection");
    render();
    openInspector();
    return;
  }
  const action = eventElement(e).closest<HTMLElement>("[data-action]");
  if (action) {
    try {
      await actions[data(action, "action")]?.();
    } catch (error) {
      toast(errorMessage(error));
    }
    return;
  }
  const tabButton = eventElement(e).closest<HTMLElement>("[data-tab]");
  if (tabButton) {
    active = +data(tabButton, "tab");
    try {
      doc().model = parse(doc().text);
      sourceError = "";
    } catch (error) {
      sourceError = errorMessage(error);
    }
    render();
    focusCard(doc());
    return;
  }
  const close = eventElement(e).closest<HTMLElement>("[data-close]");
  if (close) {
    const id = +data(close, "close"),
      d = documents.find((x) => x.id === id);
    if (!d) return;
    if (
      dirty(d) &&
      !(await confirmInline(
        close,
        t("closeThisFile"),
        t("unsavedChangesToWillBeLost", { v0: d.name }),
        t("continue"),
        "below-tab",
      ))
    )
      return;
    documents = documents.filter((x) => x.id !== id);
    if (!documents.length) createDocument();
    else if (active === id) {
      active = documents.at(-1)!.id;
      sourceError = "";
      try {
        doc().model = parse(doc().text);
      } catch (error) {
        sourceError = errorMessage(error);
      }
      render();
    } else renderTabs();
    renderCanvas();
    return;
  }
  const nav = eventElement(e).closest<HTMLElement>("[data-section]");
  if (nav) {
    doc().selected = +data(nav, "section");
    render();
    return;
  }
  const remove = eventElement(e).closest<HTMLElement>("[data-remove]");
  if (remove) {
    change(() => section().fields.splice(+data(remove, "remove"), 1));
    return;
  }
  const reveal = eventElement(e).closest<HTMLElement>("[data-reveal]");
  if (reveal) {
    const input = $<HTMLInputElement>(
      `[data-value="${data(reveal, "reveal")}"]`,
    );
    input.type = input.type === "password" ? "text" : "password";
    return;
  }
  const dummy = eventElement(e).closest<HTMLElement>("[data-field-dummy]");
  if (dummy) {
    const owner = doc(),
      currentSection = section();
    const index = +data(dummy, "fieldDummy"),
      field = currentSection.fields[index];
    if (field?.key !== "PrivateKey") return;
    if (!owner.internalId) {
      toast(t("theIdentifierIsBeingPreparedTryAgainShortly"));
      return;
    }
    const value = `dummy:${owner.internalId.slice(0, 7)}`,
      original = field.value;
    if (
      original &&
      original !== value &&
      !(await confirmAction(
        t("replaceThePrivateKeyWithADummyKey"),
        t("thisReplacesThePrivateKeyPeersUsingItsExisting"),
        dummy,
      ))
    )
      return;
    if (
      doc() !== owner ||
      section() !== currentSection ||
      currentSection.fields[index] !== field ||
      field.value !== original
    )
      return;
    setField(index, value);
    renderFields();
    toast(t("dummyKeyAppliedSelectThisProfileInTheRemote"));
    return;
  }
  const gen = eventElement(e).closest<HTMLElement>("[data-generate]");
  if (gen) {
    const owner = doc(),
      peer = section();
    const index = +data(gen, "generate"),
      f = peer.fields[index],
      originalValue = f.value;
    if (
      f.value &&
      !(await confirmAction(
        t("generateANewKey"),
        t("thisReplacesTheExistingKeyUpdateTheConfigurationOn"),
        gen,
      ))
    )
      return;
    if (
      doc() !== owner ||
      section() !== peer ||
      peer.fields[index] !== f ||
      f.value !== originalValue
    )
      return;
    try {
      setField(
        index,
        f.key === "PrivateKey" ? generatePrivateKey() : generatePresharedKey(),
      );
      renderFields();
    } catch (error) {
      toast(errorMessage(error));
    }
    return;
  }
  const itemRemove = eventElement(e).closest<HTMLElement>("[data-item-remove]");
  if (itemRemove) {
    const [i, j] = data(itemRemove, "itemRemove").split(":").map(Number),
      items = splitList(editableField(i).value);
    items.splice(j, 1);
    setField(i, items.join(", "));
    renderFields();
    return;
  }
  const itemAdd = eventElement(e).closest<HTMLElement>("[data-item-add]");
  if (itemAdd) {
    const i = +data(itemAdd, "itemAdd");
    $("#fields").appendListItem(editableField(i), i);
    return;
  }
});
$("#fields").addEventListener("input", (e) => {
  if (eventElement(e).matches("[data-value]")) {
    const i = +data(eventElement(e), "value");
    setField(i, eventElement<HTMLInputElement>(e).value);
    if (listKeys.includes(editableField(i).key))
      $("#fields").updateList(editableField(i), i);
  } else if (eventElement(e).matches("[data-item]")) {
    const [i] = data(eventElement(e), "item").split(":").map(Number);
    const items = [...$(`[data-list="${i}"]`).querySelectorAll("input")]
      .map((el) => el.value.trim())
      .filter(Boolean);
    setField(i, items.join(", "));
    $<HTMLInputElement>(`[data-value="${i}"]`).value = editableField(i).value;
  }
});
$("#fields").addEventListener("change", async (e) => {
  if (!eventElement(e).matches("[data-key]")) return;
  const index = +data(eventElement(e), "key");
  let value: string | null = eventElement<HTMLInputElement>(e).value;
  if (value === "__custom") {
    value = await askName("CustomField");
    if (!value || !/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
      toast(t("fieldNamesMustStartWithALetterAndContain"));
      renderFields();
      return;
    }
  }
  change(() => {
    const f = section().fields[index];
    if (value === null) return;
    f.key = value;
    delete f.original;
  });
});
$("#source").addEventListener("input", () => {
  remember();
  doc().text = $("#source").value;
  try {
    doc().model = parse(doc().text);
    doc().selected = Math.min(doc().selected, doc().model.sections.length - 1);
    sourceError = "";
    renderNav();
    renderFields();
  } catch (error) {
    sourceError = errorMessage(error);
  }
  updateSource();
  renderValidation();
  renderTabs();
  updateDerived();
});
$("#source").addEventListener("scroll", () => {
  $("#line-numbers").scrollTop = $("#source").scrollTop;
});
window.addEventListener("panelresize", () => {
  document.querySelector<AppMenuElement>("wg-app-menu")!.panelVisible =
    panel.visible;
});
$("#file-input").onchange = async (e) => {
  for (const file of eventElement<HTMLInputElement>(e).files ?? []) {
    try {
      createDocument(file.name, await file.text());
    } catch (error) {
      toast(`${file.name}: ${errorMessage(error)}`);
    }
  }
  eventElement<HTMLInputElement>(e).value = "";
  fitAll();
};
$("#import-submit").onclick = () => {
  try {
    const name = safeName($("#import-name").value.trim() || "imported.conf");
    const d = createDocument(name, $("#import-source").value);
    d.saved = null;
    panel.close("import-dialog");
    $("#import-source").value = "";
    renderTabs();
    focusCard(d);
  } catch (error) {
    $("#import-error").textContent = errorMessage(error);
  }
};
$("#delete-section").onclick = () => {
  if (sourceError) {
    toast(t("fixTheSourceSyntaxErrorFirst"));
    return;
  }
  document.getElementById("peer-delete-title")!.textContent =
    section().type === "Peer" ? t("deleteThisPeer") : t("deleteThisInterface");
  document.getElementById("peer-delete-confirm")!.hidden = false;
  document.getElementById("peer-delete-cancel")!.focus();
};
document.getElementById("peer-delete-cancel")!.onclick = () => {
  document.getElementById("peer-delete-confirm")!.hidden = true;
  $("#delete-section").focus();
};
document.getElementById("peer-delete-accept")!.onclick = () =>
  change(() => {
    doc().model.sections.splice(doc().selected, 1);
    if (!doc().model.sections.length)
      doc().model.sections.push({ type: "Interface", fields: [] });
    doc().selected = 0;
  });
$<HTMLSelectElement>("#peer-profile-select").onchange = () => {
  $<HTMLButtonElement>("#peer-profile-connect").disabled =
    !$<HTMLSelectElement>("#peer-profile-select").value;
  $<HTMLButtonElement>("#peer-profile-connect").textContent =
    $<HTMLSelectElement>("#peer-profile-select").value === "__new"
      ? t("createAndConnect")
      : t("connect");
};
$<HTMLButtonElement>("#peer-profile-connect").onclick = async () => {
  const source = doc(),
    peer = section(),
    sourceText = source.text;
  if (peer.type !== "Peer" || sourceError) return;
  const selection = $<HTMLSelectElement>("#peer-profile-select").value;
  let target: ConfigDocument | undefined;
  if (selection === "__new") {
    await createLinkedProfile(source, peer);
    return;
  }
  target = documents.find((d) => d.id === Number(selection));
  const status = document.getElementById("peer-profile-status")!,
    button = $<HTMLButtonElement>("#peer-profile-connect");
  if (!target || target === source || peer.type !== "Peer" || sourceError)
    return;
  const targetText = target.text;
  button.disabled = true;
  try {
    const model = parse(targetText);
    const interfaces = model.sections.filter((s) => s.type === "Interface");
    if (interfaces.length !== 1)
      throw new Error(
        t("theTargetProfileMustContainExactlyOneInterfaceSection"),
      );
    const iface = interfaces[0];
    const fields = iface.fields.filter((f) => f.key === "PrivateKey");
    if (fields.length > 1)
      throw new Error(t("checkTheTargetProfileForDuplicatePrivatekeyFields"));
    let privateKey = fields[0]?.value || "";
    let regenerate = false;
    try {
      if (!/^dummy:[a-f0-9]{7}$/.test(privateKey)) decodeKey(privateKey);
    } catch {
      regenerate = true;
    }
    if (regenerate) {
      const accepted = await confirmInline(
        button,
        t("thisKeyAppearsToBeInvalidGenerateANew"),
        t("generateAPrivateKeyForAndApplyItsPublic", { v0: target.name }),
        t("createAndConnect"),
      );
      if (!accepted) return;
      privateKey = generatePrivateKey();
    }
    const publicKey = await cachedPublic(privateKey);
    if (
      doc() !== source ||
      section() !== peer ||
      source.text !== sourceText ||
      target.text !== targetText ||
      !documents.includes(target)
    )
      throw new Error(t("theConfigurationChangedTryConnectingAgain"));
    if (regenerate) {
      const field = fields[0];
      if (field) {
        field.value = privateKey;
        delete field.original;
      } else iface.fields.unshift({ key: "PrivateKey", value: privateKey });
      rememberDocument(target);
      target.model = model;
      target.text = serialize(model);
    }
    change(() => {
      const field = peer.fields.find((f) => f.key === "PublicKey");
      if (field) {
        field.value = publicKey;
        delete field.original;
      } else peer.fields.unshift({ key: "PublicKey", value: publicKey });
    });
    status.textContent = t("connectedToCheckTheReversePeerConfigurationToo", {
      v0: target.name,
    });
  } catch (error) {
    status.textContent = t("connectionFailed", { v0: errorMessage(error) });
  } finally {
    button.disabled = !$<HTMLSelectElement>("#peer-profile-select").value;
  }
};
async function createLinkedProfile(
  source: ConfigDocument,
  peer: ConfigModel["sections"][number],
) {
  const button = $<HTMLButtonElement>("#peer-profile-connect");
  const status = document.getElementById("peer-profile-status")!;
  const originalText = source.text;
  button.disabled = true;
  try {
    const sourceModel = parse(originalText);
    const interfaces = sourceModel.sections.filter(
      (section) => section.type === "Interface",
    );
    if (interfaces.length !== 1)
      throw new Error(t("sourceProfileNeedsOneInterface"));
    const iface = interfaces[0];
    const privateFields = iface.fields.filter(
      (field) => field.key === "PrivateKey",
    );
    if (privateFields.length > 1)
      throw new Error(t("sourceProfileDuplicatePrivateKey"));
    let privateKey = privateFields[0]?.value || "";
    try {
      if (!/^dummy:[a-f0-9]{7}$/.test(privateKey)) decodeKey(privateKey);
    } catch {
      if (
        !(await confirmInline(
          button,
          t("thisKeyAppearsToBeInvalidGenerateANew"),
          t("sourceKeyForReversePeer", { v0: source.name }),
          t("createAndConnect"),
        ))
      )
        return;
      privateKey = generatePrivateKey();
      const field = privateFields[0];
      if (field) {
        field.value = privateKey;
        delete field.original;
      } else iface.fields.unshift({ key: "PrivateKey", value: privateKey });
    }
    const targetModel = newConfig();
    const targetPrivate = generatePrivateKey();
    targetModel.sections[0].fields.find(
      (field) => field.key === "PrivateKey",
    )!.value = targetPrivate;
    const [sourcePublic, targetPublic] = await Promise.all([
      cachedPublic(privateKey),
      cachedPublic(targetPrivate),
    ]);
    if (
      doc() !== source ||
      section() !== peer ||
      source.text !== originalText ||
      !documents.includes(source)
    )
      throw new Error(t("theConfigurationChangedTryConnectingAgain"));
    const sourcePeer = sourceModel.sections[source.selected];
    const publicField = sourcePeer.fields.find(
      (field) => field.key === "PublicKey",
    );
    if (publicField) {
      publicField.value = targetPublic;
      delete publicField.original;
    } else sourcePeer.fields.unshift({ key: "PublicKey", value: targetPublic });
    targetModel.sections.push(peerForInterface(sourceModel, sourcePublic));
    rememberDocument(source);
    source.model = sourceModel;
    source.text = serialize(sourceModel);
    const target = createDocument(`wg${sequence}.conf`, serialize(targetModel));
    target.saved = null;
    active = source.id;
    render();
    panel.openEditor(source.id, source.name);
    $<HTMLSelectElement>("#peer-profile-select").value = String(target.id);
    status.textContent = t("profileCreatedAndConnectedBothWays", {
      v0: target.name,
    });
  } catch (error) {
    status.textContent = t("connectionFailed", { v0: errorMessage(error) });
  } finally {
    button.disabled = !$<HTMLSelectElement>("#peer-profile-select").value;
    button.textContent =
      $<HTMLSelectElement>("#peer-profile-select").value === "__new"
        ? t("createAndConnect")
        : t("connect");
  }
}

$("#copy").onclick = () => copyText(doc().text);
$("#validation-toggle").onclick = () => {
  showIssues = !showIssues;
  renderValidation();
};
document
  .getElementById("theme")
  ?.addEventListener("click", () => document.body.classList.toggle("dark"));
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || panel.taskOpen) return;
  const key = e.key.toLowerCase();
  if (["s", "o"].includes(key)) {
    e.preventDefault();
    key === "s" ? save(e.shiftKey) : openFiles();
  }
  if (key === "z" || key === "y") {
    e.preventDefault();
    actions[key === "y" || e.shiftKey ? "redo" : "undo"]();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (documents.some(dirty)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("panelopeneditor", () => openInspector());
window.addEventListener("panelactivate", (event) => {
  const tab = (event as CustomEvent<{ documentId?: number }>).detail;
  if (
    tab?.documentId !== undefined &&
    documents.some((d) => d.id === tab.documentId)
  )
    selectDocument(tab.documentId);
});
initializeCanvas();
createDocument();
openInspector();
if (window.innerWidth < 650) {
  camera.scale = Math.min(0.9, (window.innerWidth - 48) / CARD_WIDTH);
  focusCard(doc());
}

function selectDocument(id: number) {
  if (active === id) return;
  active = id;
  sourceError = "";
  try {
    doc().model = parse(doc().text);
  } catch (error) {
    sourceError = errorMessage(error);
  }
  render();
}
function openInspector() {
  document.getElementById("peer-delete-confirm")!.hidden = true;
  panel.openEditor(doc().id, doc().name);
}
function applyCamera() {
  network().setCamera(camera);
}
function fitAll() {
  camera = fitCamera(
    documents,
    $("#canvas").clientWidth,
    Math.max(140, $("#canvas").clientHeight - 310),
    30,
  );
  camera.y += 250;
  applyCamera();
}
function focusCard(d: ConfigDocument) {
  const available =
    window.innerWidth -
    (document.getElementById("right-panel")!.hidden
      ? 0
      : document.getElementById("right-panel")!.getBoundingClientRect().width);
  camera = {
    ...camera,
    x:
      Math.max(30, (available - CARD_WIDTH * camera.scale) / 2) -
      d.x * camera.scale,
    y:
      Math.max(270, (window.innerHeight - CARD_HEIGHT * camera.scale) / 2) -
      d.y * camera.scale,
  };
  applyCamera();
}
async function renderKeyInventory() {
  const root = document.getElementById("key-inventory-list");
  if (!root) return;
  const revision = ++inventoryRevision;
  const snapshot = documents.map((d) => ({
    id: d.id,
    name: d.name,
    internalId: d.internalId,
    model: d.model,
    error: d.error,
  }));
  const entries = new Map<string, KeyEntry>();
  const entry = (key: string): KeyEntry => {
    if (!entries.has(key))
      entries.set(key, {
        publicKey: key,
        privateKeys: new Set(),
        privateUses: [],
        publicUses: [],
      });
    return entries.get(key)!;
  };
  await Promise.all(
    snapshot.map(async (d) => {
      if (d.error) return;
      await Promise.all(
        d.model.sections.map(async (section, index) => {
          const location = `${d.name} · ${d.internalId.slice(0, 7)} · ${section.type} #${index + 1}`;
          await Promise.all(
            section.fields.map(async (field) => {
              if (!field.key || !field.value) return;
              if (field.key === "PrivateKey") {
                let publicKey: string;
                let invalid = false;
                try {
                  publicKey = await cachedPublic(field.value);
                } catch {
                  publicKey = `invalid:${field.value}`;
                  invalid = true;
                }
                const item = entry(publicKey);
                item.invalid = invalid;
                item.privateKeys.add(field.value);
                item.privateUses.push(`${location} · PrivateKey`);
              } else if (field.key === "PublicKey") {
                entry(field.value).publicUses.push(`${location} · PublicKey`);
              }
            }),
          );
        }),
      );
    }),
  );
  if (revision !== inventoryRevision) return;
  document
    .querySelector<KeyLibraryElement>("wg-key-library")!
    .update(snapshot, entries);
}
document
  .getElementById("dummy-key-controls")!
  .addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-dummy-key]",
    );
    if (!button) return;
    const target = documents.find(
      (d) => d.id === Number(button.dataset.dummyKey),
    );
    if (!target?.internalId || target.error) return;
    const iface = target.model.sections.find((s) => s.type === "Interface");
    if (!iface) {
      toast(t("addAnInterfaceSectionFirst"));
      return;
    }
    const key = `dummy:${target.internalId.slice(0, 7)}`;
    const text = target.text;
    if (
      iface.fields.some(
        (f) => f.key === "PrivateKey" && f.value && f.value !== key,
      )
    ) {
      if (
        !(await confirmInline(
          button,
          t("replaceThePrivateKeyWithADummyKey"),
          t("thisReplacesThePrivateKeyPeersUsingItsExisting"),
          t("applyDummyKey"),
        ))
      )
        return;
    }
    if (!documents.includes(target) || target.text !== text) {
      toast(t("theConfigurationChangedTryAgain"));
      return;
    }
    rememberDocument(target);
    const fields = iface.fields.filter((f) => f.key === "PrivateKey");
    if (fields.length)
      for (const field of fields) {
        field.value = key;
        delete field.original;
      }
    else iface.fields.unshift({ key: "PrivateKey", value: key });
    target.text = serialize(target.model);
    render();
    toast(t("appliedTo", { v0: target.name, v1: key }));
  });

function cachedPublic(key: string): Promise<string> {
  if (/^dummy:[a-f0-9]{7}$/.test(key)) return Promise.resolve(key);
  if (!publicKeyCache.has(key)) {
    if (publicKeyCache.size > 200) publicKeyCache.clear();
    publicKeyCache.set(key, publicFromPrivate(key));
  }
  return publicKeyCache.get(key)!;
}
function renderCanvas() {
  network().updateCards(documents, active);
  applyCamera();
  updateConnections();
}
async function updateConnections() {
  void renderKeyInventory();
  const revision = ++connectionRevision;
  const snapshot = documents.map((d) => ({ ...d })),
    pubs = new Map<number, string>();
  await Promise.all(
    snapshot.map(async (d) => {
      if (d.error) return;
      const key = d.model.sections
        .find((s) => s.type === "Interface")
        ?.fields.find((f) => f.key === "PrivateKey")?.value;
      if (!key) return;
      try {
        pubs.set(d.id, await cachedPublic(key));
      } catch {}
    }),
  );
  if (revision !== connectionRevision) return;
  canvasEdges = keyConnections(snapshot, pubs);
  network().updateConnections(documents, canvasEdges, active, camera);
}
function redrawConnections() {
  network().redrawConnections(documents, canvasEdges, camera);
}

function initializeCanvas() {
  const canvas = $("#canvas"),
    touches = new Map<number, Point>();
  $("#fit-canvas").onclick = fitAll;
  const zoom = (factor: number) => {
    camera = zoomAt(
      camera,
      { x: $("#canvas").clientWidth / 2, y: $("#canvas").clientHeight / 2 },
      camera.scale * factor,
    );
    applyCamera();
  };
  $("#zoom-in").onclick = () => zoom(1.2);
  $("#zoom-out").onclick = () => zoom(1 / 1.2);
  $("#zoom-reset").onclick = () => {
    camera = zoomAt(
      camera,
      { x: $("#canvas").clientWidth / 2, y: $("#canvas").clientHeight / 2 },
      1,
    );
    applyCamera();
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (
        eventElement(e).closest<HTMLElement>("textarea,.card-peers") &&
        !e.ctrlKey &&
        !e.metaKey
      )
        return;
      e.preventDefault();
      camera = zoomAt(
        camera,
        { x: e.clientX, y: e.clientY },
        camera.scale * Math.exp(-e.deltaY * 0.002),
      );
      applyCamera();
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (e) => {
    if (eventElement(e).closest(".canvas-notice,.card-name > strong")) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (
      e.pointerType === "touch" &&
      !eventElement(e).closest<HTMLElement>("textarea,button,input,select")
    ) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const [a, b] = [...touches.values()];
        gesture = {
          type: "pinch",
          camera: { ...camera },
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        };
        return;
      }
    }
    const card = eventElement(e).closest<HTMLElement>("[data-document]"),
      drag = eventElement(e).closest<HTMLElement>("[data-drag]");
    if (card) selectDocument(+data(card, "document"));
    const pan =
      e.button === 1 ||
      spaceDown ||
      (!card && !eventElement(e).closest<HTMLElement>("[data-edge-source]"));
    if (
      !pan &&
      (!drag ||
        eventElement(e).closest<HTMLElement>("button,input,textarea,select"))
    )
      return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const start = {
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      camera: { ...camera },
    };
    gesture = pan
      ? { ...start, type: "pan", id: card ? +data(card, "document") : null }
      : { ...start, type: "card", id: doc().id, x: doc().x, y: doc().y };
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId))
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.type === "pinch" && touches.size === 2) {
      e.preventDefault();
      const [a, b] = [...touches.values()],
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      camera = zoomAt(
        gesture.camera,
        gesture.mid,
        (gesture.camera.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
          gesture.distance,
      );
      camera.x += mid.x - gesture.mid.x;
      camera.y += mid.y - gesture.mid.y;
      applyCamera();
      return;
    }
    if (!gesture || gesture.type === "pinch" || e.pointerId !== gesture.pointer)
      return;
    const dx = e.clientX - gesture.startX,
      dy = e.clientY - gesture.startY;
    if (gesture.type === "pan") {
      camera.x = gesture.camera.x + dx;
      camera.y = gesture.camera.y + dy;
      applyCamera();
    } else {
      const current = gesture;
      const d = documents.find((d) => d.id === current.id);
      if (!d) return;
      d.x = gesture.x + dx / camera.scale;
      d.y = gesture.y + dy / camera.scale;
      const el = $(`[data-document="${d.id}"]`);
      el.style.left = `${d.x}px`;
      el.style.top = `${d.y}px`;
      redrawConnections();
    }
  });
  const finish = (e?: PointerEvent) => {
    if (e?.pointerId !== undefined) touches.delete(e.pointerId);
    else touches.clear();
    gesture = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);
  canvas.addEventListener("input", (e) => {
    if (!eventElement(e).matches(".canvas-source")) return;
    const card = eventElement(e).closest<HTMLElement>("[data-document]");
    if (!card) return;
    const d = documents.find((d) => d.id === +data(card, "document"));
    if (!d) return;
    if (active !== d.id) selectDocument(d.id);
    remember();
    d.text = eventElement<HTMLTextAreaElement>(e).value;
    try {
      d.model = parse(d.text);
      d.selected = Math.min(d.selected, d.model.sections.length - 1);
      sourceError = "";
    } catch (error) {
      sourceError = errorMessage(error);
    }
    renderNav();
    renderFields();
    updateSource();
    renderValidation();
    renderTabs();
    updateDerived();
  });
  canvas.addEventListener("click", async (e) => {
    const saveButton = eventElement(e).closest<HTMLElement>("[data-card-save]");
    if (saveButton) {
      selectDocument(+data(saveButton, "cardSave"));
      await save();
    }
  });
  canvas.addEventListener("dblclick", (e) => {
    if (eventElement(e).closest(".card-name > strong")) return;
    if (eventElement(e).closest<HTMLElement>("[data-drag]")) openInspector();
  });
  document.addEventListener("keydown", (e) => {
    const typing = eventElement(e).closest<HTMLElement>(
      "input,textarea,select,[contenteditable=true]",
    );
    if (e.code === "Space" && !typing && !panel.taskOpen) {
      e.preventDefault();
      spaceDown = true;
      canvas.classList.add("space-pan");
    }
    if (!typing && !panel.taskOpen && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      zoom(1.2);
    }
    if (!typing && !panel.taskOpen && e.key === "-") {
      e.preventDefault();
      zoom(1 / 1.2);
    }
    if (!typing && !panel.taskOpen && e.key === "0") {
      e.preventDefault();
      fitAll();
    }
    if (e.key === "Escape") {
      const confirmation = document.getElementById("peer-delete-confirm")!;
      if (!confirmation.hidden) {
        confirmation.hidden = true;
        $("#delete-section").focus();
        return;
      }
      panel.close();
      finish();
    }
    if (
      (e.key === "Enter" || e.key === " ") &&
      eventElement(e).matches("[data-edge-source]")
    ) {
      e.preventDefault();
      eventElement(e).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spaceDown = false;
      canvas.classList.remove("space-pan");
    }
  });
  window.addEventListener("blur", () => {
    spaceDown = false;
    finish();
    canvas.classList.remove("space-pan");
  });
  window.addEventListener("resize", applyCamera);
  window.addEventListener("panelresize", applyCamera);
  $("#batch-submit").onclick = () => {
    const count = +$("#batch-count").value,
      prefix = safeName($("#batch-prefix").value.trim());
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      $("#batch-error").textContent = t(
        "youCanCreateBetween1And20Configurations",
      );
      return;
    }
    try {
      for (let i = 0; i < count; i++) {
        const model = newConfig();
        const used = new Set(
          documents.flatMap((d) =>
            d.model.sections
              .filter((s) => s.type === "Interface")
              .flatMap((s) =>
                s.fields
                  .filter((f) => f.key === "Address")
                  .flatMap((f) =>
                    splitList(f.value ?? "").map((ip) => ip.split("/")[0]),
                  ),
              ),
          ),
        );
        let octet = 1;
        while (octet < 255 && used.has(`10.0.0.${octet}`)) octet++;
        model.sections[0].fields.find((f) => f.key === "Address")!.value =
          `10.0.0.${octet}/24`;
        if ($("#batch-keys").checked)
          model.sections[0].fields[0].value = generatePrivateKey();
        createDocument(`${prefix}${sequence}.conf`, serialize(model)).saved =
          null;
      }
      panel.close("batch-dialog");
      renderTabs();
      fitAll();
      toast(t("createdConfigurations", { v0: count }));
    } catch (error) {
      $("#batch-error").textContent = errorMessage(error);
    }
  };
  $("#connect-submit").onclick = connectDocuments;
  for (const id of ["batch-dialog", "connect-dialog"])
    $(`#${id} form`).addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !eventElement(e).matches("button,select")) {
        e.preventDefault();
        $(id === "batch-dialog" ? "#batch-submit" : "#connect-submit").click();
      }
    });
}
function openConnect() {
  if (documents.length < 2) {
    toast(t("openOrCreateAtLeastTwoConfigurationsFirst"));
    return;
  }
  const options = documents
    .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
    .join("");
  $("#connect-source").innerHTML = options;
  $("#connect-target").innerHTML = options;
  $("#connect-source").value = String(active);
  $("#connect-target").value = String(
    documents.find((d) => d.id !== active)!.id,
  );
  $("#connect-error").textContent = "";
  panel.show("connect-dialog");
}
async function connectDocuments() {
  const source = documents.find((d) => d.id === +$("#connect-source").value),
    target = documents.find((d) => d.id === +$("#connect-target").value),
    mutual = $("#connect-mutual").checked;
  if (!source || !target) {
    $("#connect-error").textContent = t(
      "theConfigurationToConnectCouldNotBeFound",
    );
    return;
  }
  if (source === target) {
    $("#connect-error").textContent = t("selectTwoDifferentConfigurations");
    return;
  }
  const button = $("#connect-submit");
  button.disabled = true;
  try {
    const sourceText = source.text,
      targetText = target.text;
    const sourceModel = parse(sourceText),
      targetModel = parse(targetText),
      getKey = (m: ConfigModel) =>
        m.sections
          .find((s) => s.type === "Interface")
          ?.fields.find((f) => f.key === "PrivateKey")?.value;
    const targetPublic = await cachedPublic(getKey(targetModel) || "");
    const sourcePublic = mutual
      ? await cachedPublic(getKey(sourceModel) || "")
      : null;
    if (
      source.text !== sourceText ||
      target.text !== targetText ||
      !documents.includes(source) ||
      !documents.includes(target)
    )
      throw new Error(t("theConfigurationChangedTryAgain"));
    function appendPeer(
      d: ConfigDocument,
      model: ConfigModel,
      remote: ConfigModel,
      publicKey: string,
    ) {
      if (
        model.sections.some(
          (s) =>
            s.type === "Peer" &&
            s.fields.some(
              (f) => f.key === "PublicKey" && f.value === publicKey,
            ),
        )
      )
        return false;
      rememberDocument(d);
      const p = peerForInterface(remote, publicKey);
      model.sections.push(p);
      d.model = model;
      d.text = serialize(model);
      return true;
    }
    let count = Number(
      appendPeer(source, sourceModel, targetModel, targetPublic),
    );
    if (mutual)
      count += Number(
        appendPeer(target, targetModel, sourceModel, sourcePublic!),
      );
    sourceError = "";
    panel.close("connect-dialog");
    render();
    toast(
      count
        ? t("addedPeersSetTheirEndpointInTheEditor", { v0: count })
        : t("aPeerWithTheSamePublicKeyAlreadyExists"),
    );
  } catch (error) {
    $("#connect-error").textContent = t(
      "checkThePrivateKeyOfTheConfigurationToConnect",
      { v0: errorMessage(error) },
    );
  } finally {
    button.disabled = false;
  }
}

window.addEventListener("localechange", () => {
  publicKeyCache.clear();
  clearTimeout(toastTimer);
  $("#toast").classList.remove("show");
  try {
    parse(doc().text);
    sourceError = "";
  } catch (error) {
    sourceError = errorMessage(error);
  }
  render();
  document.querySelector<AppMenuElement>("wg-app-menu")!.panelVisible =
    panel.visible;
});
