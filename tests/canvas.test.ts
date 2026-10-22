import type { KeyDocument } from "../src/core/types.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zoomAt,
  dotGrid,
  fitCamera,
  keyConnections,
  edgeCurve,
  hasReverseConnection,
  CARD_WIDTH,
  CARD_HEIGHT,
} from "../src/core/canvas.ts";
import {
  parse,
  newConfig,
  newPeer,
  generatePrivateKey,
  publicFromPrivate,
} from "../src/core/wireguard.ts";
test("dot density stays readable across the full zoom range and anchored while panning", () => {
  for (let percent = 5; percent <= 200; percent++) {
    const camera = { x: -123.5, y: 246.25, scale: percent / 100 };
    const grid = dotGrid(camera);
    assert.ok(grid.spacing >= 16 && grid.spacing < 32);
    // The world origin remains on a dot at every grid level.
    for (const axis of ["x", "y"] as const) {
      const phase =
        (camera[axis] - grid[axis] - grid.spacing / 2) / grid.spacing;
      assert.ok(Math.abs(phase - Math.round(phase)) < 1e-9);
    }
    const moved = dotGrid({ ...camera, x: camera.x + 3 });
    const delta = (moved.x - grid.x - 3) / grid.spacing;
    assert.ok(Math.abs(delta - Math.round(delta)) < 1e-9);
  }
});
test("zoom preserves the world point beneath the pointer and clamps limits", () => {
  const c = { x: -220, y: 83, scale: 0.7 },
    p = { x: 671, y: 410 };
  for (const scale of [0.01, 0.3, 1, 5]) {
    const next = zoomAt(c, p, scale);
    assert.ok(next.scale >= 0.05 && next.scale <= 2);
    assert.ok(
      Math.abs((p.x - next.x) / next.scale - (p.x - c.x) / c.scale) < 1e-9,
    );
    assert.ok(
      Math.abs((p.y - next.y) / next.scale - (p.y - c.y) / c.scale) < 1e-9,
    );
  }
});
test("fit includes cards at negative and positive world coordinates", () => {
  const items = [
      { x: -200, y: -100 },
      { x: 900, y: 700 },
    ],
    c = fitCamera(items, 1600, 1100);
  for (const d of items) {
    assert.ok(d.x * c.scale + c.x >= 0);
    assert.ok(d.y * c.scale + c.y >= 0);
    assert.ok((d.x + CARD_WIDTH) * c.scale + c.x <= 1600);
    assert.ok((d.y + CARD_HEIGHT) * c.scale + c.y <= 1100);
  }
});
test("only actual peer-public / interface-private key matches create directed edges", async () => {
  const a: KeyDocument = { id: 1, model: newConfig() },
    b: KeyDocument = { id: 2, model: newConfig() },
    c: KeyDocument = { id: 3, model: newConfig() };
  const ka = generatePrivateKey(),
    kb = generatePrivateKey();
  a.model.sections[0].fields[0].value = ka;
  b.model.sections[0].fields[0].value = kb;
  const pa = await publicFromPrivate(ka),
    pb = await publicFromPrivate(kb),
    pubs = new Map([
      [1, pa],
      [2, pb],
    ]);
  const ab = newPeer();
  ab.fields[0].value = pb;
  a.model.sections.push(ab);
  const ba = newPeer();
  ba.fields[0].value = pa;
  b.model.sections.push(ba);
  const unknown = newPeer();
  unknown.fields[0].value = await publicFromPrivate(generatePrivateKey());
  c.model.sections.push(unknown);
  assert.deepEqual(
    keyConnections([a, b, c], pubs).map((e) => [e.source, e.target, e.section]),
    [
      [1, 2, 1],
      [2, 1, 1],
    ],
  );
  b.error = "invalid source";
  assert.equal(keyConnections([a, b, c], pubs).length, 0);
  assert.equal(keyConnections([a, c], pubs).length, 0);
});
test("moving a card changes connection endpoints in both directions", () => {
  const a = { x: 0, y: 0 },
    b = { x: 540, y: 80 };
  const original = edgeCurve(a, b);
  assert.equal(original.x1, CARD_WIDTH);
  assert.equal(original.x2, 540);
  assert.notEqual(edgeCurve(a, { x: -500, y: 200 }).path, original.path);
  assert.equal(edgeCurve(a, { x: -500, y: 200 }).x1, 0);
});

test("a one-way edge is cleared only by a reverse connection between the same documents", () => {
  const ab = { source: 1, target: 2, section: 1, peer: 1, key: "b" };
  const bc = { ...ab, source: 2, target: 3 };
  const ba = { ...ab, source: 2, target: 1, key: "a" };
  assert.equal(hasReverseConnection(ab, [ab]), false);
  assert.equal(
    hasReverseConnection(ab, [ab, { ...ab, section: 2 }, bc]),
    false,
  );
  assert.equal(hasReverseConnection(ab, [ab, ba]), true);
  assert.equal(hasReverseConnection(ba, [ab, ba]), true);
  assert.equal(hasReverseConnection(bc, [ab, ba, bc]), false);
  const curve = edgeCurve({ x: 0, y: 80 }, { x: 600, y: -40 }, 12);
  assert.equal(curve.midX, (curve.x1 + curve.x2) / 2);
  assert.equal(curve.midY, (curve.y1 + curve.y2) / 2);
});

test("dummy references draw the same directed and reciprocal relationships as real keys", () => {
  const items = [
    {
      id: 1,
      model: parse(
        "[Interface]\nPrivateKey = dummy:abcdef1\n[Peer]\nPublicKey = dummy:abcdef2",
      ),
    },
    {
      id: 2,
      model: parse(
        "[Interface]\nPrivateKey = dummy:abcdef2\n[Peer]\nPublicKey = dummy:abcdef1",
      ),
    },
  ];
  const edges = keyConnections(
    items,
    new Map([
      [1, "dummy:abcdef1"],
      [2, "dummy:abcdef2"],
    ]),
  );
  assert.equal(edges.length, 2);
  assert.ok(edges.every((edge) => hasReverseConnection(edge, edges)));
});
