import type { RouteRow } from "./ServiceTable";
import { isMachine } from "./machine";

// What the route forms' host dropdown offers. Machines first — picking one links the route
// to it, so the route follows the machine's address — then the Docker host and the picked
// container's own host where those aren't already a machine's address.
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
  const options: HostOption[] = rows
    .filter((r) => isMachine(r) && r.upstream)
    .map((m) => ({ address: m.upstream as string, label: m.name, machine: m.id }));
  const add = (address: string | null | undefined, label: string) => {
    if (address && !options.some((o) => o.address === address)) options.push({ address, label });
  };
  add(dockerHost, "Docker host");
  // On a shared Docker network this is the service name; off it, the Docker host again —
  // which the line above has already added.
  add(containerHost, "This container");
  return options;
}
