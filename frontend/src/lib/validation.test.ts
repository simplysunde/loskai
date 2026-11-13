import { describe, expect, test } from "vitest";

import {
  isValidSshLogin,
  assembleFqdn,
  isValidDnsOnlyPrefix,
  isValidDnsTarget,
  isValidPrefix,
} from "./validation";

describe("isValidPrefix", () => {
  test("accepts single DNS labels", () => {
    expect(isValidPrefix("grafana")).toBe(true);
    expect(isValidPrefix("uptime-kuma")).toBe(true);
    expect(isValidPrefix("a1")).toBe(true);
  });

  test("rejects invalid labels", () => {
    expect(isValidPrefix("")).toBe(false);
    expect(isValidPrefix("Grafana")).toBe(false); // uppercase
    expect(isValidPrefix("-lead")).toBe(false);
    expect(isValidPrefix("trail-")).toBe(false);
    expect(isValidPrefix("has.dot")).toBe(false); // multi-label
    expect(isValidPrefix("under_score")).toBe(false);
  });
});

test("assembleFqdn joins prefix and base domain", () => {
  expect(assembleFqdn("grafana", "example.no")).toBe("grafana.example.no");
});

describe("isValidDnsOnlyPrefix", () => {
  test("accepts single and multi-label names", () => {
    expect(isValidDnsOnlyPrefix("vm1")).toBe(true);
    expect(isValidDnsOnlyPrefix("rack1.vm3")).toBe(true);
    expect(isValidDnsOnlyPrefix("a.b.c")).toBe(true);
  });

  test("rejects invalid labels in any segment", () => {
    expect(isValidDnsOnlyPrefix("")).toBe(false);
    expect(isValidDnsOnlyPrefix("Has.Upper")).toBe(false);
    expect(isValidDnsOnlyPrefix("rack1.-lead")).toBe(false);
    expect(isValidDnsOnlyPrefix("under_score.vm")).toBe(false);
  });
});

describe("isValidDnsTarget", () => {
  test("accepts a bare IPv4 address", () => {
    expect(isValidDnsTarget("192.168.10.55")).toBe(true);
    expect(isValidDnsTarget("10.0.0.1")).toBe(true);
  });

  test("rejects host:port, hostnames, and out-of-range octets", () => {
    expect(isValidDnsTarget("192.168.10.55:22")).toBe(false); // port
    expect(isValidDnsTarget("grafana")).toBe(false); // not an IP
    expect(isValidDnsTarget("192.168.10.999")).toBe(false); // out of range
    expect(isValidDnsTarget("")).toBe(false);
    expect(isValidDnsTarget("::1")).toBe(false); // IPv6 out of scope
  });
});

test("an SSH login is a user SSH takes and a port, written as digits", () => {
  expect(isValidSshLogin("loskai", "22")).toBe(true);
  expect(isValidSshLogin("loskai", "65535")).toBe(true);
  // Number("1e3") is 1000 — one form once let it through; the port check never did.
  expect(isValidSshLogin("loskai", "1e3")).toBe(false);
  expect(isValidSshLogin("loskai", "0")).toBe(false);
  expect(isValidSshLogin("lo skai", "22")).toBe(false);
});
