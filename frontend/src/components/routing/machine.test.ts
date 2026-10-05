import { expect, test } from "vitest";

import { dependentsOf, isMachine } from "./machine";
import type { RouteRow } from "./ServiceTable";

function row(over: Partial<RouteRow>): RouteRow {
  return {
    id: "x", name: "x", type: "external", subdomain: "x", fqdn: "x.example.no",
    upstream: "192.168.10.50:3000", private: false, routed: true, synced: true,
    upstream_healthy: true, ...over,
  };
}

test("the backend's `kind` decides, not the address shape", () => {
  // A machine that has been given a port-bearing upstream is a service, whatever it looks
  // like — the record says so, and the record is what the backend links against.
  expect(isMachine(row({ upstream: "192.168.10.50", kind: "service" }))).toBe(false);
  expect(isMachine(row({ upstream: "192.168.10.50", kind: "machine" }))).toBe(true);
});

test("a row from before `kind` falls back to the address shape", () => {
  expect(isMachine(row({ upstream: "192.168.10.50" }))).toBe(true);
  expect(isMachine(row({ upstream: "192.168.10.50:80" }))).toBe(false);
});

test("a machine's dependents are the rows linked to it, by name", () => {
  const rows = [
    row({ id: "plex", name: "plex", machine: "nas" }),
    row({ id: "loose", name: "loose" }),
    row({ id: "files", name: "files", machine: "nas" }),
  ];
  expect(dependentsOf("nas", rows).map((r) => r.id)).toEqual(["files", "plex"]);
  expect(dependentsOf("vm", rows)).toEqual([]);
});
