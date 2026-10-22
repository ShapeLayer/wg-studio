import { t } from "../i18n/index.ts";
import { parseCIDR, formatAddress } from "./ip-address.ts";
import type { Network } from "./ip-address.ts";
import type { ConfigModel } from "./types.ts";

function values(model: ConfigModel, type: "Interface" | "Peer", key: string) {
  let peer = 0;
  return model.sections.flatMap((section) => {
    if (section.type === "Peer") peer++;
    if (section.type !== type) return [];
    return section.fields
      .filter((field) => field.key === key)
      .flatMap((field) =>
        (field.value || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .flatMap((text) => {
            const address = parseCIDR(text);
            return address ? [{ address, text, peer }] : [];
          }),
      );
  });
}
const sameHost = (a: Network, b: Network) =>
  a.family === b.family && a.value === b.value;
const containsHost = (pool: Network, host: Network) =>
  pool.family === host.family &&
  host.value >= pool.start &&
  host.value <= pool.end;

/** Warnings describe routing conflicts; they do not prevent editing or saving. */
export function validateAddressAssignments(model: ConfigModel): string[] {
  const issues: string[] = [];
  const interfaces = values(model, "Interface", "Address");
  const peers = values(model, "Peer", "AllowedIPs");
  const duplicates = new Set<string>();
  for (let i = 0; i < peers.length; i++) {
    const current = peers[i];
    for (const previous of peers.slice(0, i)) {
      if (
        previous.peer === current.peer ||
        previous.address.family !== current.address.family ||
        previous.address.start !== current.address.start ||
        previous.address.end !== current.address.end
      )
        continue;
      const identity = `${previous.peer}:${current.peer}:${current.address.family}:${current.address.start}/${current.address.prefix}`;
      if (duplicates.has(identity)) continue;
      duplicates.add(identity);
      issues.push(
        t("peerAddressConflict", {
          first: previous.peer,
          second: current.peer,
          address: `${formatAddress(current.address.start, current.address.family)}/${current.address.prefix}`,
        }),
      );
    }
    // Broad routes (including default routes) can intentionally include local addresses.
    // Only host routes provide evidence of a potential duplicated peer address.
    const host = current.address;
    if (host.prefix !== host.bits) continue;
    const ip = formatAddress(host.value, host.family);
    if (interfaces.some((local) => sameHost(local.address, host))) {
      issues.push(
        t("peerUsesInterfaceAddress", { peer: current.peer, address: ip }),
      );
    } else if (
      interfaces.length &&
      !interfaces.some((local) => containsHost(local.address, host))
    ) {
      issues.push(
        t("peerAddressOutsideInterface", {
          peer: current.peer,
          address: current.text,
        }),
      );
    } else if (
      host.family === 4 &&
      interfaces.some(
        (local) =>
          local.address.family === 4 &&
          local.address.prefix < 31 &&
          (host.value === local.address.start ||
            host.value === local.address.end),
      )
    ) {
      issues.push(
        t("peerUsesNetworkOrBroadcast", { peer: current.peer, address: ip }),
      );
    }
  }
  return [...new Set(issues)];
}

export interface AddressValidationDocument {
  id: number;
  name: string;
  model: ConfigModel;
  error?: string;
}
export function workspaceAddressWarnings(
  current: AddressValidationDocument,
  documents: readonly AddressValidationDocument[],
): string[] {
  if (current.error) return [];
  const localAddresses = values(current.model, "Interface", "Address");
  const issues = new Set<string>();
  for (const other of documents) {
    if (other.id === current.id || other.error) continue;
    for (const local of localAddresses) {
      if (
        values(other.model, "Interface", "Address").some((remote) =>
          sameHost(local.address, remote.address),
        )
      ) {
        issues.add(
          t("profilesShareInterfaceAddress", {
            name: other.name,
            address: formatAddress(local.address.value, local.address.family),
          }),
        );
      }
    }
  }
  return [...issues];
}
