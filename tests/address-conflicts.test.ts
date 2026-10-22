import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressConflicts,
  conflictMessages,
  planAddressChange,
} from "../src/core/address-conflicts.ts";
import { parse } from "../src/core/wireguard.ts";
import type { KeyConnection } from "../src/core/types.ts";
const doc = (id: number, address: string, peer = "") => {
  const text = `[Interface]\nAddress = ${address}\n${peer}`;
  return { id, name: `wg${id}.conf`, text, model: parse(text) };
};
const edge = (source: number, target: number, section = 1): KeyConnection => ({
  source,
  target,
  section,
  peer: 1,
  key: "key",
});
test("disconnected duplicate hosts are Info; direct and indirect key links promote them to Warning", () => {
  const docs = [
    doc(1, "10.0.0.1/24"),
    doc(2, "10.0.0.1/32"),
    doc(3, "10.0.0.3/24"),
  ];
  assert.match(
    conflictMessages(1, docs, addressConflicts(docs, []))[0],
    /^Info:/,
  );
  for (const edges of [[edge(1, 2)], [edge(3, 1), edge(2, 3)]]) {
    const conflicts = addressConflicts(docs, edges);
    assert.equal(conflicts[0].connected, true);
    assert.match(conflictMessages(2, docs, conflicts)[0], /^Warning:/);
  }
  assert.equal(addressConflicts(docs, [edge(1, 3)])[0].connected, false);
});
test("canonical IPv6 hosts collide across masks and malformed profiles are excluded", () => {
  const docs = [doc(1, "fd00::1/64"), doc(2, "fd00:0:0:0:0:0:0:1/128")];
  assert.equal(addressConflicts(docs, [])[0].address, "fd00::1");
  assert.deepEqual(
    addressConflicts([docs[0], { ...docs[1], error: "invalid" }], []),
    [],
  );
});
test("address plan is immutable and updates only key-identified incoming host routes, preserving masks, comments and broad routes", () => {
  const docs = [
    doc(1, "10.0.0.1/24, fd00::1/64"),
    doc(2, "10.0.0.1/24"),
    doc(
      3,
      "10.0.0.3/24",
      "[Peer]\nPublicKey = key\nAllowedIPs = 10.0.0.1/32, 0.0.0.0/0 # keep\n[Peer]\nPublicKey = other\nAllowedIPs = 10.0.0.1/32\n",
    ),
  ];
  const before = docs.map((d) => d.text),
    plan = planAddressChange(docs, [edge(3, 1)], 1, "10.0.0.1", "10.0.0.9");
  assert.deepEqual(
    docs.map((d) => d.text),
    before,
  );
  assert.deepEqual(
    plan.map((p) => p.id),
    [1, 3],
  );
  assert.match(plan[0].after, /10\.0\.0\.9\/24, fd00::1\/64/);
  assert.match(plan[1].after, /10\.0\.0\.9\/32, 0\.0\.0\.0\/0 # keep/);
  assert.match(
    plan[1].after,
    /PublicKey = other\nAllowedIPs = 10\.0\.0\.1\/32/,
  );
});
test("replacement rejects occupied hosts, wrong family, unchanged IP and stale owner", () => {
  const docs = [doc(1, "10.0.0.1/24"), doc(2, "10.0.0.2/24")];
  for (const ip of ["10.0.0.2", "::1", "10.0.0.1", "oops"])
    assert.throws(() => planAddressChange(docs, [], 1, "10.0.0.1", ip));
  assert.throws(() => planAddressChange(docs, [], 1, "10.0.0.9", "10.0.0.3"));
});
test("IPv6 incoming host route is matched by normalized address and broad routes stay intact", () => {
  const docs = [
    doc(1, "fd00::1/64"),
    doc(2, "fd00::2/64", "[Peer]\nAllowedIPs = fd00:0:0:0::1/128, fd00::/64\n"),
  ];
  const plan = planAddressChange(
    docs,
    [edge(2, 1)],
    1,
    "fd00::1",
    "fd00::a/64",
  );
  assert.match(plan[1].after, /fd00::a\/128, fd00::\/64/);
});

test("connecting an existing profile reuses this peer reservation (.4), not a new .5 address", async () => {
  const { preferredConnectionAddress } =
    await import("../src/core/address-conflicts.ts");
  const docs = [
    doc(
      1,
      "10.0.0.1/24",
      "[Peer]\nAllowedIPs = 10.0.0.2/32\n[Peer]\nAllowedIPs = 10.0.0.3/32\n[Peer]\nPublicKey = remote\nAllowedIPs = 10.0.0.4/32\n",
    ),
    doc(2, "10.0.0.1/24"),
  ];
  const edges = [edge(1, 2, 3)];
  const context = { source: 1, target: 2, section: 3 };
  assert.equal(
    preferredConnectionAddress(docs, edges, context, 2, "10.0.0.1"),
    "10.0.0.4/24",
  );
  const plan = planAddressChange(docs, edges, 2, "10.0.0.1", "10.0.0.4/24");
  assert.deepEqual(
    plan.map((c) => c.id),
    [2],
  );
  assert.match(plan[0].after, /Address = 10\.0\.0\.4\/24/);
  assert.match(docs[0].text, /AllowedIPs = 10\.0\.0\.4\/32/);
  assert.equal(
    preferredConnectionAddress(docs, [], context, 2, "10.0.0.1"),
    undefined,
  );
  assert.equal(
    preferredConnectionAddress(docs, edges, context, 1, "10.0.0.1"),
    undefined,
  );
});

test("reserved address preference rejects other owners, competing peers and broad routes", async () => {
  const { preferredConnectionAddress } =
    await import("../src/core/address-conflicts.ts");
  const context = { source: 1, target: 2, section: 1 };
  const source = doc(1, "10.0.0.1/24", "[Peer]\nAllowedIPs = 10.0.0.4/32\n");
  const target = doc(2, "10.0.0.1/24");
  for (const other of [
    doc(3, "10.0.0.4/24"),
    doc(3, "10.0.0.3/24", "[Peer]\nAllowedIPs = 10.0.0.4/32\n"),
  ])
    assert.equal(
      preferredConnectionAddress(
        [source, target, other],
        [edge(1, 2)],
        context,
        2,
        "10.0.0.1",
      ),
      undefined,
    );
  assert.equal(
    preferredConnectionAddress(
      [doc(1, "10.0.0.1/24", "[Peer]\nAllowedIPs = 0.0.0.0/0\n"), target],
      [edge(1, 2)],
      context,
      2,
      "10.0.0.1",
    ),
    undefined,
  );
});

test("IPv6 reserved host becomes the remote Interface address with its original prefix", async () => {
  const { preferredConnectionAddress } =
    await import("../src/core/address-conflicts.ts");
  const docs = [
    doc(1, "fd00::1/64", "[Peer]\nAllowedIPs = fd00:0:0:0::4/128\n"),
    doc(2, "fd00::1/64"),
  ];
  assert.equal(
    preferredConnectionAddress(
      docs,
      [edge(1, 2)],
      { source: 1, target: 2, section: 1 },
      2,
      "fd00::1",
    ),
    "fd00::4/64",
  );
});
