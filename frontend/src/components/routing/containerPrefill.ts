// What a container pre-fills in a route form. Shared by the two ways to route one — the
// "Add route" picker and a Routing row's "Assign a URL" — which used to disagree: the
// picker asked Docker, the row read only the stored record, so a freshly installed recipe
// (linked, never routed, no upstream stored) opened the row form empty.

// The slice of GET /api/docker/containers this reads. Optional fields so a cached payload
// from an older backend still renders.
export interface PrefillSource {
  name: string;
  suggested_upstream?: string | null;
  // The host half, known even when the port is not (host networking, several published
  // ports): the Docker host's IP, or the service name when Caddy shares the network.
  suggested_host?: string | null;
  // The linked instance's id — for a recipe install, the recipe's own name.
  instance_id?: string | null;
}

export function suggestPrefix(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

export function containerPrefill(c: PrefillSource): { prefix: string; upstream: string } {
  return {
    prefix: c.instance_id ?? suggestPrefix(c.name),
    // Trailing colon when only the host is known — the machine picker's convention: the
    // port is all that's left to type.
    upstream: c.suggested_upstream ?? (c.suggested_host ? `${c.suggested_host}:` : ""),
  };
}
