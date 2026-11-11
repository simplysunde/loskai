import type { Running } from "../../lib/ssh";
import { suggestPrefix } from "./containerPrefill";
import { isMachine } from "./machine";
import type { RouteRow } from "./ServiceTable";

// One port something listens on, on a machine — a row the Add route picker offers.
export interface MachineService {
  key: string;
  name: string;
  kind: "container" | "service";
  upstream: string;
  prefix: string;
}

export interface MachineGroup {
  machine: RouteRow;
  services: MachineService[];
  // Why some or all of it can't be listed, when that is so.
  note: string | null;
}

// What runs on each machine with SSH set up, as routes to add: one row per container port
// and service port, on the machine's own address. Left out: what already has a route at
// that address and port; a service that listens only on another of its addresses (a
// tailnet's), which Caddy can't reach by this one; and the Docker host's containers, which
// are the Container source, where a route can follow its container. Proxmox guests are
// never offered — they're machines of their own. A machine without SSH set up has no
// running list, so no group.
export function machineServices(
  rows: RouteRow[],
  running: Record<string, Running> | undefined,
  dockerHost: string | null | undefined,
): MachineGroup[] {
  const routed = new Set(rows.filter((r) => !isMachine(r) && r.upstream).map((r) => r.upstream));
  const groups: MachineGroup[] = [];
  for (const machine of rows.filter(isMachine)) {
    const r = running?.[machine.id];
    const address = machine.upstream;
    if (!r || !address) continue;
    if (!r.ok) {
      groups.push({ machine, services: [], note: r.error ?? "Can't be read" });
      continue;
    }
    const services: MachineService[] = [];
    const add = (kind: MachineService["kind"], name: string, port: number) => {
      const upstream = `${address}:${port}`;
      if (!routed.has(upstream)) {
        services.push({ key: `${kind}:${name}:${port}`, name, kind, upstream, prefix: suggestPrefix(name) });
      }
    };
    if (address !== dockerHost) {
      for (const c of r.containers ?? []) for (const port of c.ports ?? []) add("container", c.name, port);
    }
    for (const l of r.listening ?? []) if (l.host === "" || l.host === address) add("service", l.service, l.port);
    services.sort((a, b) => a.name.localeCompare(b.name) || a.upstream.localeCompare(b.upstream));

    let note: string | null = null;
    if (r.listening === null) note = "Its status line is older than its ports — install again in its dialog's SSH setup.";
    else if (r.denied?.includes("ss")) note = "It has no ss (iproute2), which lists the ports its services listen on.";
    else if (r.denied?.includes("listen")) note = "Its SSH user sees only its own services' ports — root, or sudo, sees the rest.";
    groups.push({ machine, services, note });
  }
  return groups;
}
