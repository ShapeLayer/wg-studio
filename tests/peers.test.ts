import { test } from "node:test";
import assert from "node:assert/strict";
import { peerForInterface } from "../src/core/peers.ts";
import {
  newConfig,
  parse,
  generatePrivateKey,
  publicFromPrivate,
  serialize,
} from "../src/core/wireguard.ts";
import { keyConnections, hasReverseConnection } from "../src/core/canvas.ts";

test("reverse peers route each remote IPv4/IPv6 address without copying private keys or guessing Endpoints", () => {
  const remote = parse(
    "[Interface]\nPrivateKey = dummy:abcdef1\nAddress = 10.2.0.1/24, fd00::1/64\nAddress = 10.3.0.1/16\nListenPort = 51820",
  );
  const before = serialize(remote);
  const peer = peerForInterface(remote, "dummy:abcdef1");
  assert.equal(peer.type, "Peer");
  assert.equal(
    peer.fields.find((field) => field.key === "PublicKey")?.value,
    "dummy:abcdef1",
  );
  assert.equal(
    peer.fields.find((field) => field.key === "AllowedIPs")?.value,
    "10.2.0.1/32, fd00::1/128, 10.3.0.1/32",
  );
  assert.ok(
    peer.fields.every(
      (field) => field.key !== "PrivateKey" && field.key !== "Endpoint",
    ),
  );
  assert.equal(serialize(remote), before);
});

test("new-profile peer defaults produce reciprocal key connections for real key pairs", async () => {
  const source = newConfig(),
    target = newConfig();
  const sourcePrivate = generatePrivateKey(),
    targetPrivate = generatePrivateKey();
  source.sections[0].fields[0].value = sourcePrivate;
  target.sections[0].fields[0].value = targetPrivate;
  const sourcePublic = await publicFromPrivate(sourcePrivate),
    targetPublic = await publicFromPrivate(targetPrivate);
  source.sections.push(peerForInterface(target, targetPublic));
  target.sections.push(peerForInterface(source, sourcePublic));
  const edges = keyConnections(
    [
      { id: 1, model: source },
      { id: 2, model: target },
    ],
    new Map([
      [1, sourcePublic],
      [2, targetPublic],
    ]),
  );
  assert.equal(edges.length, 2);
  assert.ok(edges.every((edge) => hasReverseConnection(edge, edges)));
});
