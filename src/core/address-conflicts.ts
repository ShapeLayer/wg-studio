import {
  addressSuggestions,
  connectionContextValid,
  ambiguousAddressOwner,
} from "./address-resolution.ts";
import type { ConfigModel, KeyConnection } from "./types.ts";
import type { AddressValidationDocument } from "./address-validation.ts";
import { parseCIDR, formatAddress } from "./ip-address.ts";
import { parse, serialize } from "./wireguard.ts";
import { t } from "../i18n/index.ts";

export interface AddressConflict {
  id: string;
  first: number;
  second: number;
  address: string;
  connected: boolean;
}
export function addressConflicts(
  documents: readonly AddressValidationDocument[],
  edges: readonly KeyConnection[],
): AddressConflict[] {
  const neighbors = new Map<number, Set<number>>();
  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());
    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target);
    neighbors.get(e.target)!.add(e.source);
  }
  const reachable = (a: number, b: number) => {
    const seen = new Set([a]),
      queue = [a];
    for (const node of queue)
      for (const next of neighbors.get(node) || [])
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    return seen.has(b);
  };
  const hosts = (model: ConfigModel) =>
    model.sections
      .filter((s) => s.type === "Interface")
      .flatMap((s) =>
        s.fields
          .filter((f) => f.key === "Address")
          .flatMap((f) => (f.value || "").split(",").map(parseCIDR)),
      )
      .filter((v) => !!v);
  const result: AddressConflict[] = [],
    valid = documents.filter((d) => !d.error);
  for (let i = 0; i < valid.length; i++)
    for (const other of valid.slice(i + 1)) {
      const current = valid[i];
      for (const a of hosts(current.model))
        if (
          hosts(other.model).some(
            (b) => a.family === b.family && a.value === b.value,
          )
        ) {
          const address = formatAddress(a.value, a.family),
            id = `${Math.min(current.id, other.id)}:${Math.max(current.id, other.id)}:${address}`;
          if (!result.some((c) => c.id === id))
            result.push({
              id,
              first: current.id,
              second: other.id,
              address,
              connected: reachable(current.id, other.id),
            });
        }
    }
  return result;
}
export function conflictMessages(
  current: number,
  documents: readonly AddressValidationDocument[],
  conflicts: readonly AddressConflict[],
): string[] {
  return conflicts
    .filter((c) => c.first === current || c.second === current)
    .map((c) =>
      t(c.connected ? "connectedAddressConflict" : "separateAddressConflict", {
        first: documents.find((d) => d.id === c.first)?.name || "",
        second: documents.find((d) => d.id === c.second)?.name || "",
        address: c.address,
      }),
    );
}
export interface AddressChange {
  id: number;
  before: string;
  after: string;
}
/** Stage host-address edits only. Key edges identify the owner, even when hosts collide. */
export function planAddressChange(
  documents: readonly (AddressValidationDocument & { text: string })[],
  edges: readonly KeyConnection[],
  owner: number,
  oldIP: string,
  replacement: string,
): AddressChange[] {
  if (ambiguousAddressOwner(edges, owner))
    throw new Error(t("ambiguousAddressKey"));
  const old = parseCIDR(oldIP),
    next = parseCIDR(replacement);
  if (!old || !next || old.family !== next.family || old.value === next.value)
    throw new Error(t("invalidReplacementAddress"));
  if (
    next.family === 4 &&
    next.prefix < 31 &&
    (next.value === next.start || next.value === next.end)
  )
    throw new Error(t("invalidReplacementAddress"));
  for (const d of documents)
    if (!d.error)
      for (const s of d.model.sections.filter((s) => s.type === "Interface"))
        for (const f of s.fields.filter((f) => f.key === "Address"))
          for (const value of (f.value || "").split(",")) {
            const ip = parseCIDR(value);
            if (ip && ip.family === next.family && ip.value === next.value)
              throw new Error(t("replacementAddressInUse"));
          }
  // Prefix-less input retains the existing Interface mask, so validate that effective mask too.
  for (const d of documents.filter((d) => d.id === owner && !d.error))
    for (const section of d.model.sections.filter(
      (s) => s.type === "Interface",
    ))
      for (const field of section.fields.filter((f) => f.key === "Address"))
        for (const raw of (field.value || "").split(",")) {
          const current = parseCIDR(raw);
          if (
            !replacement.includes("/") &&
            current?.family === old.family &&
            current.value === old.value
          ) {
            const effective = parseCIDR(
              `${formatAddress(next.value, next.family)}/${current.prefix}`,
            )!;
            if (
              effective.family === 4 &&
              effective.prefix < 31 &&
              (effective.value === effective.start ||
                effective.value === effective.end)
            )
              throw new Error(t("invalidReplacementAddress"));
          }
        }
  for (const d of documents.filter((d) => !d.error))
    d.model.sections.forEach((peer, index) => {
      if (
        peer.type !== "Peer" ||
        edges.some(
          (e) => e.source === d.id && e.section === index && e.target === owner,
        )
      )
        return;
      for (const field of peer.fields.filter((f) => f.key === "AllowedIPs"))
        for (const value of (field.value || "").split(",")) {
          const host = parseCIDR(value);
          if (
            host &&
            host.prefix === host.bits &&
            host.family === next.family &&
            host.value === next.value
          )
            throw new Error(t("replacementAddressInUse"));
        }
    });
  const changes: AddressChange[] = [];
  for (const d of documents) {
    if (d.error) continue;
    const model = parse(d.text);
    let changed = false;
    model.sections.forEach((s, index) => {
      const local = d.id === owner && s.type === "Interface";
      const incoming =
        s.type === "Peer" &&
        edges.some(
          (e) => e.source === d.id && e.target === owner && e.section === index,
        );
      if (!local && !incoming) return;
      for (const f of s.fields.filter(
        (f) => f.key === (local ? "Address" : "AllowedIPs"),
      )) {
        const value = (f.value || "")
          .split(",")
          .map((raw) => {
            const ip = parseCIDR(raw.trim());
            if (
              !ip ||
              ip.family !== old.family ||
              ip.value !== old.value ||
              (!local && ip.prefix !== ip.bits)
            )
              return raw;
            changed = true;
            return `${formatAddress(next.value, next.family)}/${local && replacement.includes("/") ? next.prefix : ip.prefix}`;
          })
          .join(",");
        if (value !== f.value) {
          f.value = value;
          delete f.original;
        }
      }
    });
    for (const [index, peer] of model.sections.entries()) {
      if (
        peer.type !== "Peer" ||
        !edges.some(
          (e) => e.source === d.id && e.target === owner && e.section === index,
        )
      )
        continue;
      const fields = peer.fields.filter((f) => f.key === "AllowedIPs");
      const covered = fields.some((f) =>
        (f.value || "").split(",").some((value) => {
          const route = parseCIDR(value);
          return (
            route &&
            route.family === next.family &&
            next.value >= route.start &&
            next.value <= route.end
          );
        }),
      );
      if (!covered) {
        const host = `${formatAddress(next.value, next.family)}/${next.bits}`;
        if (fields[0]) {
          fields[0].value = [fields[0].value, host].filter(Boolean).join(", ");
          delete fields[0].original;
        } else peer.fields.push({ key: "AllowedIPs", value: host });
        changed = true;
      }
    }
    if (changed)
      changes.push({ id: d.id, before: d.text, after: serialize(model) });
  }
  if (!changes.some((c) => c.id === owner))
    throw new Error(t("addressPlanExpired"));
  return changes;
}

let workspaceEdges: readonly KeyConnection[] = [];
export function setAddressEdges(edges: readonly KeyConnection[]) {
  workspaceEdges = edges;
}
export function workspaceAddressMessages(
  current: AddressValidationDocument,
  documents: readonly AddressValidationDocument[],
): string[] {
  return conflictMessages(
    current.id,
    documents,
    addressConflicts(documents, workspaceEdges),
  );
}

export interface PeerConnectionContext {
  source: number;
  section: number;
  target: number;
  sourceText?: string;
  targetText?: string;
}
/** Compatibility helper for callers that need only a definite host reservation. */
export function preferredConnectionAddress(
  documents: readonly AddressValidationDocument[],
  edges: readonly KeyConnection[],
  context: PeerConnectionContext | undefined,
  owner: number,
  oldIP: string,
): string | undefined {
  if (
    context &&
    (!connectionContextValid(documents, edges, context) ||
      context.target !== owner)
  )
    return;
  const result = addressSuggestions(documents, edges, owner, oldIP, context);
  return result.options.some(
    (o) => o.kind === "reserved" && o.address === result.initial,
  )
    ? result.initial
    : undefined;
}
