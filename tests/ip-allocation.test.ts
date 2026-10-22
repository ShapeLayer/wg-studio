import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateInterfaceAddress,
  allocatePeerAddresses,
} from "../src/core/ip-allocation.ts";
import { parse, serialize } from "../src/core/wireguard.ts";

const config = (addresses: string, peers: string[] = []) =>
  parse(
    `[Interface]\nAddress = ${addresses}\n` +
      peers.map((ip) => `[Peer]\nAllowedIPs = ${ip}\n`).join(""),
  );

test("imported subnet and occupied peer host/CIDR ranges replace the old fixed .2 default", () => {
  const source = config("192.168.50.1/24", [
    "192.168.50.2/32",
    "192.168.50.3/32",
    "192.168.50.4/30",
  ]);
  const before = serialize(source);
  assert.deepEqual(allocatePeerAddresses(source), [
    { address: "192.168.50.8/24", allowedIP: "192.168.50.8/32" },
  ]);
  assert.equal(serialize(source), before);
});

test("all local Interface addresses and open profiles reserve their actual hosts", () => {
  const source = config("172.20.3.1/24, 172.20.3.2/24", ["172.20.3.3/32"]);
  source.sections[0].fields.push({ key: "Address", value: "172.20.3.4/24" });
  const remote = config("172.20.3.5/24", ["172.20.3.6/32"]);
  assert.deepEqual(allocatePeerAddresses(source, [remote]), [
    { address: "172.20.3.7/24", allowedIP: "172.20.3.7/32" },
  ]);
});

test("new profile reuses its selected peer's free host reservation instead of skipping it", () => {
  const source = config("10.10.0.1/24", ["10.10.0.2/32", "10.10.0.9/32"]);
  assert.equal(
    allocatePeerAddresses(source, [], 2)[0].allowedIP,
    "10.10.0.9/32",
  );
  const remote = config("10.10.0.9/24");
  assert.equal(
    allocatePeerAddresses(source, [remote], 2)[0].allowedIP,
    "10.10.0.3/32",
  );
});

test("dual-stack allocation compares equivalent IPv6 forms and skips reserved ranges", () => {
  const source = config("10.7.0.1/24, fd12::1/64", ["fd12::2/127"]);
  const remote = config("fd12:0:0:0:0:0:0:4/64");
  assert.deepEqual(allocatePeerAddresses(source, [remote]), [
    { address: "10.7.0.2/24", allowedIP: "10.7.0.2/32" },
    { address: "fd12::5/64", allowedIP: "fd12::5/128" },
  ]);
});

test("full subnets fail without selecting broadcast, occupied or out-of-subnet addresses", () => {
  assert.throws(
    () => allocatePeerAddresses(config("10.4.0.1/30", ["10.4.0.2/32"])),
    /10\.4\.0\.0\/30/,
  );
  assert.throws(
    () => allocatePeerAddresses(config("10.4.0.1/32")),
    /10\.4\.0\.1\/32/,
  );
  assert.throws(
    () => allocatePeerAddresses(config("fd00::1/128")),
    /fd00::1\/128/,
  );
});

test("large routed ranges exhaust a subnet without scanning every address", () => {
  assert.throws(
    () => allocatePeerAddresses(config("10.0.0.1/8", ["0.0.0.0/0"])),
    /10\.0\.0\.0\/8/,
  );
  assert.throws(
    () => allocatePeerAddresses(config("fd00::1/64", ["::/0"])),
    /fd00::\/64/,
  );
});

test("IPv4 /31 and IPv6 /127 point-to-point networks retain their second address", () => {
  assert.equal(
    allocatePeerAddresses(config("10.0.0.0/31"))[0].allowedIP,
    "10.0.0.1/32",
  );
  assert.equal(
    allocatePeerAddresses(config("fd00::/127"))[0].allowedIP,
    "fd00::1/128",
  );
});

test("missing and invalid Interface addresses do not silently fall back to 10.0.0.2", () => {
  assert.throws(() =>
    allocatePeerAddresses(parse("[Interface]\nPrivateKey = ")),
  );
  for (const address of ["bad/24", "10.0.0.1/33", "10.0.0.1", "fd00::1/129"]) {
    assert.throws(() => allocatePeerAddresses(config(address)));
  }
});

test("batch Interface allocation ignores full-tunnel routes but skips hosts and in-pool peer routes", () => {
  const server = config("10.0.0.1/24", ["10.0.0.2/32"]);
  const client = config("10.0.0.2/24", ["0.0.0.0/0"]);
  assert.equal(allocateInterfaceAddress([server, client]), "10.0.0.3/24");
  const routed = config("10.0.0.1/24", ["10.0.0.4/30"]);
  const hosts = ["10.0.0.2/24", "10.0.0.3/24"].map((a) => config(a));
  assert.equal(allocateInterfaceAddress([routed, ...hosts]), "10.0.0.8/24");
});

test("batch Interface allocation never hands out the IPv4 broadcast address", () => {
  const models = Array.from({ length: 254 }, (_, i) =>
    config(`10.0.0.${i + 1}/24`),
  );
  assert.throws(() => allocateInterfaceAddress(models), /10\.0\.0\.0\/24/);
  assert.equal(allocateInterfaceAddress(models.slice(1)), "10.0.0.1/24");
});
