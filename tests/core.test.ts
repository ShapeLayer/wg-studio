import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import {
  parse,
  serialize,
  generatePrivateKey,
  decodeKey,
  publicFromPrivate,
  validate,
  newConfig,
} from "../src/core/wireguard.ts";
test("RFC 7748 Alice X25519 public key", async () => {
  const secret = Buffer.from(
    "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
    "hex",
  ).toString("base64");
  assert.equal(
    Buffer.from(await publicFromPrivate(secret), "base64").toString("hex"),
    "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
  );
});
test("wg-compatible clamping and independent OpenSSL public derivation", async () => {
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const privateKey = generatePrivateKey(),
      bytes = decodeKey(privateKey);
    assert.equal(bytes[0] & 7, 0);
    assert.equal(bytes[31] & 128, 0);
    assert.equal(bytes[31] & 64, 64);
    seen.add(privateKey);
    const key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b656e04220420", "hex"),
        bytes,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const pub = createPublicKey(key)
      .export({ format: "der", type: "spki" })
      .subarray(-32)
      .toString("base64");
    assert.equal(await publicFromPrivate(privateKey), pub);
  }
  assert.equal(seen.size, 16);
});
test("import preserves comments, unknown fields, repeated hooks, multiple peers and original formatting", () => {
  const input =
    "# imported\n[Interface]\nPrivateKey = abc # comment\nPostUp = first = command\nPostUp = second\nCustomKey = custom\n\n[Peer]\nPublicKey = test\nAllowedIPs = ::/0, 0.0.0.0/0\n[Peer]\nPublicKey = other\n";
  const model = parse(input);
  assert.equal(serialize(model), input);
  assert.equal(model.sections.length, 3);
  assert.equal(model.sections[0].fields[0].value, "abc");
  const f = model.sections[0].fields[0];
  delete f.original;
  f.value = "changed";
  assert.match(serialize(model), /PrivateKey = changed # comment/);
});
test("malformed plaintext is rejected without silently dropping content", () => {
  assert.throws(() => parse("[Interface]\nnot a field"));
  assert.throws(() => parse("PrivateKey = x"));
  assert.throws(() => parse("[Unknown]\nKey = x"));
});
test("invalid keys rejected; incomplete templates and invalid IPs diagnosed", async () => {
  await assert.rejects(publicFromPrivate("invalid"));
  const m = newConfig();
  assert.ok(validate(m).some((x) => x.includes("PrivateKey")));
  m.sections[0].fields.push({ key: "Address", value: "999.1.2.3/24, ::/129" });
  assert.equal(validate(m).filter((x) => x.includes("CIDR")).length, 2);
});
test("prefix-less Address/AllowedIPs are single hosts, as in wg-quick", () => {
  const m = newConfig();
  m.sections[0].fields.push({ key: "Address", value: "10.0.0.5, fd00::5" });
  assert.equal(validate(m).filter((x) => x.includes("CIDR")).length, 0);
  m.sections[0].fields.push({ key: "Address", value: "10.0.0.5/" });
  assert.equal(validate(m).filter((x) => x.includes("CIDR")).length, 1);
});
test("only a missing X25519 algorithm reports browser support", async () => {
  const subtle = Object.getPrototypeOf(crypto.subtle);
  const original = subtle.importKey;
  const key = generatePrivateKey();
  try {
    subtle.importKey = async () => {
      throw new DOMException("no", "NotSupportedError");
    };
    await assert.rejects(publicFromPrivate(key), /X25519/);
    subtle.importKey = async () => {
      throw new DOMException("bad", "DataError");
    };
    await assert.rejects(
      publicFromPrivate(key),
      (error: Error) => !/X25519/.test(error.message),
    );
  } finally {
    subtle.importKey = original;
  }
});
