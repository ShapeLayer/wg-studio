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
        `${index + 1}번째 줄: [Interface]/[Peer] 또는 Key = Value 형식을 확인하세요.`,
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
    throw new Error("[Interface] 또는 [Peer] 섹션이 필요합니다.");
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
      { key: "AllowedIPs", value: "10.0.0.2/32" },
      { key: "Endpoint", value: "" },
      { key: "PersistentKeepalive", value: "25" },
    ],
  } satisfies ConfigSection;
}
export function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error("키는 32바이트 Base64 형식이어야 합니다.");
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== 32 || encodeKey(bytes) !== value)
    throw new Error("유효한 Base64 키가 아닙니다.");
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
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array([...prefix, ...bytes]),
      "X25519",
      true,
      ["deriveBits"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (!jwk.x) throw new Error("X25519 공개키를 추출할 수 없습니다.");
    return jwk.x.replaceAll("-", "+").replaceAll("_", "/") + "=";
  } catch {
    throw new Error(
      "이 브라우저는 X25519 키 계산을 지원하지 않습니다. 최신 Chrome, Firefox 또는 Safari에서 HTTPS/localhost로 열어주세요.",
    );
  }
}
export function validate(model: ConfigModel): string[] {
  const issues: string[] = [];
  const ifaces = model.sections.filter((s) => s.type === "Interface");
  if (ifaces.length !== 1)
    issues.push("Interface 섹션은 정확히 하나여야 합니다.");
  model.sections.forEach((s, i) => {
    const required = s.type === "Interface" ? "PrivateKey" : "PublicKey";
    if (!s.fields.some((f) => f.key === required && f.value))
      issues.push(`${s.type} ${i + 1}: ${required}가 비어 있습니다.`);
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
          issues.push(`${s.type}: ${f.key} 중복 필드`);
        seen.add(f.key);
        if (!keys[s.type].includes(f.key))
          issues.push(`${s.type}: ${f.key}는 표준 필드가 아닙니다.`);
        if (/Key$/.test(f.key) && f.value) {
          try {
            if (/^dummy:[a-f0-9]{7}$/.test(f.value))
              issues.push(
                `${f.key}: 더미키는 연결 표시용입니다. 실제 사용 전에 실제 키로 바꾸세요.`,
              );
            else decodeKey(f.value);
          } catch {
            issues.push(`${f.key}: 32바이트 Base64 키를 입력하세요.`);
          }
        }
        if (
          ["ListenPort", "PersistentKeepalive", "MTU"].includes(f.key) &&
          f.value &&
          (!/^\d+$/.test(f.value) || +f.value > 65535)
        )
          issues.push(`${f.key}: 0–65535 범위의 정수가 필요합니다.`);
        if (["AllowedIPs", "Address"].includes(f.key))
          for (const ip of splitList(f.value))
            if (!validCIDR(ip))
              issues.push(`${f.key}: ${ip}의 CIDR 형식을 확인하세요.`);
      });
  });
  return issues;
}
function validCIDR(text: string): boolean {
  const [ip, prefix, ...extra] = text.split("/");
  if (extra.length || prefix === undefined || !/^\d+$/.test(prefix))
    return false;
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
