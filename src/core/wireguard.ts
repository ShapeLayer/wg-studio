import { validateAddressAssignments } from "./address-validation.ts";
import { t } from "../i18n/index.ts";
import type { ConfigModel, ConfigSection, SectionType } from "./types.ts";
export const keys: Record<SectionType, string[]> = {
  Interface: [
    "PrivateKey",
    "Address",
    "ListenPort",
    "DNS",
    "MTU",
    "Table",
    "FwMark",
    "SaveConfig",
    "PreUp",
    "PostUp",
    "PreDown",
    "PostDown",
  ],
  Peer: [
    "PublicKey",
    "PresharedKey",
    "AllowedIPs",
    "Endpoint",
    "PersistentKeepalive",
  ],
};
export const listKeys = ["Address", "DNS", "AllowedIPs"];
export const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export function parse(text: string): ConfigModel {
  const sections: ConfigSection[] = [];
  const preamble: { raw: string }[] = [];
  let current: ConfigSection | undefined;
  for (const [index, line] of text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .entries()) {
    const header = line.trim().match(/^\[(Interface|Peer)\]\s*(?:#.*)?$/i);
    if (header) {
      current = {
        type: header[1].toLowerCase() === "peer" ? "Peer" : "Interface",
        header: line,
        fields: [],
      };
      sections.push(current);
      continue;
    }
    if (!line.trim() || /^\s*[#;]/.test(line)) {
      (current ? current.fields : preamble).push({ raw: line });
      continue;
    }
    const field = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/);
    if (!current || !field)
      throw new Error(
        t("lineExpectedInterfacePeerOrKeyValue", { v0: index + 1 }),
      );
    const hash = field[2].indexOf("#");
    const name =
      keys[current.type].find(
        (k) => k.toLowerCase() === field[1].toLowerCase(),
      ) || field[1];
    current.fields.push({
      key: name,
      value: (hash < 0 ? field[2] : field[2].slice(0, hash)).trim(),
      comment: hash < 0 ? "" : field[2].slice(hash),
      original: line,
    });
  }
  if (!sections.length)
    throw new Error(t("anInterfaceOrPeerSectionIsRequired"));
  return { preamble, sections };
}
export function serialize(model: ConfigModel): string {
  return [
    ...model.preamble.map((x) => x.raw),
    ...model.sections.flatMap((s) => [
      s.header || `[${s.type}]`,
      ...s.fields.map((f) =>
        f.raw !== undefined
          ? f.raw
          : (f.original ??
            `${f.key} = ${f.value}${f.comment ? " " + f.comment : ""}`),
      ),
    ]),
  ].join("\n");
}
export function newConfig(): ConfigModel {
  return {
    preamble: [],
    sections: [
      {
        type: "Interface",
        fields: [
          { key: "PrivateKey", value: "" },
          { key: "Address", value: "10.0.0.1/24" },
          { key: "ListenPort", value: "51820" },
          { key: "DNS", value: "1.1.1.1" },
        ],
      },
    ],
  } satisfies ConfigModel;
}
export function newPeer() {
  return {
    type: "Peer",
    fields: [
      { key: "PublicKey", value: "" },
      { key: "AllowedIPs", value: "" },
      { key: "PersistentKeepalive", value: "25" },
    ],
  } satisfies ConfigSection;
}
export function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error(t("keysMustBe32ByteBase64Values"));
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== 32 || encodeKey(bytes) !== value)
    throw new Error(t("invalidBase64Key"));
  return bytes;
}
export const encodeKey = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));
export function generatePrivateKey() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  b[0] &= 248;
  b[31] = (b[31] & 127) | 64;
  return encodeKey(b);
}
export const generatePresharedKey = () =>
  encodeKey(crypto.getRandomValues(new Uint8Array(32)));
export async function publicFromPrivate(value: string): Promise<string> {
  const bytes = decodeKey(value);
  const prefix = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
    0x04, 0x22, 0x04, 0x20,
  ];
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array([...prefix, ...bytes]),
      "X25519",
      true,
      ["deriveBits"],
    );
  } catch (error) {
    // Only a missing algorithm means the browser lacks X25519; other failures
    // are reported as key problems instead of a misleading support message.
    if (
      !globalThis.crypto?.subtle ||
      (error instanceof DOMException && error.name === "NotSupportedError")
    )
      throw new Error(t("thisBrowserDoesNotSupportX25519KeyDerivationUse"));
    throw new Error(t("invalidBase64Key"));
  }
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.x) throw new Error(t("couldNotExtractTheX25519PublicKey"));
  return jwk.x.replaceAll("-", "+").replaceAll("_", "/") + "=";
}
export function validate(model: ConfigModel): string[] {
  const issues: string[] = [];
  const ifaces = model.sections.filter((s) => s.type === "Interface");
  if (ifaces.length !== 1)
    issues.push(t("exactlyOneInterfaceSectionIsRequired"));
  model.sections.forEach((s, i) => {
    const required = s.type === "Interface" ? "PrivateKey" : "PublicKey";
    if (!s.fields.some((f) => f.key === required && f.value))
      issues.push(t("isEmpty", { v0: s.type, v1: i + 1, v2: required }));
    const seen = new Set();
    s.fields
      .filter((f) => f.key !== undefined)
      .forEach((f) => {
        if (
          seen.has(f.key) &&
          ![
            "PreUp",
            "PostUp",
            "PreDown",
            "PostDown",
            "Address",
            "DNS",
            "AllowedIPs",
          ].includes(f.key)
        )
          issues.push(t("duplicateField", { v0: s.type, v1: f.key }));
        seen.add(f.key);
        if (!keys[s.type].includes(f.key))
          issues.push(t("isNotAStandardField", { v0: s.type, v1: f.key }));
        if (/Key$/.test(f.key) && f.value) {
          try {
            if (/^dummy:[a-f0-9]{7}$/.test(f.value))
              issues.push(
                t("dummyKeysOnlyShowConnectionsReplaceThemWithReal", {
                  v0: f.key,
                }),
              );
            else decodeKey(f.value);
          } catch {
            issues.push(t("enterA32ByteBase64Key", { v0: f.key }));
          }
        }
        if (
          ["ListenPort", "PersistentKeepalive", "MTU"].includes(f.key) &&
          f.value &&
          (!/^\d+$/.test(f.value) || +f.value > 65535)
        )
          issues.push(t("anIntegerBetween0And65535IsRequired", { v0: f.key }));
        if (["AllowedIPs", "Address"].includes(f.key))
          for (const ip of splitList(f.value))
            if (!validCIDR(ip))
              issues.push(t("checkTheCidrFormatOf", { v0: f.key, v1: ip }));
      });
  });
  return [...issues, ...validateAddressAssignments(model)];
}
function validCIDR(text: string): boolean {
  // wg and wg-quick treat a missing prefix as a single host (/32 or /128).
  const [ip, rawPrefix, ...extra] = text.split("/");
  const prefix = rawPrefix ?? (ip.includes(":") ? "128" : "32");
  if (extra.length || !/^\d+$/.test(prefix)) return false;
  if (ip.includes(":")) {
    if (+prefix > 128) return false;
    try {
      return new URL(`http://[${ip}]/`).hostname.length > 0;
    } catch {
      return false;
    }
  }
  return (
    +prefix <= 32 &&
    ip.split(".").length === 4 &&
    ip.split(".").every((n) => /^\d{1,3}$/.test(n) && +n <= 255)
  );
}
