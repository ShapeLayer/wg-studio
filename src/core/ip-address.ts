export type Family = 4 | 6;
export interface Network {
  family: Family;
  bits: number;
  prefix: number;
  value: bigint;
  start: bigint;
  end: bigint;
}

function ipv4(text: string): bigint | undefined {
  const parts = text.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || +part > 255)
  )
    return;
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}
function ipv6(text: string): bigint | undefined {
  if (text.includes(".")) {
    const index = text.lastIndexOf(":");
    const tail = ipv4(text.slice(index + 1));
    if (tail === undefined) return;
    text =
      text.slice(0, index + 1) +
      (tail >> 16n).toString(16) +
      ":" +
      (tail & 65535n).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const count = left.length + right.length;
  if (
    (halves.length === 1 && count !== 8) ||
    (halves.length === 2 && count >= 8)
  )
    return;
  const words = [...left, ...Array<string>(8 - count).fill("0"), ...right];
  if (words.some((word) => !/^[a-f\d]{1,4}$/i.test(word))) return;
  return words.reduce(
    (value, word) => (value << 16n) | BigInt("0x" + word),
    0n,
  );
}
export function parseCIDR(text: string): Network | undefined {
  const [ip, rawPrefix, ...extra] = text.trim().split("/");
  const family: Family = ip.includes(":") ? 6 : 4;
  const bits = family === 4 ? 32 : 128;
  if (extra.length || (rawPrefix !== undefined && !/^\d+$/.test(rawPrefix)))
    return;
  const prefix = rawPrefix === undefined ? bits : Number(rawPrefix);
  if (prefix > bits) return;
  const value = family === 4 ? ipv4(ip) : ipv6(ip);
  if (value === undefined) return;
  const size = 1n << BigInt(bits - prefix);
  const start = (value / size) * size;
  return { family, bits, prefix, value, start, end: start + size - 1n };
}
export function formatAddress(value: bigint, family: Family): string {
  if (family === 4)
    return [24n, 16n, 8n, 0n]
      .map((shift) => String((value >> shift) & 255n))
      .join(".");
  const words = Array.from({ length: 8 }, (_, i) =>
    ((value >> BigInt((7 - i) * 16)) & 65535n).toString(16),
  );
  let bestStart = -1,
    bestLength = 1;
  for (let i = 0; i < words.length;) {
    if (words[i] !== "0") {
      i++;
      continue;
    }
    const start = i;
    while (i < words.length && words[i] === "0") i++;
    if (i - start > bestLength) {
      bestStart = start;
      bestLength = i - start;
    }
  }
  if (bestStart < 0) return words.join(":");
  return (
    words.slice(0, bestStart).join(":") +
    "::" +
    words.slice(bestStart + bestLength).join(":")
  );
}
