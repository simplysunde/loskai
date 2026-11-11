import type { Guest, Running } from "../../lib/ssh";
import { suggestPrefix } from "./containerPrefill";
import { isMachine } from "./machine";
import type { RouteRow } from "./ServiceTable";

// One port something listens on, on a machine — a row the Add route picker offers, and a
// button on the machine's running list.
export interface MachineService {
  key: string;
  name: string;
  kind: "container" | "service";
  upstream: string;
  prefix: string;
  // The route already at this address and port, if there is one.
  route: RouteRow | null;
}

export interface MachineGroup {
  machine: RouteRow;
  services: MachineService[];
  // Why some or all of it can't be listed, when that is so.
  note: string | null;
}

// Every port on one machine, on its own address, routed or not: one per container port and
// service port. Left out: a service that listens only on another of its addresses (a
// tailnet's), which Caddy can't reach by this one; and the Docker host's containers, which
// are the Container source, where a route can follow its container. Proxmox guests are
// never offered — they're machines of their own.
export function servicesOn(
  machine: RouteRow,
  r: Running | undefined,
  rows: RouteRow[],
  dockerHost: string | null | undefined,
): MachineService[] {
  const address = machine.upstream;
  if (!r?.ok || !address) return [];
  const routes = new Map(rows.filter((x) => !isMachine(x) && x.upstream).map((x) => [x.upstream, x]));
  const services: MachineService[] = [];
  const add = (kind: MachineService["kind"], name: string, port: number) => {
    const upstream = `${address}:${port}`;
    const route = routes.get(upstream) ?? null;
    services.push({ key: `${kind}:${name}:${port}`, name, kind, upstream, prefix: suggestPrefix(name), route });
  };
  if (address !== dockerHost) {
    for (const c of r.containers ?? []) for (const port of c.ports ?? []) add("container", c.name, port);
  }
  for (const l of r.listening ?? []) if (l.host === "" || l.host === address) add("service", l.service, l.port);
  return services.sort((a, b) => a.name.localeCompare(b.name) || a.upstream.localeCompare(b.upstream));
}

// What runs on each machine with SSH set up, as routes to add: what `servicesOn` lists,
// less what already has a route. A machine without SSH set up has no running list, so no
// group.
export function machineServices(
  rows: RouteRow[],
  running: Record<string, Running> | undefined,
  dockerHost: string | null | undefined,
): MachineGroup[] {
  const groups: MachineGroup[] = [];
  for (const machine of rows.filter(isMachine)) {
    const r = running?.[machine.id];
    if (!r || !machine.upstream) continue;
    if (!r.ok) {
      groups.push({ machine, services: [], note: r.error ?? "Can't be read" });
      continue;
    }
    const services = servicesOn(machine, r, rows, dockerHost).filter((s) => !s.route);
    let note: string | null = null;
    if (r.listening === null) note = "Its status line is older than its ports — install again in its dialog's SSH setup.";
    else if (r.denied?.includes("ss")) note = "It has no ss (iproute2), which lists the ports its services listen on.";
    else if (r.denied?.includes("listen")) note = "Its SSH user sees only its own services' ports — root, or sudo, sees the rest.";
    groups.push({ machine, services, note });
  }
  return groups;
}

// The machine a Proxmox guest already is: one named at any of its addresses.
export function guestMachine(guest: Guest, rows: RouteRow[]): RouteRow | null {
  const addresses = guest.addresses ?? [];
  return rows.find((r) => isMachine(r) && r.upstream !== null && addresses.includes(r.upstream)) ?? null;
}

// The address to name a guest by: the one on its host's network (the same /24), else its
// first — an LXC running Docker has a bridge address too. "" when Loskai knows none.
export function guestAddress(guest: Guest, hostAddress: string | null): string {
  const addresses = guest.addresses ?? [];
  const net = (a: string) => a.split(".").slice(0, 3).join(".");
  return addresses.find((a) => hostAddress && net(a) === net(hostAddress)) ?? addresses[0] ?? "";
}

// A guest's name as a hostname: "NAS" → "nas", "Home Assistant" → "home-assistant".
export function guestHostname(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
