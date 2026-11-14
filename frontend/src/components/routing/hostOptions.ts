import type { Instance } from "./ServiceTable";
import { isMachine } from "./machine";

// What the route forms' host dropdown offers: the Docker host, the picked container's own
// host, and the named machines. Each is only an address — picking one types it in.
export interface HostOption {
  address: string;
  label: string;
}

export function hostOptions({
  rows = [],
  dockerHost,
  containerHost,
}: {
  rows?: Instance[];
  dockerHost?: string | null;
  containerHost?: string | null;
}): HostOption[] {
  const options: HostOption[] = [];
  // One entry per address; a second name for it joins the label (the Docker host is often
  // a named machine too).
  const add = (address: string | null | undefined, label: string) => {
    if (!address) return;
    const known = options.find((o) => o.address === address);
    if (known) known.label = `${known.label} · ${label}`;
    else options.push({ address, label });
  };
  add(dockerHost, "Docker host");
  // On a shared Docker network this is the service name; off it, the Docker host again.
  add(containerHost, "This container");
  rows
    .filter((r) => isMachine(r) && r.upstream)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((m) => add(m.upstream, m.name));
  return options;
}
