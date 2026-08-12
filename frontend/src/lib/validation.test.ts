import { describe, expect, test } from "vitest";

import {
  assembleFqdn,
  isValidDnsOnlyPrefix,
  isValidDnsTarget,
  isValidPrefix,
  isValidUpstream,
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

describe("isValidUpstream", () => {
  test("accepts host:port", () => {
    expect(isValidUpstream("192.168.10.100:3000")).toBe(true);
    expect(isValidUpstream("grafana:3000")).toBe(true);
  });

  test("rejects schemes, paths, and bad ports", () => {
    expect(isValidUpstream("https://192.168.10.202:8006/")).toBe(false); // Proxmox footgun
    expect(isValidUpstream("http://grafana:3000")).toBe(false);
    expect(isValidUpstream("grafana:3000/app")).toBe(false);
    expect(isValidUpstream("192.168.10.100")).toBe(false); // no port
    expect(isValidUpstream("grafana:99999")).toBe(false);
    expect(isValidUpstream("grafana:abc")).toBe(false);
    expect(isValidUpstream("")).toBe(false);
  });
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
