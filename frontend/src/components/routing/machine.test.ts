import { expect, test } from "vitest";

import { isMachine, routesOn } from "./machine";
import type { RouteRow } from "./ServiceTable";

function row(over: Partial<RouteRow>): RouteRow {
  return {
    id: "x", name: "x", type: "external", kind: "service", subdomain: "x", fqdn: "x.example.no",
    upstream: "192.168.10.50:3000", private: false, routed: true, synced: true,
    ...over,
  };
}

test("the backend's `kind` decides, not the address shape", () => {
  // A machine that has been given a port-bearing upstream is a service, whatever it looks
  // like — the record says so, and the record is what the backend reads.
  expect(isMachine(row({ upstream: "192.168.10.50", kind: "service" }))).toBe(false);
  expect(isMachine(row({ upstream: "192.168.10.50", kind: "machine" }))).toBe(true);
});


test("the routes on a machine are the services on its address", () => {
  const nas = row({ id: "nas", upstream: "192.168.10.50", kind: "machine" });
  const rows = [
    nas,
    row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400" }),
    row({ id: "near", name: "near", upstream: "192.168.10.5:8080" }), // a prefix, not it
    row({ id: "files", name: "files", upstream: "192.168.10.50:5000" }),
  ];
  expect(routesOn(nas, rows).map((r) => r.id)).toEqual(["files", "plex"]);
  expect(routesOn(row({ id: "vm", upstream: "192.168.10.60", kind: "machine" }), rows)).toEqual([]);
});
