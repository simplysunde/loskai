export interface Container {
  id: string;
  name: string;
  image: string;
  // The compose project — a managed stack's folder name; null for a plain `docker run`.
  project?: string | null;
  status: string;
  uptime: number | null;
  ports: string[];
  subdomain: string | null;
  scheme?: "https" | "both" | "http" | null;
  suggested_upstream: string | null;
  cpu: number | null;
  mem: { percent: number | null } | null;
}

export interface Stack {
  name: string;
  services: string[];
  status: "up" | "down" | "partial" | "unknown";
  // What else the folder holds besides compose.yml and .env — its data. Folders end in "/".
  data?: string[];
}

// A managed stack (a folder in the stacks directory, so it has actions and a file to edit),
// a compose project started from somewhere else (Loskai's own, say — listed, not managed),
// or the containers no compose file started.
export type Group =
  | { kind: "stack"; key: string; stack: Stack; containers: Container[] }
  | { kind: "project"; key: string; name: string; containers: Container[] }
  | { kind: "standalone"; key: string; containers: Container[] };

/** Every container lands in exactly one group, and every stack has one even with no
 *  containers (a stack that is down and never created any). Stacks first, in the order the
 *  backend lists them; then other projects, by name; then the standalone containers. */
export function groupByStack(containers: Container[], stacks: Stack[]): Group[] {
  const byName = (a: Container, b: Container) => a.name.localeCompare(b.name);
  const managed = new Set(stacks.map((s) => s.name));
  const groups: Group[] = stacks.map((stack) => ({
    kind: "stack",
    key: `stack:${stack.name}`,
    stack,
    containers: containers.filter((c) => c.project === stack.name).sort(byName),
  }));

  const others = [
    ...new Set(containers.map((c) => c.project).filter((p): p is string => !!p && !managed.has(p))),
  ].sort();
  for (const name of others) {
    groups.push({
      kind: "project",
      key: `project:${name}`,
      name,
      containers: containers.filter((c) => c.project === name).sort(byName),
    });
  }

  const loose = containers.filter((c) => !c.project).sort(byName);
  if (loose.length) groups.push({ kind: "standalone", key: "standalone", containers: loose });
  return groups;
}
