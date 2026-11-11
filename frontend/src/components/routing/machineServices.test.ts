import { expect, test } from "vitest";

import type { Running } from "../../lib/ssh";
import { machineServices } from "./machineServices";
import type { RouteRow } from "./ServiceTable";

const row = (r: Partial<RouteRow>): RouteRow => ({
  id: "x", name: "x", type: "external", subdomain: null, fqdn: null, upstream: null,
  private: false, routed: false, synced: null, ...r,
});
const nas = row({ id: "nas", name: "nas", kind: "machine", upstream: "192.168.10.50" });
const dockerHost = row({ id: "dh", name: "docker", kind: "machine", upstream: "192.168.10.220" });
const ok = (r: Partial<Running>): Running => ({ ok: true, checked: 0, containers: [], listening: [], denied: [], ...r });

test("one row per port, on the machine's address, without what is already routed", () => {
  const rows = [nas, row({ id: "plex", kind: "service", subdomain: "plex", routed: true, upstream: "192.168.10.50:32400" })];
  const [g] = machineServices(rows, {
    nas: ok({
      containers: [{ name: "plex", image: "plex", status: "Up", ports: [32400] }, { name: "web", image: "nginx", status: "Up", ports: [8080, 8443] }],
      listening: [
        { service: "pveproxy", port: 8006, host: "" },
        { service: "nginx", port: 80, host: "192.168.10.50" },
        // Only on its tailnet address: Caddy can't reach it by the machine's.
        { service: "tsweb", port: 9000, host: "100.64.0.1" },
      ],
    }),
  }, "192.168.10.220");

  expect(g.services.map((s) => `${s.name} ${s.upstream} ${s.kind}`)).toEqual([
    "nginx 192.168.10.50:80 service",
    "pveproxy 192.168.10.50:8006 service",
    "web 192.168.10.50:8080 container",
    "web 192.168.10.50:8443 container",
  ]);
  expect(g.note).toBeNull();
});

test("the Docker host's containers stay the Container source's; its services are listed", () => {
  const [g] = machineServices([dockerHost], {
    dh: ok({
      containers: [{ name: "jellyfin", image: "j", status: "Up", ports: [8096] }],
      listening: [{ service: "cockpit", port: 9090, host: "" }],
    }),
  }, "192.168.10.220");

  expect(g.services.map((s) => s.name)).toEqual(["cockpit"]);
});

test("a machine says why its services' ports are missing", () => {
  const other = row({ id: "ha", name: "ha", kind: "machine", upstream: "192.168.10.30" });
  const groups = machineServices([nas, dockerHost, other], {
    nas: ok({ listening: null }),
    dh: ok({ denied: ["listen"] }),
    // No ss to list them with: an empty list must not read as "nothing listens".
    ha: ok({ denied: ["ss"] }),
  }, null);

  expect(groups.map((g) => g.note)).toEqual([
    expect.stringContaining("install again"),
    expect.stringContaining("root, or sudo"),
    expect.stringContaining("no ss"),
  ]);
});

test("an unreachable machine is a group with its error; one without SSH has none", () => {
  const other = row({ id: "ha", name: "ha", kind: "machine", upstream: "192.168.10.30" });
  const groups = machineServices([nas, other], { nas: { ok: false, checked: 0, error: "Can't reach it" } }, null);

  expect(groups).toEqual([{ machine: nas, services: [], note: "Can't reach it" }]);
});


test("a port is taken by a route or a link, not by a record whose route was removed", () => {
  const listening = [
    { service: "hass", port: 8123, host: "" },
    { service: "grafana", port: 3000, host: "" },
    { service: "nodered", port: 1880, host: "" },
  ];
  const rows = [
    nas,
    // Routed once, then Remove route: the record keeps its address, serving nothing there.
    row({ id: "hass", kind: "service", upstream: "192.168.10.50:8123" }),
    row({ id: "graf", kind: "service", route_mode: "direct", upstream: "192.168.10.50:3000" }),
    row({ id: "red", kind: "service", subdomain: "red", routed: true, upstream: "192.168.10.50:1880" }),
  ];
  const [g] = machineServices(rows, { nas: ok({ listening }) }, "192.168.10.220");

  expect(g.services.map((s) => s.name)).toEqual(["hass"]);
});
