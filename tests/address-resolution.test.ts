import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressSuggestions,
  connectionContextValid,
} from "../src/core/address-resolution.ts";
import {
  addressConflicts,
  planAddressChange,
} from "../src/core/address-conflicts.ts";
import { parse, serialize } from "../src/core/wireguard.ts";
import type { KeyConnection } from "../src/core/types.ts";
const doc = (id: number, address: string, peers: string[] = []) => {
  const text =
    `[Interface]\nAddress = ${address}\n` +
    peers
      .map((p, i) => `[Peer]\nPublicKey = key${i}\nAllowedIPs = ${p}\n`)
      .join("");
  return { id, name: `${id}.conf`, text, model: parse(text) };
};
const edge = (source: number, target: number, section = 1): KeyConnection => ({
  source,
  target,
  section,
  peer: section,
  key: "key",
});
test("import/source/dummy-key paths infer reservations from the graph without a button context", () => {
  for (const ip of ["172.23.8.197", "192.168.200.42"]) {
    const docs = [doc(1, "10.0.0.1/24", [`${ip}/32`]), doc(2, "10.0.0.1/24")];
    const result = addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1");
    assert.equal(result.initial, `${ip}/32`);
    assert.equal(result.ambiguous, false);
  }
});
test("cross-subnet reservation uses a containing connected Interface prefix rather than the unrelated old mask", () => {
  const docs = [
    doc(1, "10.0.0.1/24, 172.22.16.1/20", ["172.22.20.77/32"]),
    doc(2, "10.0.0.1/24"),
  ];
  assert.equal(
    addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1").initial,
    "172.22.20.77/20",
  );
  const plan = planAddressChange(
    docs,
    [edge(1, 2)],
    2,
    "10.0.0.1",
    "172.22.20.77/20",
  );
  assert.match(plan[0].after, /Address = 172\.22\.20\.77\/20/);
});
test("distinct reservations require explicit selection unless one exact connection provides unambiguous intent", () => {
  const docs = [
      doc(1, "10.0.0.1/24", ["10.0.0.9/32"]),
      doc(2, "10.0.0.1/24"),
      doc(3, "10.0.0.3/24", ["10.0.0.19/32"]),
    ],
    edges = [edge(1, 2), edge(3, 2)];
  const generic = addressSuggestions(docs, edges, 2, "10.0.0.1");
  assert.equal(generic.initial, "");
  assert.equal(generic.ambiguous, true);
  assert.equal(
    addressSuggestions(docs, edges, 2, "10.0.0.1", {
      source: 3,
      target: 2,
      section: 1,
    }).initial,
    "10.0.0.19/24",
  );
  const multi = [doc(1, "10.0.0.1/24", ["10.0.0.9/32, 10.0.0.19/32"]), docs[1]];
  assert.equal(
    addressSuggestions(multi, [edge(1, 2)], 2, "10.0.0.1", {
      source: 1,
      target: 2,
      section: 1,
    }).initial,
    "",
  );
});
test("multiple incoming reservations for the same owner do not falsely count as occupied", () => {
  const docs = [
    doc(1, "10.0.0.1/24", ["10.0.0.9/32"]),
    doc(2, "10.0.0.1/24"),
    doc(3, "10.0.0.3/24", ["10.0.0.9/32"]),
  ];
  assert.equal(
    addressSuggestions(docs, [edge(1, 2), edge(3, 2)], 2, "10.0.0.1").initial,
    "10.0.0.9/24",
  );
  assert.equal(
    addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1").options.some((o) =>
      o.address.startsWith("10.0.0.9/"),
    ),
    false,
  );
});
test("routed subnet suggestions require selection and preserve routes instead of treating a network address as a host", () => {
  const docs = [
    doc(1, "10.0.0.1/24", ["192.168.50.0/24"]),
    doc(2, "10.0.0.1/24"),
    doc(3, "192.168.50.1/24"),
  ];
  const result = addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1");
  assert.equal(result.initial, "");
  assert.ok(
    result.options.some(
      (o) => o.kind === "range" && o.address === "192.168.50.2/24",
    ),
  );
  const plan = planAddressChange(
    docs,
    [edge(1, 2)],
    2,
    "10.0.0.1",
    "192.168.50.2/24",
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 2);
});
test("default routes never become address-allocation pools", () => {
  const docs = [doc(1, "10.0.0.1/32", ["0.0.0.0/0"]), doc(2, "10.0.0.1/32")];
  assert.deepEqual(
    addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1").options,
    [],
  );
});
test("IPv6 subnet search jumps reservations without enumerating addresses, dual-stack remains separate", () => {
  const docs = [
    doc(1, "fd42::1/64, 10.0.0.1/24", ["fd99::/32, 192.168.77.8/32"]),
    doc(2, "fd42::1/64, 10.0.0.1/24"),
    doc(3, "fd99::1/128", ["fd99::/48"]),
  ];
  const result = addressSuggestions(docs, [edge(1, 2)], 2, "fd42::1");
  assert.ok(
    result.options.some(
      (o) => o.kind === "range" && o.address === "fd99:0:1::/32",
    ),
  );
  assert.ok(result.options.every((o) => o.address.includes(":")));
  assert.equal(
    addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1").initial,
    "192.168.77.8/32",
  );
});
test("host-only or exhausted old subnet falls back to connected source subnet, full networks remain unresolved", () => {
  const docs = [doc(1, "192.168.7.1/24", [""]), doc(2, "192.168.7.1/32")];
  assert.equal(
    addressSuggestions(docs, [edge(1, 2)], 2, "192.168.7.1").initial,
    "192.168.7.2/24",
  );
  assert.equal(
    addressSuggestions(
      [doc(1, "192.168.7.1/32", [""]), docs[1]],
      [edge(1, 2)],
      2,
      "192.168.7.1",
    ).options.length,
    0,
  );
});
test("stale button context cannot override graph-derived ambiguity", () => {
  const docs = [
      doc(1, "10.0.0.1/24", ["10.0.0.9/32"]),
      doc(2, "10.0.0.1/24"),
      doc(3, "10.0.0.3/24", ["10.0.0.19/32"]),
    ],
    edges = [edge(1, 2), edge(3, 2)];
  const context = {
    source: 1,
    target: 2,
    section: 1,
    sourceText: "old",
    targetText: docs[1].text,
  };
  assert.equal(connectionContextValid(docs, edges, context), false);
  assert.equal(
    addressSuggestions(docs, edges, 2, "10.0.0.1", context).initial,
    "",
  );
});
test("shared private keys with ambiguous ownership block address propagation", () => {
  const docs = [
      doc(1, "10.0.0.1/24", ["10.0.0.9/32"]),
      doc(2, "10.0.0.1/24"),
      doc(3, "10.0.0.3/24"),
    ],
    edges = [edge(1, 2), edge(1, 3)];
  assert.equal(addressSuggestions(docs, edges, 2, "10.0.0.1").ambiguous, true);
  assert.throws(
    () => planAddressChange(docs, edges, 2, "10.0.0.1", "10.0.0.9/24"),
    /multiple profiles/,
  );
});
test("new host reachability is added for missing, empty and out-of-subnet broad incoming routes, while default routes already cover it", () => {
  for (const route of ["", "10.0.0.0/24", "172.22.0.7/32"]) {
    const docs = [doc(1, "10.0.0.2/24", [route]), doc(2, "10.0.0.1/24")];
    const before = docs.map((d) => serialize(d.model));
    const plan = planAddressChange(
      docs,
      [edge(1, 2)],
      2,
      "10.0.0.1",
      "192.168.50.8/24",
    );
    assert.match(plan.find((c) => c.id === 1)!.after, /192\.168\.50\.8\/32/);
    if (route) assert.ok(plan[0].after.includes(route));
    assert.deepEqual(
      docs.map((d) => serialize(d.model)),
      before,
    );
  }
  const docs = [doc(1, "10.0.0.2/24", ["0.0.0.0/0"]), doc(2, "10.0.0.1/24")];
  assert.deepEqual(
    planAddressChange(docs, [edge(1, 2)], 2, "10.0.0.1", "192.168.50.8/24").map(
      (c) => c.id,
    ),
    [2],
  );
  const missing = doc(1, "10.0.0.2/24");
  missing.text += "[Peer]\nPublicKey = key\n";
  missing.model = parse(missing.text);
  assert.match(
    planAddressChange(
      [missing, docs[1]],
      [edge(1, 2)],
      2,
      "10.0.0.1",
      "10.0.0.8/24",
    )[0].after,
    /AllowedIPs = 10\.0\.0\.8\/32/,
  );
});
test("manual address checks other peer reservations and the effective preserved subnet mask", () => {
  const docs = [doc(1, "10.0.0.1/24", ["10.0.0.7/32"]), doc(2, "10.0.0.1/24")];
  assert.throws(() =>
    planAddressChange(docs, [], 2, "10.0.0.1", "10.0.0.7/24"),
  );
  for (const ip of ["10.0.0.255", "10.0.0.0"])
    assert.throws(() => planAddressChange(docs, [], 2, "10.0.0.1", ip));
  for (const prefix of ["31", "32"])
    assert.doesNotThrow(() =>
      planAddressChange(docs, [], 2, "10.0.0.1", `10.0.0.0/${prefix}`),
    );
});
test("three transitive duplicates can be resolved one at a time without altering the other family or profile hosts", () => {
  const docs = [
      doc(1, "10.0.0.1/24, fd00::1/64", ["10.0.0.8/32"]),
      doc(2, "10.0.0.1/24, fd00::2/64", ["10.0.0.9/32"]),
      doc(3, "10.0.0.1/24, fd00::3/64"),
    ],
    edges = [edge(1, 2), edge(2, 3)];
  assert.equal(
    addressConflicts(docs, edges).filter((c) => c.connected).length,
    3,
  );
  for (const [id, address] of [
    [2, "10.0.0.8/24"],
    [3, "10.0.0.9/24"],
  ] as const)
    for (const change of planAddressChange(
      docs,
      edges,
      id,
      "10.0.0.1",
      address,
    )) {
      const d = docs.find((d) => d.id === change.id)!;
      d.text = change.after;
      d.model = parse(d.text);
    }
  assert.equal(addressConflicts(docs, edges).length, 0);
  assert.match(docs[0].text, /fd00::1\/64/);
});

