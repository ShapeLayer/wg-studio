import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { exportFiles, exportZip } from "../src/core/export.ts";

test("ZIP export preserves original UTF-8 config text, including unsaved formatting", async () => {
  const text = "# 서울 설정\r\n[Interface]\r\nAddress = 10.0.0.1/24\r\n";
  const files = unzipSync(
    await exportZip([
      { id: 1, name: "server.conf", text, format: "conf" },
      { id: 2, name: "client.txt", text: "[Interface]\n", format: "conf" },
    ]),
  );
  assert.deepEqual(Object.keys(files), ["server.conf", "client.conf"]);
  assert.equal(strFromU8(files["server.conf"]), text);
});
test("mixed exports include QR SVG images and omit excluded documents", async () => {
  const files = unzipSync(
    await exportZip([
      {
        id: 1,
        name: "server.conf",
        text: "[Interface]\nAddress = 10.0.0.1/24",
        format: "conf",
      },
      {
        id: 2,
        name: "phone.conf",
        text: "[Interface]\nAddress = 10.0.0.2/24",
        format: "qr",
      },
      {
        id: 3,
        name: "excluded.conf",
        text: "do not export",
        format: "exclude",
      },
    ]),
  );
  assert.deepEqual(Object.keys(files), ["server.conf", "phone.svg"]);
  assert.match(strFromU8(files["phone.svg"]), /^<svg[^>]+viewBox=/);
  assert.match(strFromU8(files["phone.svg"]), /<path/);
});
test("duplicate and unsafe filenames cannot overwrite each other or create ZIP directories", async () => {
  const files = await exportFiles([
    { id: 1, name: "wg.conf", text: "first", format: "conf" },
    { id: 2, name: "WG.conf", text: "second", format: "conf" },
    { id: 3, name: "../folder/wg.conf", text: "third", format: "conf" },
    { id: 4, name: "__proto__.conf", text: "fourth", format: "conf" },
  ]);
  const names = Object.keys(files);
  assert.equal(names.length, 4);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, 4);
  assert.ok(names.every((name) => !name.includes("/") && !name.includes("\\")));
  assert.deepEqual(
    Object.values(files).map((bytes) => strFromU8(bytes)),
    ["first", "second", "third", "fourth"],
  );
});
test("empty selections and oversized QR payloads fail without producing a partial archive", async () => {
  await assert.rejects(
    exportZip([{ id: 1, name: "wg.conf", text: "config", format: "exclude" }]),
    /at least one/,
  );
  await assert.rejects(
    exportZip([
      { id: 1, name: "large.conf", text: "x".repeat(100000), format: "qr" },
    ]),
    /large.conf:.*\.conf/,
  );
  await assert.rejects(
    exportZip([{ id: 1, name: "empty.conf", text: "", format: "qr" }]),
    /empty.conf:/,
  );
});
