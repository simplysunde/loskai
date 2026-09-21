import { expect, test } from "vitest";

import { applyView, isMachine } from "./ViewFilter";
import type { RouteRow } from "./ServiceTable";

function row(over: Partial<RouteRow>): RouteRow {
  return {
    id: "x", name: "x", type: "external", subdomain: "x", fqdn: "x.example.no",
    upstream: "192.168.10.50:3000", private: false, routed: true, synced: true,
    upstream_healthy: true, ...over,
  };
}

const nas = row({ id: "nas", name: "nas", upstream: "192.168.10.50", route_mode: "dns_only" });
const vm = row({ id: "vm", name: "vm", upstream: "192.168.10.60", route_mode: "dns_only" });
const plex = row({ id: "plex", name: "plex", upstream: "192.168.10.50:32400", machine: "nas" });
const files = row({ id: "files", name: "files", upstream: "192.168.10.50:5000", machine: "nas" });
const loose = row({ id: "loose", name: "loose", upstream: "192.168.10.99:8080" });
const ALL = [plex, nas, loose, files, vm];

test("a machine is an address, a service has a port", () => {
  expect(isMachine(nas)).toBe(true);
  expect(isMachine(plex)).toBe(false);
});

test("the default view keeps both kinds together", () => {
  expect(applyView(ALL, "all").map((r) => r.id)).toEqual([
    "files", "loose", "nas", "plex", "vm",
  ]);
});

test("services and machines views exclude the other kind", () => {
  expect(applyView(ALL, "services").map((r) => r.id)).toEqual(["files", "loose", "plex"]);
  expect(applyView(ALL, "machines").map((r) => r.id)).toEqual(["nas", "vm"]);
});

test("grouped puts each machine above what runs on it", () => {
  expect(applyView(ALL, "grouped").map((r) => r.id)).toEqual([
    "nas", "files", "plex", // the NAS and its two services
    "vm", //                   a machine hosting nothing still appears
    "loose", //                a service on no machine is not dropped
  ]);
});

test("no view ever loses a row", () => {
  const all = applyView(ALL, "all").length;
  const grouped = applyView(ALL, "grouped").length;
  const split =
    applyView(ALL, "services").length + applyView(ALL, "machines").length;
  expect(all).toBe(ALL.length);
  expect(grouped).toBe(ALL.length);
  expect(split).toBe(ALL.length);
});

test("the backend's `kind` decides, not the address shape", () => {
  // A machine that has been given a port-bearing upstream is a service, whatever it looks
  // like — the record says so, and the record is what the backend links against.
  const declared = row({ id: "odd", upstream: "192.168.10.50", kind: "service" });
  expect(isMachine(declared)).toBe(false);
  expect(isMachine(row({ id: "m", upstream: "192.168.10.50", kind: "machine" }))).toBe(true);
});

test("a row from before `kind` still sorts correctly", () => {
  // Old build, no field on the row: fall back to the rule that used to be inferred.
  expect(isMachine(row({ id: "old", upstream: "192.168.10.50" }))).toBe(true);
  expect(isMachine(row({ id: "old2", upstream: "192.168.10.50:80" }))).toBe(false);
});
