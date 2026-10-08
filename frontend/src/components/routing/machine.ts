import { splitUpstream } from "../../lib/validation";
import type { RouteRow } from "./ServiceTable";

/** A machine is an address rather than a service — the thing routes link to via `machine`.
 *  Declared by the backend on the record (`kind`), not re-derived here: one rule, one place.
 *  The upstream-shape fallback is only for a row from a build older than that field. */
export function isMachine(row: RouteRow): boolean {
  if (row.kind) return row.kind === "machine";
  return Boolean(row.upstream) && !row.upstream!.includes(":");
}

// The link is stored by instance id, which never changes — but the id is the name the
// machine was *created* under. Renaming it would otherwise leave every route tagged with a
// name the machine no longer answers to, so resolve to what it is called now: its full name,
// so nothing shown is a partial one (a dotted `adguard.lxc` resolves only with the base
// domain on), or its plain name when it has none.
export function machineLabel(machineId: string, rows: RouteRow[]): string {
  const machine = rows.find((r) => r.id === machineId);
  return machine ? (machine.fqdn ?? machine.name) : machineId;
}

// Routes hosted on a machine — read off the rows already fetched, no extra request.
export function dependentsOf(machineId: string, rows: RouteRow[]): RouteRow[] {
  return rows
    .filter((r) => r.machine === machineId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The machine whose address an unlinked upstream's host is — display only. Matching never
// links the route (that stays a choice in the form); it just shows whose address this is.
export function machineAt(upstream: string | null, rows: RouteRow[]): RouteRow | undefined {
  const host = upstream ? splitUpstream(upstream).host : "";
  return host ? rows.find((r) => isMachine(r) && r.upstream === host) : undefined;
}

// The other half of `machineAt`: unlinked routes whose host is this machine's address.
// They sit on it today but keep their address if it moves — unlike `dependentsOf`.
export function onAddressOf(machine: RouteRow, rows: RouteRow[]): RouteRow[] {
  return rows
    .filter((r) => !r.machine && !isMachine(r) && machineAt(r.upstream, [machine]))
    .sort((a, b) => a.name.localeCompare(b.name));
}
