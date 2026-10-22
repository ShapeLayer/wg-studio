import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unlinkedPeerWarnings,
  workspaceAddressMessages,
  setAddressEdges,
} from "../src/core/address-conflicts.ts";
import { parse } from "../src/core/wireguard.ts";
import type { KeyConnection } from "../src/core/types.ts";
const doc = (id: number, peers: string) => ({
  id,
  name: `${id}.conf`,
  model: parse(`[Interface]\nAddress = 10.0.0.${id}/24\n${peers}`),
});
const edge: KeyConnection = {
  source: 1,
  target: 2,
  section: 1,
  peer: 1,
  key: "remote",
};
test("allocated unresolved peers warn with ordinal and all IPv4/IPv6 addresses, even before a key is entered", () => {
  const source = doc(
    1,
    "[Peer]\nPublicKey =\nAllowedIPs = 10.0.0.2/32, fd00::2/128\n[Peer]\nPublicKey = remote\nAllowedIPs = 192.168.0.0/24\n",
  );
  const issues = unlinkedPeerWarnings(source, [source], []);
  assert.equal(issues.length, 2);
  assert.match(issues[0], /Warning: Peer 1.*10\.0\.0\.2\/32, fd00::2\/128/);
  assert.match(issues[1], /Peer 2.*192\.168\.0\.0\/24/);
});
test("a one-way key link suffices; removing or invalidating the remote profile restores the warning", () => {
  const source = doc(
      1,
      "[Peer]\nPublicKey = remote\nAllowedIPs = 10.0.0.2/32\n",
    ),
    target = doc(2, "");
  assert.deepEqual(unlinkedPeerWarnings(source, [source, target], [edge]), []);
  assert.equal(unlinkedPeerWarnings(source, [source], [edge]).length, 1);
  assert.equal(
    unlinkedPeerWarnings(
      source,
      [source, { ...target, error: "invalid" }],
      [edge],
    ).length,
    1,
  );
  assert.equal(
    unlinkedPeerWarnings(source, [source, target], [{ ...edge, key: "stale" }])
      .length,
    1,
  );
  assert.equal(
    unlinkedPeerWarnings(source, [source, target], [{ ...edge, target: 1 }])
      .length,
    1,
  );
});
test("empty/invalid AllowedIPs do not add a redundant allocation warning and section matching does not hide other peers", () => {
  const source = doc(
      1,
      "[Peer]\nAllowedIPs =\n[Peer]\nAllowedIPs = malformed\n[Peer]\nPublicKey = remote\nAllowedIPs = 10.0.0.2\n",
    ),
    target = doc(2, "");
  const issues = unlinkedPeerWarnings(source, [source, target], [edge]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /Peer 3/);
  assert.deepEqual(
    unlinkedPeerWarnings({ ...source, error: "invalid" }, [source, target], []),
    [],
  );
});
test("normal workspace diagnostics add and clear the unresolved warning with real or dummy key edges", () => {
  for (const key of ["remote", "dummy:bbbbbbb"]) {
    const source = doc(
        1,
        `[Peer]\nPublicKey = ${key}\nAllowedIPs = 0.0.0.0/0\n`,
      ),
      target = doc(2, "");
    setAddressEdges([]);
    assert.match(
      workspaceAddressMessages(source, [source, target])[0],
      /not linked/,
    );
    setAddressEdges([{ ...edge, key }]);
    assert.deepEqual(workspaceAddressMessages(source, [source, target]), []);
  }
  setAddressEdges([]);
});