test("normalization, bare hosts and repeated Address/AllowedIPs fields preserve unrelated values and comments", () => {
  const source = doc(1, "10.20.30.1/24", ["10.20.30.77"]);
  source.text += "AllowedIPs = fd00::/64 # downstream\n";
  source.model = parse(source.text);
  const target = doc(2, "10.20.30.1/24, fd00::2/64");
  target.text += "Address = 172.31.9.2/24 # alias\n";
  target.model = parse(target.text);
  const docs = [source, target],
    edges = [edge(1, 2)];
  assert.equal(
    addressSuggestions(docs, edges, 2, "10.20.30.1").initial,
    "10.20.30.77/24",
  );
  const change = planAddressChange(
    docs,
    edges,
    2,
    "10.20.30.1",
    "10.20.30.77/24",
  ).find((c) => c.id === 2)!;
  assert.match(change.after, /fd00::2\/64/);
  assert.match(change.after, /Address = 172\.31\.9\.2\/24 # alias/);
});
test("allocation and propagation are independent of specific numeric IPv4 examples", () => {
  for (let i = 1; i <= 24; i++) {
    const base = `172.${16 + (i % 16)}.${i}`;
    const old = `${base}.1`,
      reserved = `${base}.${20 + i}`;
    const docs = [doc(1, `${old}/24`, [`${reserved}/32`]), doc(2, `${old}/24`)];
    assert.equal(
      addressSuggestions(docs, [edge(1, 2)], 2, old).initial,
      `${reserved}/24`,
    );
    assert.deepEqual(
      planAddressChange(docs, [edge(1, 2)], 2, old, `${reserved}/24`).map(
        (c) => c.id,
      ),
      [2],
    );
  }
});

test("an occupied reservation falls back to a free host instead of borrowing another peer address", () => {
  const docs = [
    doc(1, "10.0.0.1/24", ["10.0.0.4/32", "10.0.0.2/32, 10.0.0.3/32"]),
    doc(2, "10.0.0.1/24"),
    doc(3, "10.0.0.4/24"),
  ];
  const result = addressSuggestions(docs, [edge(1, 2)], 2, "10.0.0.1", {
    source: 1,
    target: 2,
    section: 1,
  });
  assert.equal(result.initial, "10.0.0.5/24");
  const plan = planAddressChange(
    docs,
    [edge(1, 2)],
    2,
    "10.0.0.1",
    result.initial,
  );
  assert.match(
    plan.find((c) => c.id === 1)!.after,
    /10\.0\.0\.4\/32, 10\.0\.0\.5\/32/,
  );
});
