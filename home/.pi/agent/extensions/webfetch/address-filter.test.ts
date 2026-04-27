import { describe, expect, test } from "bun:test";
import { isBlockedHostname, isNonGlobalAddress } from "./address-filter.js";

const expectAddressBlocked = (addresses: readonly string[]): void => {
  for (const address of addresses) {
    expect([address, isNonGlobalAddress(address)]).toEqual([address, true]);
  }
};

const expectAddressAllowed = (addresses: readonly string[]): void => {
  for (const address of addresses) {
    expect([address, isNonGlobalAddress(address)]).toEqual([address, false]);
  }
};

describe("webfetch address filtering", () => {
  test("blocks non-public IPv4 ranges", () => {
    expectAddressBlocked([
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ]);
  });

  test("blocks non-public IPv6 ranges", () => {
    expectAddressBlocked([
      "::",
      "::1",
      "::7f00:1",
      "64:ff9b::c000:201",
      "64:ff9b:1::1",
      "100::1",
      "2001::1",
      "2001:2::1",
      "2001:10::1",
      "2001:20::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "febf::1",
      "ff02::1",
    ]);
  });

  test("blocks IPv4-mapped IPv6 addresses for non-public IPv4 ranges", () => {
    expectAddressBlocked([
      "::ffff:0:1",
      "::ffff:a00:1",
      "::ffff:6440:1",
      "::ffff:7f00:1",
      "::ffff:a9fe:1",
      "::ffff:ac10:1",
      "::ffff:ac1f:ffff",
      "::ffff:c000:1",
      "::ffff:c000:201",
      "::ffff:c058:6301",
      "::ffff:c0a8:101",
      "::ffff:c612:1",
      "::ffff:c633:6401",
      "::ffff:cb00:7101",
      "::ffff:e000:1",
      "::ffff:f000:1",
    ]);
  });

  test("allows public IPv4, IPv6, and IPv4-mapped IPv6 addresses", () => {
    expectAddressAllowed([
      "1.1.1.1",
      "8.8.8.8",
      "93.184.216.34",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
      "::ffff:101:101",
      "::ffff:808:808",
    ]);
  });

  test("blocks localhost names and canonicalized IPv4-mapped IPv6 URL hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("api.localhost")).toBe(true);
    expect(isBlockedHostname("api.local")).toBe(true);
    expect(isBlockedHostname("api.localdomain")).toBe(true);
    expect(isBlockedHostname(new URL("http://[::ffff:127.0.0.1]").hostname)).toBe(true);
    expect(isBlockedHostname(new URL("http://[::ffff:192.168.1.1]").hostname)).toBe(true);
  });
});
