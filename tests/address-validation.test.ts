import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAddressAssignments,
  workspaceAddressWarnings,
} from "../src/core/address-validation.ts";
import { parse, serialize, validate } from "../src/core/wireguard.ts";
const model = (address: string, peers: string[]) =>
  parse(
    `[Interface]\nAddress = ${address}\n` +
      peers.map((value) => `[Peer]\nAllowedIPs = ${value}\n`).join(""),
  );

test("duplicate peer host assignments enter normal validation with peer numbers and addresses", () => {
  const config = model("192.168.56.1/24", [
    "192.168.56.2/32",
    "192.168.56.2/32",
  ]);
  assert.match(
    validateAddressAssignments(config)[0],
    /Peer 1 and Peer 2.*192\.168\.56\.2\/32/,
  );
  assert.ok(
    validate(config).some((issue) =>
      /duplicate peer IP allocation/.test(issue),
    ),
  );
  const before = serialize(config);
  validate(config);
  assert.equal(serialize(config), before);
  config.sections[2].fields[0].value = "192.168.56.3/32";
  assert.deepEqual(validateAddressAssignments(config), []);
});

test("peer addresses matching Interface hosts or outside its subnets are explained separately", () => {
  const issues = validateAddressAssignments(
    model("192.168.56.1/24", ["192.168.56.1/32", "10.0.0.2/32"]),
  );
  assert.equal(issues.length, 2);
  assert.match(issues[0], /Peer 1.*192\.168\.56\.1.*this Interface/);
  assert.match(issues[1], /Peer 2.*10\.0\.0\.2\/32.*outside.*intentional/);
});

test("IPv6 canonicalization finds equal host assignments across alternate text forms", () => {
  const issues = validateAddressAssignments(
    model("fd00::1/64", ["fd00::2/128", "fd00:0:0:0:0:0:0:2/128"]),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /fd00::2\/128/);
});

test("network and broadcast addresses warn while /31 point-to-point hosts remain valid", () => {
  assert.equal(
    validateAddressAssignments(
      model("10.0.0.1/24", ["10.0.0.0/32", "10.0.0.255/32"]),
    ).filter((issue) => issue.includes("network or broadcast")).length,
    2,
  );
  assert.deepEqual(
    validateAddressAssignments(model("10.0.0.0/31", ["10.0.0.1/32"])),
    [],
  );
});

test("default routes and intentional longest-prefix routing do not imply duplicate host allocation", () => {
  assert.deepEqual(
    validateAddressAssignments(
      model("10.0.0.1/24, fd00::1/64", [
        "0.0.0.0/0, ::/0",
        "10.0.0.2/32, fd00::2/128",
      ]),
    ),
    [],
  );
  const duplicate = validateAddressAssignments(
    model("10.0.0.1/24", ["172.20.1.1/24", "172.20.1.2/24"]),
  );
  assert.equal(duplicate.length, 1);
  assert.match(duplicate[0], /172\.20\.1\.0\/24/);
});

test("workspace warnings name the conflicting profile, ignore invalid sources and disappear after correction", () => {
  const current = {
    id: 1,
    name: "server.conf",
    model: model("10.0.0.1/24, fd00::1/64", []),
  };
  const other = {
    id: 2,
    name: "client.conf",
    model: model("fd00:0:0:0:0:0:0:1/64", []),
  };
  assert.match(
    workspaceAddressWarnings(current, [current, other])[0],
    /fd00::1.*client\.conf/,
  );
  assert.deepEqual(
    workspaceAddressWarnings(current, [
      current,
      { ...other, error: "Invalid syntax" },
    ]),
    [],
  );
  other.model.sections[0].fields[0].value = "fd00::2/64";
  assert.deepEqual(workspaceAddressWarnings(current, [current, other]), []);
});

test("malformed address values remain the responsibility of existing syntax validation", () => {
  assert.deepEqual(
    validateAddressAssignments(model("bad/24", ["not-an-ip"])),
    [],
  );
  assert.ok(
    validate(model("bad/24", ["not-an-ip"])).some((issue) =>
      issue.includes("CIDR"),
    ),
  );
});
