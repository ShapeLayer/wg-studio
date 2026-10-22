import "./tooltip.ts";
import { confirmInline, dismissInlineConfirm } from "./inline-confirm.ts";
import { panel } from "./panel.ts";
import { rememberDocument, travelHistory } from "./history.ts";
import { createExportController } from "./export-dialog.ts";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  dotGrid,
  zoomAt,
  fitCamera,
  keyConnections,
  edgeCurve,
  hasReverseConnection,
} from "./canvas.ts";
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
} from "./core.ts";
import type {
  ConfigDocument,
  ConfigField,
  ConfigModel,
  Camera,
  CanvasGesture,
  Point,
  KeyConnection,
} from "./types.ts";

type DomElements = {
  "#theme": HTMLButtonElement;
  "#file-menu": HTMLButtonElement;
  "#file-options": HTMLElement;
  "#tabs": HTMLElement;
  "#inspector": HTMLElement;
  "#inspector-name": HTMLElement;
  "#close-inspector": HTMLButtonElement;
  "#section-count": HTMLElement;
  "#section-nav": HTMLElement;
  "#section-icon": HTMLElement;
  "#section-title": HTMLElement;
  "#section-description": HTMLElement;
  "#delete-section": HTMLButtonElement;
  "#section-tag": HTMLElement;
  "#fields": HTMLElement;
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
  "#pan-mode": HTMLButtonElement;
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
const esc = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
let documents: ConfigDocument[] = [],
  active: number,
  sequence = 0,
  sourceError = "",
  showIssues = false,
  toastTimer: ReturnType<typeof setTimeout> | undefined,
  derivedVersion = 0;
let camera: Camera = { x: 65, y: 270, scale: 0.9 },
  panMode = false,
  spaceDown = false,
  gesture: CanvasGesture | null = null,
  connectionRevision = 0,
  canvasEdges: KeyConnection[] = [];
let inventoryRevision = 0;
const publicKeyCache = new Map<string, Promise<string>>();
const doc = (): ConfigDocument => {
  const current = documents.find((d) => d.id === active);
  if (!current) throw new Error("No active configuration.");
  return current;
};
const section = () => doc().model.sections[doc().selected];
const hints: Record<string, string> = {
  PrivateKey: "이 인터페이스의 비밀 키",
  PublicKey: "연결할 상대 피어의 공개키",
  PresharedKey: "추가 보안을 위한 공유 키",
  Address: "인터페이스에 할당할 IP / CIDR",
  AllowedIPs: "이 피어로 라우팅할 IP / CIDR",
  ListenPort: "수신할 UDP 포트",
  DNS: "DNS 서버 또는 검색 도메인",
  Endpoint: "호스트:포트 · IPv6는 [주소]:포트",
  PersistentKeepalive: "연결 유지 간격 (초), 0은 비활성화",
  PreUp: "인터페이스 시작 전 실행할 명령",
  PostUp: "인터페이스 시작 후 실행할 명령",
  PreDown: "인터페이스 종료 전 실행할 명령",
  PostDown: "인터페이스 종료 후 실행할 명령",
  SaveConfig: "종료 시 설정 저장 · true 또는 false",
  MTU: "인터페이스의 최대 전송 단위",
  Table: "라우팅 테이블 번호, auto 또는 off",
};
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
    toast("원문의 형식 오류를 먼저 수정하세요.");
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
  $("#tabs").innerHTML = documents
    .map(
      (d) =>
        `<div class="file-tab ${d.id === active ? "active" : ""}"><button role="tab" aria-selected="${d.id === active}" data-tab="${d.id}"><span aria-hidden="true">▤</span> ${esc(d.name)}${dirty(d) ? ' <span data-tooltip="저장하지 않음">•</span>' : ""}</button><button class="close-tab" data-close="${d.id}" aria-label="${esc(d.name)} 닫기">×</button></div>`,
    )
    .join("");
  $("#preview-name").textContent = doc().name;
  $("#inspector-name").textContent = doc().name;
  renderCanvas();
}
function renderNav() {
  const d = doc();
  let peers = 0;
  $("#section-count").textContent = String(d.model.sections.length);
  $("#section-nav").innerHTML = d.model.sections
    .map((s, i) => {
      const n = s.type === "Peer" ? ++peers : 0;
      return `<button class="section-nav-button ${i === d.selected ? "active" : ""}" data-section="${i}" aria-current="${i === d.selected ? "true" : "false"}"><span class="nav-symbol">${n ? "⇄" : "⌘"}</span><span>${n ? `Peer ${String(n).padStart(2, "0")}` : "Interface"}<small>${n ? "연결할 상대 기기" : "내 기기 설정"}</small></span><span class="nav-arrow">›</span></button>`;
    })
    .join("");
}
function renderFields() {
  dismissInlineConfirm();
  const s = section();
  document.getElementById("peer-delete-confirm")!.hidden = true;
  document.getElementById("peer-profile-link")!.hidden = s.type !== "Peer";
  $("#delete-section").setAttribute(
    "aria-label",
    s.type === "Peer" ? "피어 삭제" : "인터페이스 삭제",
  );
  const profileSelect = $<HTMLSelectElement>("#peer-profile-select");
  const previous = profileSelect.value;
  profileSelect.innerHTML =
    '<option value="">프로필 선택…</option>' +
    documents
      .filter((d) => d.id !== active)
      .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
      .join("");
  if ([...profileSelect.options].some((option) => option.value === previous))
    profileSelect.value = previous;
  $<HTMLButtonElement>("#peer-profile-connect").disabled = !profileSelect.value;
  document.getElementById("peer-profile-status")!.textContent =
    documents.length > 1
      ? "상대 프로필의 공개키를 이 피어에 적용합니다. 다른 필드는 유지됩니다."
      : "연결하려면 다른 컨피그 프로필을 먼저 열어주세요.";
  $("#section-title").textContent =
    s.type === "Interface"
      ? "Interface"
      : `Peer ${
          doc()
            .model.sections.slice(0, doc().selected + 1)
            .filter((x) => x.type === "Peer").length
        }`;
  $("#section-description").textContent =
    s.type === "Interface"
      ? "내 기기의 네트워크 인터페이스를 설정하세요."
      : "연결할 상대 기기와 라우팅을 설정하세요.";
  $("#section-icon").textContent = s.type === "Interface" ? "⌘" : "⇄";
  $("#section-tag").textContent = `[${s.type}]`;
  $("#fields").innerHTML = s.fields
    .map((f, i) => {
      if (!f.key) return "";
      const opts = [...new Set([...keys[s.type], f.key])];
      const secret = ["PrivateKey", "PresharedKey"].includes(f.key),
        isList = listKeys.includes(f.key);
      return `<div class="field" data-field="${i}"><div class="field-top"><span class="field-key"><select aria-label="필드 ${i + 1} 이름" data-key="${i}">${opts.map((k) => `<option ${k === f.key ? "selected" : ""}>${esc(k)}</option>`).join("")}<option value="__custom">사용자 정의…</option></select><svg class="select-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span><button class="remove-field" data-remove="${i}" aria-label="${esc(f.key)} 필드 삭제">×</button></div><div class="field-value"><input aria-label="${esc(f.key)} 값" data-value="${i}" class="${secret ? "key-input" : ""}" type="${secret ? "password" : "text"}" value="${esc(f.value)}" placeholder="${f.key === "Endpoint" ? "vpn.example.com:51820" : f.key.includes("Key") ? "Base64 encoded key" : "값을 입력하세요"}" spellcheck="false" autocomplete="off">${secret ? `<button class="reveal" data-reveal="${i}" aria-label="${esc(f.key)} 표시 전환">◉</button>` : ""}</div><div class="field-help"><span>${esc(hints[f.key] || "사용자 정의 설정 필드")}</span>${f.key === "PrivateKey" ? `<span class="key-field-actions"><button data-field-dummy="${i}">더미키로 연결</button><button data-generate="${i}">✦ 키 생성</button></span>` : f.key === "PresharedKey" ? `<button data-generate="${i}">✦ 공유 키 생성</button>` : isList ? "<span>쉼표로 구분</span>" : ""}</div>${isList ? `<div class="chips" data-list="${i}">${listHTML(f, i)}</div>` : ""}</div>`;
    })
    .join("");
}
function listHTML(f: ConfigField, i: number) {
  return (
    splitList(f.value)
      .map(
        (item, j) =>
          `<div class="list-item"><span>↳</span><input data-item="${i}:${j}" aria-label="${esc(f.key)} 항목 ${j + 1}" value="${esc(item)}" spellcheck="false"><button data-item-remove="${i}:${j}" aria-label="항목 ${j + 1} 삭제">×</button></div>`,
      )
      .join("") +
    `<button class="list-add" data-item-add="${i}">＋ 항목 추가</button>`
  );
}
function updateSource() {
  if ($("#source").value !== doc().text) $("#source").value = doc().text;
  $("#line-numbers").textContent = doc()
    .text.split("\n")
    .map((_, i) => String(i + 1).padStart(2, "0"))
    .join("\n");
  $("#parse-error").hidden = !sourceError;
  $("#parse-error").textContent = sourceError;
  $("#fields").inert = !!sourceError;
}
function renderValidation() {
  const issues = sourceError ? [sourceError] : validate(doc().model);
  $("#validation-title").textContent = issues.length
    ? `${issues.length}개 항목을 확인하세요`
    : "설정 형식이 올바릅니다";
  $("#validation-symbol").textContent = issues.length ? "◌" : "✓";
  $("#issues").innerHTML = issues.map((x) => `<li>${esc(x)}</li>`).join("");
  $("#issues").hidden = !showIssues;
  $("#validation-toggle").textContent = showIssues ? "접기" : "자세히";
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
    el.innerHTML = `<strong>이 인터페이스의 공개키</strong><input aria-label="계산된 인터페이스 공개키" readonly value="${esc(pub)}"><div class="field-help"><span>PrivateKey로 계산 · 설정 파일에 기록되지 않음</span><button id="copy-public">복사</button></div>`;
    el.hidden = false;
    $("#copy-public").onclick = () => copyText(pub);
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
async function save(as = false) {
  const d = doc();
  if (as) {
    const name = await askName(d.name);
    if (!name) return;
    d.name = safeName(name);
    d.handle = null;
  }
  if (sourceError) {
    toast("원문 형식 오류가 있습니다. 수정 후 저장하세요.");
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
            description: "WireGuard config",
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
    toast("설정 파일을 저장했습니다.");
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      toast(`저장 실패: ${errorMessage(error)}`);
  }
}
async function openFiles() {
  try {
    if (window.showOpenFilePicker) {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: "WireGuard config",
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
    toast("클립보드에 복사했습니다.");
  } catch {
    toast("클립보드 접근이 차단되었습니다. 원문을 선택해 복사하세요.");
  }
}
function restoreHistory(direction: "undo" | "redo") {
  const d = doc();
  if (!travelHistory(d, direction)) {
    toast(
      direction === "undo"
        ? "되돌릴 변경 사항이 없습니다."
        : "다시 실행할 변경 사항이 없습니다.",
    );
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
    closeViewMenu();
    document.getElementById("edit-options")!.hidden = true;
    document
      .getElementById("edit-menu")!
      .setAttribute("aria-expanded", "false");
    $("#file-options").hidden = true;
    $("#file-menu").setAttribute("aria-expanded", "false");
    try {
      await actions[data(action, "action")]?.();
    } catch (error) {
      toast(errorMessage(error));
    }
    return;
  }
  const t = eventElement(e).closest<HTMLElement>("[data-tab]");
  if (t) {
    active = +data(t, "tab");
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
      !(await confirmAction(
        "파일을 닫을까요?",
        `${d.name}의 저장하지 않은 변경 사항은 사라집니다.`,
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
      toast("식별자를 준비 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    const value = `dummy:${owner.internalId.slice(0, 7)}`,
      original = field.value;
    if (
      original &&
      original !== value &&
      !(await confirmAction(
        "개인키를 더미키로 바꾸시겠습니까?",
        "현재 개인키를 바꾸며, 기존 실제 공개키를 사용하는 피어 연결은 해제될 수 있습니다.",
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
    toast(
      "더미키를 적용했습니다. 상대 피어에서 이 프로필을 선택해 연결할 수 있습니다.",
    );
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
        "새 키를 생성할까요?",
        "기존 키를 교체합니다. 연결된 다른 기기의 설정도 업데이트해야 합니다.",
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
    const i = +data(itemAdd, "itemAdd"),
      container = $(`[data-list="${i}"]`),
      j = container.querySelectorAll("[data-item]").length;
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<span>↳</span><input data-item="${i}:${j}" aria-label="${esc(editableField(i).key)} 항목 ${j + 1}" placeholder="주소를 입력하세요"><button data-item-remove="${i}:${j}" aria-label="항목 ${j + 1} 삭제">×</button>`;
    container.insertBefore(row, itemAdd);
    row.querySelector("input")!.focus();
    return;
  }
  if (!eventElement(e).closest<HTMLElement>(".menu-wrap")) {
    closeViewMenu();
    document.getElementById("edit-options")!.hidden = true;
    document
      .getElementById("edit-menu")!
      .setAttribute("aria-expanded", "false");
    $("#file-options").hidden = true;
    $("#file-menu").setAttribute("aria-expanded", "false");
  }
});
$("#fields").addEventListener("input", (e) => {
  if (eventElement(e).matches("[data-value]")) {
    const i = +data(eventElement(e), "value");
    setField(i, eventElement<HTMLInputElement>(e).value);
    if (listKeys.includes(editableField(i).key))
      $(`[data-list="${i}"]`).innerHTML = listHTML(editableField(i), i);
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
      toast("필드 이름은 영문자로 시작하는 영문·숫자로 입력하세요.");
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
function closeViewMenu() {
  document.getElementById("view-options")!.hidden = true;
  document.getElementById("view-menu")!.setAttribute("aria-expanded", "false");
}
document.getElementById("view-menu")!.onclick = () => {
  const options = document.getElementById("view-options")!;
  options.hidden = !options.hidden;
  document
    .getElementById("view-menu")!
    .setAttribute("aria-expanded", String(!options.hidden));
  document.getElementById("toggle-panel")!.textContent = panel.visible
    ? "작업 패널 가리기"
    : "작업 패널 보기";
  document.getElementById("edit-options")!.hidden = true;
  document.getElementById("edit-menu")!.setAttribute("aria-expanded", "false");
  $("#file-options").hidden = true;
  $("#file-menu").setAttribute("aria-expanded", "false");
};
window.addEventListener("panelresize", () => {
  document.getElementById("toggle-panel")!.textContent = panel.visible
    ? "작업 패널 가리기"
    : "작업 패널 보기";
});
document.getElementById("edit-menu")!.onclick = () => {
  closeViewMenu();
  const options = document.getElementById("edit-options")!;
  options.hidden = !options.hidden;
  document
    .getElementById("edit-menu")!
    .setAttribute("aria-expanded", String(!options.hidden));
  $("#file-options").hidden = true;
  $("#file-menu").setAttribute("aria-expanded", "false");
};
$("#file-menu").onclick = () => {
  closeViewMenu();
  document.getElementById("edit-options")!.hidden = true;
  document.getElementById("edit-menu")!.setAttribute("aria-expanded", "false");
  $("#file-options").hidden = !$("#file-options").hidden;
  $("#file-menu").setAttribute(
    "aria-expanded",
    String(!$("#file-options").hidden),
  );
};
// Once a menu is open, pointer movement switches menus like a desktop menubar.
for (const name of ["file", "edit", "view"]) {
  const button = document.getElementById(`${name}-menu`)!;
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    const menus = ["file", "edit", "view"];
    const anyOpen = menus.some(
      (menu) => !document.getElementById(`${menu}-options`)!.hidden,
    );
    if (anyOpen && document.getElementById(`${name}-options`)!.hidden)
      button.click();
  });
}
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
    toast("원문의 형식 오류를 먼저 수정하세요.");
    return;
  }
  document.getElementById("peer-delete-title")!.textContent =
    section().type === "Peer"
      ? "피어를 삭제할까요?"
      : "인터페이스를 삭제할까요?";
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
};
$<HTMLButtonElement>("#peer-profile-connect").onclick = async () => {
  const source = doc(),
    peer = section(),
    sourceText = source.text;
  const target = documents.find(
    (d) => d.id === Number($<HTMLSelectElement>("#peer-profile-select").value),
  );
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
      throw new Error("연결할 프로필에는 Interface 섹션이 하나 있어야 합니다.");
    const iface = interfaces[0];
    const fields = iface.fields.filter((f) => f.key === "PrivateKey");
    if (fields.length > 1)
      throw new Error("상대 프로필의 중복 PrivateKey 필드를 확인하세요.");
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
        "키가 올바르지 않은 것 같습니다. 새 키를 생성해 연결하시겠습니까?",
        `${target.name} 프로필의 개인키를 새로 생성하고, 해당 공개키를 이 피어에 적용합니다.`,
        "생성 후 연결",
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
      throw new Error("설정이 변경되었습니다. 다시 연결하세요.");
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
    status.textContent = `${target.name} 프로필과 연결했습니다. 역방향 피어 설정도 확인하세요.`;
  } catch (error) {
    status.textContent = `연결하지 못했습니다: ${errorMessage(error)}`;
  } finally {
    button.disabled = !$<HTMLSelectElement>("#peer-profile-select").value;
  }
};
$("#copy").onclick = () => copyText(doc().text);
$("#validation-toggle").onclick = () => {
  showIssues = !showIssues;
  renderValidation();
};
document
  .getElementById("theme")
  ?.addEventListener("click", () => document.body.classList.toggle("dark"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeViewMenu();
    document.getElementById("edit-options")!.hidden = true;
    document
      .getElementById("edit-menu")!
      .setAttribute("aria-expanded", "false");
    $("#file-options").hidden = true;
    $("#file-menu").setAttribute("aria-expanded", "false");
  }
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
  const grid = dotGrid(camera);
  // Layout zoom repaints text and SVG at the actual display resolution instead
  // of magnifying a cached composited layer with transform: scale().
  $("#canvas-world").style.left = `${camera.x}px`;
  $("#canvas-world").style.top = `${camera.y}px`;
  $("#canvas-content").style.zoom = String(camera.scale);
  $("#canvas").style.backgroundSize = `${grid.spacing}px ${grid.spacing}px`;
  $("#canvas").style.backgroundPosition = `${grid.x}px ${grid.y}px`;
  $("#zoom-reset").textContent = `${Math.round(camera.scale * 100)}%`;
  for (const badge of $("#connections").querySelectorAll<SVGElement>(
    ".edge-warning",
  )) {
    badge.setAttribute(
      "transform",
      `translate(${data(badge, "midX")} ${data(badge, "midY")}) scale(${1 / camera.scale})`,
    );
  }
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
  type Entry = {
    publicKey: string;
    privateKeys: Set<string>;
    privateUses: string[];
    publicUses: string[];
    invalid?: boolean;
  };
  const entries = new Map<string, Entry>();
  const entry = (key: string): Entry => {
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
  document.getElementById("key-pair-count")!.textContent = `${entries.size}개`;
  document.getElementById("dummy-key-controls")!.innerHTML =
    `<div class="keys-section-heading"><h3>더미키로 연결</h3><span class="keys-tag">연결 표시용</span></div><p class="dummy-description">실제 키를 입력하지 않고 관계를 표현합니다. WireGuard에서 사용하기 전 실제 키로 바꿔주세요.</p><div class="dummy-key-list">${snapshot
      .map((d) => {
        const dummyKey = `dummy:${d.internalId.slice(0, 7)}`;
        const applied = d.model.sections.some(
          (s) =>
            s.type === "Interface" &&
            s.fields.some(
              (f) => f.key === "PrivateKey" && f.value === dummyKey,
            ),
        );
        return `<div class="dummy-key-row"><span class="dummy-file-icon" aria-hidden="true">▤</span><div class="dummy-profile"><strong>${esc(d.name)}</strong><code tabindex="0" data-tooltip="${esc(d.internalId)}">${esc(d.internalId.slice(0, 7) || "준비 중")}</code></div><button class="dummy-apply ${applied ? "is-applied" : ""}" data-dummy-key="${d.id}" ${!d.internalId || d.error || applied ? "disabled" : ""}>${applied ? "✓ 적용됨" : "적용하기"}</button></div>`;
      })
      .join("")}</div>`;
  const uses = (locations: string[]) =>
    locations.length
      ? `<ul class="key-usage-list">${locations.map((location) => `<li><span aria-hidden="true">↳</span>${esc(location)}</li>`).join("")}</ul>`
      : '<p class="key-no-usage">이 필드를 사용하는 열린 설정이 없습니다.</p>';
  root.innerHTML =
    `<div class="keys-section-heading"><h3>사용 중인 키</h3><span class="keys-section-meta">공개키 기준으로 묶음</span></div>` +
    ([...entries.values()]
      .map((item, index) => {
        const dummy = item.publicKey.startsWith("dummy:");
        const title = item.invalid
          ? "확인이 필요한 키"
          : dummy
            ? "더미 키 쌍"
            : item.privateKeys.size
              ? "키 쌍"
              : "공개키만 있음";
        const kind = item.invalid
          ? "확인 필요"
          : dummy
            ? "더미"
            : item.privateKeys.size
              ? "X25519"
              : "상대 키";
        return `<article class="key-pair ${dummy ? "is-dummy" : ""}"><div class="key-pair-heading"><span class="key-pair-symbol" aria-hidden="true">${dummy ? "⇄" : "⌘"}</span><h4>${title} <span class="key-pair-number">${String(index + 1).padStart(2, "0")}</span></h4><span class="keys-tag">${kind}</span></div><div class="key-detail"><label>공개키 <span>PUBLIC KEY</span><input readonly aria-label="공개키" value="${esc(item.invalid ? "계산할 수 없음" : item.publicKey)}" spellcheck="false"></label><div class="key-usage-heading">사용 위치 <span>${item.publicUses.length}</span></div>${uses(item.publicUses)}</div><div class="key-detail"><label>개인키 <span>PRIVATE KEY</span>${[...item.privateKeys].map((key) => `<input readonly aria-label="개인키" value="${esc(key)}" spellcheck="false">`).join("") || '<span class="key-missing">열린 설정에 개인키 없음</span>'}</label><div class="key-usage-heading">사용 위치 <span>${item.privateUses.length}</span></div>${uses(item.privateUses)}</div></article>`;
      })
      .join("") ||
      '<div class="keys-empty"><span aria-hidden="true">⌘</span><strong>아직 키가 없습니다</strong><p>설정에서 키를 생성하거나 더미키를 적용해보세요.</p></div>');
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
      toast("Interface 섹션을 먼저 추가하세요.");
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
          "개인키를 더미키로 바꾸시겠습니까?",
          "현재 개인키를 바꾸며, 기존 실제 공개키를 사용하는 피어 연결은 해제될 수 있습니다.",
          "더미키 적용",
        ))
      )
        return;
    }
    if (!documents.includes(target) || target.text !== text) {
      toast("설정이 변경되었습니다. 다시 시도하세요.");
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
    toast(`${target.name}에 ${key} 적용됨`);
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
  const container = $("#canvas-cards");
  for (const el of container.querySelectorAll<HTMLElement>("[data-document]"))
    if (!documents.some((d) => d.id === +data(el, "document"))) el.remove();
  for (const d of documents) {
    try {
      parse(d.text);
      d.error = "";
    } catch (error) {
      d.error = errorMessage(error);
    }
    let card = container.querySelector<HTMLElement>(
      `[data-document="${d.id}"]`,
    );
    if (!card) {
      card = document.createElement("article");
      card.className = "config-card";
      card.dataset.document = String(d.id);
      card.setAttribute("aria-label", `${d.name} 설정 카드`);
      card.innerHTML = `<div class="card-heading" data-drag="${d.id}"><span class="card-grip">⠿</span><div class="card-name"></div><button class="text-button" data-edit="${d.id}" aria-label="설정 편집">편집 ↗</button></div><div class="card-identity"></div><div class="card-peers"></div><div class="card-code-label"><span>CONFIG SOURCE</span><span>직접 편집 가능</span></div><textarea class="canvas-source" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea><div class="card-footer"></div>`;
      container.append(card);
    }
    card.classList.toggle("selected", d.id === active);
    card.classList.toggle("has-error", !!d.error);
    card.style.left = `${d.x}px`;
    card.style.top = `${d.y}px`;
    card.setAttribute("aria-label", `${d.name} 설정 카드`);
    card.querySelector(".card-name")!.innerHTML =
      `<strong>${esc(d.name)}</strong><small>${dirty(d) ? "● 저장하지 않음" : "저장됨"} · ${d.model.sections.filter((s) => s.type === "Peer").length} peers</small>`;
    const address =
      d.model.sections
        .find((s) => s.type === "Interface")
        ?.fields.find((f) => f.key === "Address")?.value || "주소 미설정";
    card.querySelector(".card-identity")!.innerHTML =
      `<span class="identity-icon">⌘</span><div><strong>Interface</strong><small>${esc(address)}</small></div><span class="identity-port" data-tooltip="개인키에서 계산된 공개키의 연결 지점"></span>`;
    const peers = d.model.sections.filter((s) => s.type === "Peer");
    card.querySelector(".card-peers")!.innerHTML = peers.length
      ? peers
          .map(
            (p, i) =>
              `<span class="peer-chip" data-tooltip="${esc(p.fields.find((f) => f.key === "PublicKey")?.value || "공개키 미입력")}">⇄ Peer ${i + 1}</span>`,
          )
          .join("")
      : '<span class="empty-peers">아직 피어가 없습니다</span>';
    const input = card.querySelector<HTMLTextAreaElement>(".canvas-source")!;
    input.setAttribute("aria-label", `${d.name} 설정 원문`);
    if (input.value !== d.text) input.value = d.text;
    const issues = d.error ? [d.error] : validate(d.model);
    card.querySelector(".card-footer")!.innerHTML =
      `<span class="${issues.length ? "needs-check" : "valid"}"${issues.length ? ` tabindex="0" data-tooltip="${esc(issues.map((issue) => `• ${issue}`).join("\n"))}" aria-label="${esc(`${issues.length}개 항목 확인: ${issues.join("; ")}`)}"` : ""}>${issues.length ? `◌ ${issues.length}개 항목 확인` : "✓ 설정 형식 확인됨"}</span><button class="text-button" data-card-save="${d.id}">↓ 저장</button>`;
  }
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
  const byId = new Map(documents.map((d) => [d.id, d]));
  $("#connections").innerHTML =
    `<defs><marker id="key-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="currentColor" stroke-width="1.5"/></marker></defs>` +
    canvasEdges
      .map((edge) => {
        const from = byId.get(edge.source)!,
          to = byId.get(edge.target)!,
          line = edgeCurve(from, to, Math.min(edge.peer - 1, 6) * 12);
        const warning = !hasReverseConnection(edge, canvasEdges)
          ? `주의: ${from.name}에서 ${to.name}로의 통신이 설정되었지만, 그 역방향은 설정되지 않았습니다. 일반적으로는 통신이 수립되지 않을 가능성이 높으므로, 확인이 필요합니다.`
          : "";
        const badge = warning
          ? `<g class="edge-warning" data-tooltip="${esc(warning)}" data-mid-x="${line.midX}" data-mid-y="${line.midY}" transform="translate(${line.midX} ${line.midY}) scale(${1 / camera.scale})"><circle r="11"/><text text-anchor="middle" dominant-baseline="central" aria-hidden="true">!</text></g>`
          : "";
        return `<g data-tooltip="${esc(from.name)} · Peer ${edge.peer} → ${esc(to.name)} · Interface (공개키 일치)${warning ? `. ${esc(warning)}` : ""}" class="key-edge ${edge.source === active || edge.target === active ? "highlighted" : ""}" data-edge-source="${edge.source}" data-edge-section="${edge.section}" data-edge-target="${edge.target}" role="button" tabindex="0" aria-label="${esc(from.name)} Peer ${edge.peer}에서 ${esc(to.name)} Interface로 연결${warning ? `. ${esc(warning)}` : ""}"><path class="edge-hit" d="${line.path}"/><path class="edge-line" d="${line.path}" marker-end="url(#key-arrow)"/><circle cx="${line.x1}" cy="${line.y1}" r="5"/><circle cx="${line.x2}" cy="${line.y2}" r="5"/>${badge}</g>`;
      })
      .join("");
  const summary = document.getElementById("canvas-summary");
  if (summary)
    summary.textContent = `설정 ${documents.length}개 · 키 연결 ${canvasEdges.length}개`;
}
function redrawConnections() {
  const byId = new Map(documents.map((d) => [d.id, d]));
  for (const el of $("#connections").querySelectorAll<SVGElement>(
    "[data-edge-source]",
  )) {
    const edge = canvasEdges.find(
      (e) =>
        e.source === +data(el, "edgeSource") &&
        e.section === +data(el, "edgeSection") &&
        e.target === +data(el, "edgeTarget"),
    );
    if (!edge) continue;
    const line = edgeCurve(
      byId.get(edge.source)!,
      byId.get(edge.target)!,
      Math.min(edge.peer - 1, 6) * 12,
    );
    el.querySelectorAll("path").forEach((p) => p.setAttribute("d", line.path));
    const circles = el.querySelectorAll("circle");
    circles[0].setAttribute("cx", String(line.x1));
    circles[0].setAttribute("cy", String(line.y1));
    circles[1].setAttribute("cx", String(line.x2));
    circles[1].setAttribute("cy", String(line.y2));
    const badge = el.querySelector<SVGElement>(".edge-warning");
    if (badge) {
      badge.dataset.midX = String(line.midX);
      badge.dataset.midY = String(line.midY);
      badge.setAttribute(
        "transform",
        `translate(${line.midX} ${line.midY}) scale(${1 / camera.scale})`,
      );
    }
  }
}
function initializeCanvas() {
  const canvas = $("#canvas"),
    touches = new Map<number, Point>();
  $("#close-inspector").onclick = () => {
    panel.close();
  };
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
  $("#pan-mode").onclick = () => {
    panMode = !panMode;
    $("#pan-mode").setAttribute("aria-pressed", String(panMode));
    canvas.classList.toggle("pan-mode", panMode);
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
      panMode ||
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
      $("#batch-error").textContent = "1~20개의 설정을 생성할 수 있습니다.";
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
      toast(`${count}개의 설정을 만들었습니다.`);
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
    toast("먼저 두 개 이상의 설정을 열거나 생성하세요.");
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
    $("#connect-error").textContent = "연결할 설정을 찾을 수 없습니다.";
    return;
  }
  if (source === target) {
    $("#connect-error").textContent = "서로 다른 설정을 선택하세요.";
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
      throw new Error("설정이 변경되었습니다. 다시 시도하세요.");
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
      const p = newPeer();
      p.fields.find((f) => f.key === "PublicKey")!.value = publicKey;
      const iface = remote.sections.find((s) => s.type === "Interface"),
        address = iface?.fields.find((f) => f.key === "Address")?.value;
      p.fields.find((f) => f.key === "AllowedIPs")!.value = splitList(
        address || "",
      )
        .map((cidr) => {
          const ip = cidr.split("/")[0];
          return `${ip}/${ip.includes(":") ? "128" : "32"}`;
        })
        .join(", ");
      // A local interface address does not imply a reachable public Endpoint.
      p.fields = p.fields.filter((f) => f.key !== "Endpoint");
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
        ? `${count}개 피어를 추가했습니다. Endpoint는 편집 패널에서 설정하세요.`
        : "이미 같은 공개키의 피어가 있습니다.",
    );
  } catch (error) {
    $("#connect-error").textContent =
      `연결할 설정의 개인키를 확인하세요. ${errorMessage(error)}`;
  } finally {
    button.disabled = false;
  }
}
