import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// One row of GET /api/docker/containers — the one type for the ["docker-containers"] cache
// entry, which the Docker tab, both route forms and the install wizard all read.
export interface Container {
  id: string;
  name: string;
  image: string;
  // The compose project; null for a plain `docker run`.
  project?: string | null;
  // The folder compose was run from (a host path) — null when compose didn't start it.
  compose_dir?: string | null;
  // The container Loskai itself runs in — shown apart, never grouped.
  self?: boolean;
  status: string;
  uptime: number | null;
  ports: string[];
  subdomain: string | null;
  scheme?: "https" | "both" | "http" | null;
  suggested_upstream: string | null;
  // The host half, known even when the port is not (host networking, several published
  // ports): the Docker host's IP, or the service name when Caddy shares the network.
  suggested_host?: string | null;
  // How Caddy must dial this container, from the networks the two share (backend-decided).
  upstream_mode?: "docker" | "lan" | null;
  // The linked instance's id, routed or not — for a recipe install, the recipe's own name.
  instance_id?: string | null;
  // Not in the list itself: merged in from /containers/stats, which answers ~2s later.
  cpu?: number | null;
  mem?: { percent: number | null } | null;
}

// `poll`: the Docker tab keeps the list fresh; a form only needs it once. `retry: false`
// keeps a down Docker daemon from holding up the page that asks.
export function useContainers({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => api.get<Container[]>("/api/docker/containers"),
    refetchInterval: poll ? 5_000 : undefined,
    retry: false,
    enabled,
  });
}
