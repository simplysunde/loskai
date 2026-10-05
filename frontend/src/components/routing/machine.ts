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
// name the machine no longer answers to, so resolve to what it is called now.
export function machineLabel(machineId: string, rows: RouteRow[]): string {
  const machine = rows.find((r) => r.id === machineId);
  return machine?.name ?? machineId;
}

// Routes hosted on a machine — read off the rows already fetched, no extra request.
export function dependentsOf(machineId: string, rows: RouteRow[]): RouteRow[] {
  return rows
    .filter((r) => r.machine === machineId)
    .sort((a, b) => a.name.localeCompare(b.name));
}
