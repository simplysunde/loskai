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
  // The compose project — the stack's name — when compose started it.
  project?: string | null;
}

// Compose names a container `<stack>-<service>-<n>`, so `whoami-whoami-1`. When it is its
// stack's only container, the stack's name is the one people know it by; with several, it
// would not say which, so the container's own name stays.
export function containerLabel(c: PrefillSource, all: PrefillSource[]): string {
  if (c.project && all.filter((o) => o.project === c.project).length === 1) return c.project;
  return c.name;
}

export function suggestPrefix(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

export function containerPrefill(
  c: PrefillSource,
  all: PrefillSource[] = [],
): { prefix: string; upstream: string } {
  return {
    // Cleaned too: a recipe id is just a folder name, so it can be `home_assistant`.
    prefix: suggestPrefix(c.instance_id ?? containerLabel(c, all)),
    // Trailing colon when only the host is known — the machine picker's convention: the
    // port is all that's left to type.
    upstream: c.suggested_upstream ?? (c.suggested_host ? `${c.suggested_host}:` : ""),
  };
}
