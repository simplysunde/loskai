import { splitUpstream } from "../../lib/validation";
import type { RouteRow } from "./ServiceTable";

/** A machine is an address rather than a service — the thing routes sit on. Declared by
 *  the backend on the record (`kind`), not re-derived here: one rule, one place. */
export function isMachine(row: RouteRow): boolean {
  return row.kind === "machine";
}

// A machine's full name, so nothing shown is a partial one (a dotted `adguard.lxc`
// resolves only with the base domain on), or its plain name when it has none.
export function machineLabel(machine: RouteRow): string {
  return machine.fqdn ?? machine.name;
}

// The machine at an upstream's host. Nothing is stored: a machine's only identity on the
// network is its address, so a route on that address is on that machine — and moves with it.
export function machineAt(upstream: string | null, rows: RouteRow[]): RouteRow | undefined {
  const host = upstream ? splitUpstream(upstream).host : "";
  return host ? rows.find((r) => isMachine(r) && r.upstream === host) : undefined;
}

// The routes on a machine — read off the rows already fetched, no extra request.
export function routesOn(machine: RouteRow, rows: RouteRow[]): RouteRow[] {
  return rows
    .filter((r) => !isMachine(r) && machineAt(r.upstream, [machine]))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The Docker host, listed before anyone names it — the way a fresh install is on Routing
// before it has a URL. Read from Settings' Docker host IP each time, never stored: naming
// it makes it a machine like any other, and then this row is gone. Its id can't be an
// instance's.
export const DOCKER_HOST_ID = ":docker-host";

export function unnamedDockerHost(hostIp: string | null | undefined, machines: RouteRow[]): RouteRow | null {
  if (!hostIp || machines.some((m) => m.upstream === hostIp)) return null;
  return {
    id: DOCKER_HOST_ID, name: "Docker host", type: "external", kind: "machine", subdomain: null,
    fqdn: null, upstream: hostIp, private: false, routed: false, synced: null,
  };
}
