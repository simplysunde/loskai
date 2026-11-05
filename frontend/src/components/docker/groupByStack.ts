import type { Container } from "../../lib/containers";

export interface Stack {
  name: string;
  services: string[];
  status: "up" | "down" | "partial" | "unknown";
  // What else the folder holds besides compose.yml and .env — its data. Folders end in "/".
  data?: string[];
}

// A managed stack (a folder in the stacks directory, so it has actions and a file to edit),
// a compose project started from somewhere else (listed, not managed),
// or a container no compose file started — a group of one, so it reads like the rest.
export type Group =
  | { kind: "stack"; key: string; stack: Stack; containers: Container[] }
  | { kind: "project"; key: string; name: string; containers: Container[] }
  | { kind: "standalone"; key: string; name: string; containers: Container[] };

/** Every container lands in exactly one group — except Loskai's own, which is shown apart —
 *  and every stack has one even with no containers (a stack that is down and never created
 *  any). Stacks first, in the order the backend lists them; then other projects, by name;
 *  then the standalone containers. */
export function groupByStack(all: Container[], stacks: Stack[]): Group[] {
  const containers = all.filter((c) => !c.self);
  const byName = (a: Container, b: Container) => a.name.localeCompare(b.name);
  const groups: Group[] = stacks.map((stack) => ({
    kind: "stack",
    key: `stack:${stack.name}`,
    stack,
    containers: containers.filter((c) => c.stack === stack.name).sort(byName),
  }));

  const loose = containers.filter((c) => !c.stack);
  const others = [...new Set(loose.map((c) => c.project).filter((p): p is string => !!p))].sort();
  for (const name of others) {
    groups.push({
      kind: "project",
      key: `project:${name}`,
      name,
      containers: loose.filter((c) => c.project === name).sort(byName),
    });
  }

  for (const c of loose.filter((c) => !c.project).sort(byName)) {
    groups.push({ kind: "standalone", key: `standalone:${c.name}`, name: c.name, containers: [c] });
  }
  return groups;
}

/** A group's one status pill: up, down, or how many of how many are up. A stack counts
 *  the services its compose file declares, so one whose container was never created is
 *  not "up" just because everything that exists is running. */
export function groupStatus(group: Group): { tone: string; label: string } {
  if (group.kind === "stack" && group.stack.status === "unknown") {
    return { tone: "unknown", label: "unknown" };
  }
  const running = group.containers.filter((c) => c.status === "running").length;
  const total = Math.max(
    group.containers.length,
    group.kind === "stack" ? group.stack.services.length : 0,
  );
  if (running === 0) return { tone: "unconfigured", label: "down" };
  if (running >= total) return { tone: "healthy", label: "up" };
  return { tone: "degraded", label: `${running}/${total} up` };
}

/** What a collapsed group shows in the stat columns: the longest uptime (how long it has
 *  been up at all), and CPU and memory added up across its containers. Null where no
 *  container reports one — a stopped one has none. */
export function groupTotals(group: Group): { uptime: number | null; cpu: number | null; mem: number | null } {
  const sum = (xs: (number | null | undefined)[]) => {
    const known = xs.filter((x): x is number => x != null);
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  const uptimes = group.containers.map((c) => c.uptime).filter((u): u is number => u != null);
  return {
    uptime: uptimes.length ? Math.max(...uptimes) : null,
    cpu: sum(group.containers.map((c) => c.cpu)),
    mem: sum(group.containers.map((c) => c.mem?.percent)),
  };
}
