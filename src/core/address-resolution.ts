import type { AddressValidationDocument } from "./address-validation.ts";
import type { PeerConnectionContext } from "./address-conflicts.ts";
import type { KeyConnection, ConfigModel } from "./types.ts";
import type { Network } from "./ip-address.ts";
import { parseCIDR, formatAddress } from "./ip-address.ts";
import { serialize } from "./wireguard.ts";

type Document = AddressValidationDocument;
export interface AddressSuggestion {
  address: string;
  kind: "reserved" | "range" | "free";
  sources: number[];
}
const contains = (pool: Network, host: Network) =>
  pool.family === host.family &&
  host.value >= pool.start &&
  host.value <= pool.end;
const validHost = (host: Network, pool: Network) =>
  contains(pool, host) &&
  !(
    pool.family === 4 &&
    pool.prefix < 31 &&
    (host.value === pool.start || host.value === pool.end)
  );
function ranges(model: ConfigModel, key: string) {
  return model.sections
    .filter((s) => s.type === (key === "Address" ? "Interface" : "Peer"))
    .flatMap((s) =>
      s.fields
        .filter((f) => f.key === key)
        .flatMap((f) => (f.value || "").split(",").map(parseCIDR)),
    )
    .filter((p): p is Network => !!p);
}
export function connectionContextValid(
  documents: readonly Document[],
  edges: readonly KeyConnection[],
  context?: PeerConnectionContext,
): context is PeerConnectionContext {
  if (
    !context ||
    !edges.some(
      (e) =>
        e.source === context.source &&
        e.target === context.target &&
        e.section === context.section,
    )
  )
    return false;
  const source = documents.find((d) => d.id === context.source && !d.error),
    target = documents.find((d) => d.id === context.target && !d.error);
  return (
    !!source &&
    !!target &&
    (!context.sourceText || context.sourceText === serialize(source.model)) &&
    (!context.targetText || context.targetText === serialize(target.model))
  );
}
export function ambiguousAddressOwner(
  edges: readonly KeyConnection[],
  owner: number,
): boolean {
  return edges.some(
    (e) =>
      e.target === owner &&
      edges.some(
        (other) =>
          other.source === e.source &&
          other.section === e.section &&
          other.target !== owner,
      ),
  );
}
/** Incoming keys identify ownership independently of how the graph was edited. */
export function addressSuggestions(
  documents: readonly Document[],
  edges: readonly KeyConnection[],
  owner: number,
  oldIP: string,
  context?: PeerConnectionContext,
): { options: AddressSuggestion[]; initial: string; ambiguous: boolean } {
  const target = documents.find((d) => d.id === owner && !d.error),
    old = parseCIDR(oldIP);
  if (!target || !old || ambiguousAddressOwner(edges, owner))
    return { options: [], initial: "", ambiguous: true };
  const localPools = ranges(target.model, "Address").filter(
    (p) => p.family === old.family && p.value === old.value,
  );
  const incoming = edges.filter(
    (e) =>
      e.target === owner &&
      documents.some((d) => d.id === e.source && !d.error),
  );
  const explicit =
    connectionContextValid(documents, edges, context) &&
    context.target === owner
      ? context
      : undefined;
  incoming.sort(
    (a, b) =>
      Number(
        !!explicit &&
          b.source === explicit.source &&
          b.section === explicit.section,
      ) -
      Number(
        !!explicit &&
          a.source === explicit.source &&
          a.section === explicit.section,
      ),
  );
  const options: AddressSuggestion[] = [];
  const sourcePools = incoming
    .flatMap((e) =>
      ranges(documents.find((d) => d.id === e.source)!.model, "Address"),
    )
    .filter((p) => p.family === old.family && p.prefix > 0);
  const maskFor = (host: Network, route?: Network) =>
    localPools.find((p) => validHost(host, p)) ??
    sourcePools
      .filter((p) => validHost(host, p))
      .sort((a, b) => b.prefix - a.prefix)[0] ??
    route ??
    host;
  const blocked = (pool: Network) =>
    documents
      .filter((d) => !d.error)
      .flatMap((d) =>
        d.model.sections.flatMap((s, index) => {
          const local = s.type === "Interface";
          if (
            !local &&
            incoming.some((e) => e.source === d.id && e.section === index)
          )
            return [];
          return s.fields
            .filter((f) => f.key === (local ? "Address" : "AllowedIPs"))
            .flatMap((f) => (f.value || "").split(",").map(parseCIDR))
            .filter(
              (p): p is Network =>
                !!p &&
                p.family === pool.family &&
                (local || (p.prefix >= pool.prefix && p.prefix > 0)),
            )
            .map((p) => ({
              start: local ? p.value : p.start,
              end: local ? p.value : p.end,
            }));
        }),
      );
  const add = (
    host: Network,
    kind: AddressSuggestion["kind"],
    sources: number[],
    route?: Network,
  ) => {
    if (host.value === old.value || host.family !== old.family) return;
    const pool = maskFor(host, route);
    if (
      !validHost(host, pool) ||
      blocked(pool).some((r) => host.value >= r.start && host.value <= r.end)
    )
      return;
    const address = `${formatAddress(host.value, host.family)}/${pool.prefix}`;
    const existing = options.find(
      (o) => parseCIDR(o.address)?.value === host.value,
    );
    if (existing) {
      existing.sources = [...new Set([...existing.sources, ...sources])];
      return;
    }
    options.push({ address, kind, sources });
  };
  const freeIn = (pool: Network) => {
    if (!pool.prefix) return;
    let value = pool.start + (pool.prefix < pool.bits - 1 ? 1n : 0n);
    const end = pool.end - (pool.family === 4 && pool.prefix < 31 ? 1n : 0n);
    for (const r of blocked(pool).sort((a, b) =>
      a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
    )) {
      if (r.start > value) break;
      if (r.end >= value) value = r.end + 1n;
    }
    return value <= end
      ? parseCIDR(`${formatAddress(value, pool.family)}/${pool.prefix}`)
      : undefined;
  };
  // Exact host reservations are stronger evidence than routed subnets.
  for (const e of incoming) {
    const peer = documents.find((d) => d.id === e.source)!.model.sections[
      e.section
    ];
    if (peer?.type !== "Peer") continue;
    for (const f of peer.fields.filter((f) => f.key === "AllowedIPs"))
      for (const text of (f.value || "").split(",")) {
        const host = parseCIDR(text);
        if (host && host.family === old.family && host.prefix === host.bits)
          add(host, "reserved", [e.source]);
      }
  }
  const reserved = options.filter((o) => o.kind === "reserved");
  const prioritized = explicit
    ? reserved.filter(
        (o) =>
          o.sources.includes(explicit.source) &&
          documents
            .find((d) => d.id === explicit.source)!
            .model.sections[explicit.section]?.fields.some(
              (f) =>
                f.key === "AllowedIPs" &&
                (f.value || "").split(",").some((v) => {
                  const p = parseCIDR(v);
                  return (
                    p?.prefix === p?.bits &&
                    p?.family === old.family &&
                    p?.value === parseCIDR(o.address)?.value
                  );
                }),
            ),
      )
    : [];
  for (const e of incoming) {
    const peer = documents.find((d) => d.id === e.source)!.model.sections[
      e.section
    ];
    if (peer?.type !== "Peer") continue;
    for (const f of peer.fields.filter((f) => f.key === "AllowedIPs"))
      for (const text of (f.value || "").split(",")) {
        const route = parseCIDR(text);
        if (
          !route ||
          route.family !== old.family ||
          !route.prefix ||
          route.prefix === route.bits
        )
          continue;
        const free = freeIn(route);
        if (free) add(free, "range", [e.source], route);
      }
  }
  for (const pool of [...localPools, ...sourcePools]) {
    const free = freeIn(pool);
    if (free) add(free, "free", [], pool);
  }
  const ambiguous =
    prioritized.length > 1 || (!prioritized.length && reserved.length > 1);
  const initial =
    prioritized.length === 1
      ? prioritized[0].address
      : reserved.length === 1
        ? reserved[0].address
        : !reserved.length && !options.some((o) => o.kind === "range")
          ? options.find((o) => o.kind === "free")?.address || ""
          : "";
  return { options, initial, ambiguous };
}
