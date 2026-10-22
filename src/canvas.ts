import type { Camera, Point, KeyDocument, KeyConnection } from "./types.ts";
// Canvas coordinates are independent of the screen and zoom level.
export const CARD_WIDTH = 380,
  CARD_HEIGHT = 476;

export function dotGrid(camera: Camera) {
  // Switch between nested grid levels so dots stay 16–32 screen pixels apart.
  const baseSpacing = 24;
  const level = Math.ceil(Math.log2(16 / (baseSpacing * camera.scale)));
  const spacing = baseSpacing * 2 ** level * camera.scale;
  return {
    spacing,
    // A radial-gradient dot sits at the tile center. Anchor it to world origin.
    x: (camera.x % spacing) - spacing / 2,
    y: (camera.y % spacing) - spacing / 2,
  };
}
export function zoomAt(
  camera: Camera,
  point: Point,
  nextScale: number,
): Camera {
  const scale = Math.max(0.05, Math.min(2, nextScale));
  return {
    scale,
    x: point.x - ((point.x - camera.x) * scale) / camera.scale,
    y: point.y - ((point.y - camera.y) * scale) / camera.scale,
  };
}
export function fitCamera(
  items: readonly Point[],
  width: number,
  height: number,
  padding = 100,
): Camera {
  if (!items.length) return { x: padding, y: padding, scale: 1 };
  const minX = Math.min(...items.map((d) => d.x)),
    minY = Math.min(...items.map((d) => d.y));
  const maxX = Math.max(...items.map((d) => d.x + CARD_WIDTH)),
    maxY = Math.max(...items.map((d) => d.y + CARD_HEIGHT));
  const scale = Math.max(
    0.05,
    Math.min(
      1,
      (width - padding * 2) / (maxX - minX),
      (height - padding * 2) / (maxY - minY),
    ),
  );
  return {
    scale,
    x: (width - (maxX - minX) * scale) / 2 - minX * scale,
    y: (height - (maxY - minY) * scale) / 2 - minY * scale,
  };
}
export function keyConnections(
  items: readonly KeyDocument[],
  publicKeys: ReadonlyMap<number, string>,
): KeyConnection[] {
  const owners = new Map<string, number[]>();
  for (const d of items) {
    if (d.error) continue;
    const key = publicKeys.get(d.id);
    if (key) {
      if (!owners.has(key)) owners.set(key, []);
      owners.get(key)!.push(d.id);
    }
  }
  const edges: KeyConnection[] = [];
  for (const source of items) {
    if (source.error) continue;
    let peer = 0;
    source.model.sections.forEach((s, index) => {
      if (s.type !== "Peer") return;
      peer++;
      const key = s.fields.find((f) => f.key === "PublicKey")?.value;
      if (!key) return;
      for (const target of owners.get(key) || []) {
        if (target !== source.id)
          edges.push({ source: source.id, target, section: index, peer, key });
      }
    });
  }
  return edges;
}
export function hasReverseConnection(
  edge: KeyConnection,
  edges: readonly KeyConnection[],
): boolean {
  return edges.some(
    (other) => other.source === edge.target && other.target === edge.source,
  );
}

export function edgeCurve(source: Point, target: Point, offset = 0) {
  const right = target.x >= source.x;
  const x1 = source.x + (right ? CARD_WIDTH : 0),
    y1 = source.y + 118 + offset;
  const x2 = target.x + (right ? 0 : CARD_WIDTH),
    y2 = target.y + 80;
  const bend = Math.max(90, Math.abs(x2 - x1) * 0.5),
    direction = right ? 1 : -1;
  return {
    path: `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`,
    x1,
    y1,
    x2,
    y2,
    midX: (x1 + x2) / 2,
    midY: (y1 + y2) / 2,
  };
}
