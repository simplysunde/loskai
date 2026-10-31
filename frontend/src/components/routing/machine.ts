import { splitUpstream } from "../../lib/validation";
import type { RouteRow } from "./ServiceTable";

/** A machine is an address rather than a service — the thing routes sit on. Declared by
 *  the backend on the record (`kind`), not re-derived here: one rule, one place. The
 *  upstream-shape fallback is only for a row from a build older than that field. */
export function isMachine(row: RouteRow): boolean {
  if (row.kind) return row.kind === "machine";
  return Boolean(row.upstream) && !row.upstream!.includes(":");
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
