import { parseCIDR, formatAddress } from "./ip-address.ts";
import type { Family, Network } from "./ip-address.ts";
import { t } from "../i18n/index.ts";
import { splitList } from "./wireguard.ts";
import type { ConfigModel } from "./types.ts";

interface Reservation {
  family: Family;
  start: bigint;
  end: bigint;
}
export interface PeerAddressAssignment {
  address: string;
  allowedIP: string;
}

/** Reserve interface hosts and peer routes, then skip blocked CIDR ranges without enumerating them. */
export function allocatePeerAddresses(
  source: ConfigModel,
  others: readonly ConfigModel[] = [],
  excludePeer?: number,
): PeerAddressAssignment[] {
  const interfaces = source.sections.filter(
    (section) => section.type === "Interface",
  );
  if (interfaces.length !== 1)
    throw new Error(t("sourceProfileNeedsOneInterface"));
  const addresses = interfaces[0].fields
    .filter((field) => field.key === "Address")
    .flatMap((field) => splitList(field.value || ""));
  if (!addresses.length)
    throw new Error(t("interfaceAddressRequiredForAllocation"));
  const pools = addresses.map((address) => {
    const pool = parseCIDR(address);
    if (!pool || !address.includes("/"))
      throw new Error(t("invalidInterfaceAddressForAllocation", { address }));
    return pool;
  });
  const reservations: Reservation[] = [];
  for (const model of [source, ...others.filter((model) => model !== source)]) {
    model.sections.forEach((section, index) => {
      if (model === source && index === excludePeer && section.type === "Peer")
        return;
      const key = section.type === "Interface" ? "Address" : "AllowedIPs";
      for (const field of section.fields.filter((field) => field.key === key)) {
        for (const text of splitList(field.value || "")) {
          const range = parseCIDR(text);
          if (!range) continue;
          reservations.push({
            family: range.family,
            start: section.type === "Interface" ? range.value : range.start,
            end: section.type === "Interface" ? range.value : range.end,
          });
        }
      }
    });
  }
  const preferred =
    source.sections[excludePeer ?? -1]?.fields
      .filter((field) => field.key === "AllowedIPs")
      .flatMap((field) => splitList(field.value || ""))
      .map(parseCIDR)
      .filter(
        (value): value is Network => !!value && value.prefix === value.bits,
      ) || [];
  const seen = new Set<string>();
  const result: PeerAddressAssignment[] = [];
  for (const pool of pools) {
    const identity = `${pool.family}:${pool.start}/${pool.prefix}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const start = pool.start + (pool.prefix < pool.bits - 1 ? 1n : 0n);
    const end = pool.end - (pool.family === 4 && pool.prefix < 31 ? 1n : 0n);
    const blocked = reservations
      .filter((range) => range.family === pool.family)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const preference = preferred.find(
      (candidate) =>
        candidate.family === pool.family &&
        candidate.value >= start &&
        candidate.value <= end &&
        !blocked.some(
          (range) =>
            candidate.value >= range.start && candidate.value <= range.end,
        ),
    );
    let candidate = preference?.value ?? start;
    if (!preference)
      for (const range of blocked) {
        if (range.start > candidate) break;
        if (range.end >= candidate) candidate = range.end + 1n;
        if (candidate > end) break;
      }
    if (candidate > end)
      throw new Error(
        t("noAvailablePeerAddress", {
          network: `${formatAddress(pool.start, pool.family)}/${pool.prefix}`,
        }),
      );
    const ip = formatAddress(candidate, pool.family);
    result.push({
      address: `${ip}/${pool.prefix}`,
      allowedIP: `${ip}/${pool.bits}`,
    });
    reservations.push({
      family: pool.family,
      start: candidate,
      end: candidate,
    });
  }
  return result;
}

/**
 * Pick an unused Interface Address for a brand-new profile from `poolText`.
 * Every open Interface host is reserved, plus peer routes that sit inside the
 * pool; routes wider than the pool (for example 0.0.0.0/0 on a full-tunnel
 * client) say nothing about which hosts are taken, so they are ignored here.
 */
export function allocateInterfaceAddress(
  models: readonly ConfigModel[],
  poolText = "10.0.0.0/24",
): string {
  const pool = parseCIDR(poolText);
  if (!pool)
    throw new Error(
      t("invalidInterfaceAddressForAllocation", { address: poolText }),
    );
  const blocked: Reservation[] = [];
  for (const model of models)
    for (const section of model.sections) {
      const key = section.type === "Interface" ? "Address" : "AllowedIPs";
      for (const field of section.fields.filter((field) => field.key === key))
        for (const text of splitList(field.value || "")) {
          const range = parseCIDR(text);
          if (!range || range.family !== pool.family) continue;
          if (section.type === "Interface")
            blocked.push({
              family: range.family,
              start: range.value,
              end: range.value,
            });
          else if (
            range.start >= pool.start &&
            range.end <= pool.end &&
            range.prefix > pool.prefix
          )
            blocked.push({
              family: range.family,
              start: range.start,
              end: range.end,
            });
        }
    }
  blocked.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const end = pool.end - (pool.family === 4 && pool.prefix < 31 ? 1n : 0n);
  let candidate = pool.start + (pool.prefix < pool.bits - 1 ? 1n : 0n);
  for (const range of blocked) {
    if (range.start > candidate) break;
    if (range.end >= candidate) candidate = range.end + 1n;
  }
  if (candidate > end)
    throw new Error(
      t("noAvailablePeerAddress", {
        network: `${formatAddress(pool.start, pool.family)}/${pool.prefix}`,
      }),
    );
  return `${formatAddress(candidate, pool.family)}/${pool.prefix}`;
}
