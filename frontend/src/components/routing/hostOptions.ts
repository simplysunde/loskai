import type { RouteRow } from "./ServiceTable";
import { isMachine } from "./machine";

// What the route forms' host field offers. Machines go to its Machine mode — picking one
// links the route to it, so the route follows the machine's address. The Docker host and
// the picked container's own host go to its Address mode's dropdown.
export interface HostOption {
  address: string;
  label: string;
  // Set for a named machine: picking it links the route (`machine` on the instance).
  machine?: string;
}

export function hostOptions({
  rows = [],
  dockerHost,
  containerHost,
}: {
  rows?: RouteRow[];
  dockerHost?: string | null;
  containerHost?: string | null;
}): HostOption[] {
  const machines: HostOption[] = rows
    .filter((r) => isMachine(r) && r.upstream)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({ address: m.upstream as string, label: m.name, machine: m.id }));
  // Deduplicated among themselves only: the two modes are separate lists, so the Docker
  // host stays in Address mode even when a machine shares its IP.
  const addresses: HostOption[] = [];
  const add = (address: string | null | undefined, label: string) => {
    if (address && !addresses.some((o) => o.address === address)) addresses.push({ address, label });
  };
  add(dockerHost, "Docker host");
  // On a shared Docker network this is the service name; off it, the Docker host again —
  // which the line above has already added.
  add(containerHost, "This container");
  return [...machines, ...addresses];
}
