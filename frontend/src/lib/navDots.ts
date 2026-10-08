import type { HealthMap, ModuleState } from "./useHealth";

export interface NavDot {
  state: ModuleState;
  // Hover text: why the dot is the colour it is.
  title: string;
}

const ORDER: ModuleState[] = ["unreachable", "degraded", "unconfigured", "healthy"];

// The worst of several dots wins (problems first), keeping its reason.
function worst(...dots: (NavDot | undefined)[]): NavDot | undefined {
  for (const state of ORDER) {
    const dot = dots.find((d) => d?.state === state);
    if (dot) return dot;
  }
  return undefined;
}

function module(name: string, health: { status: ModuleState } | undefined): NavDot | undefined {
  return health && { state: health.status, title: `${name}: ${health.status}` };
}

// Amber when one of the tab's own rows has a DNS problem (no rewrite, or a foreign one) —
// a reason to open the tab even while AdGuard itself is fine.
function dns(health: HealthMap, machine: boolean): NavDot | undefined {
  const ids = new Set(
    (health.consistency ?? []).filter((w) => Boolean(w.machine) === machine).map((w) => w.id),
  );
  if (ids.size === 0) return undefined;
  const noun = machine ? "machine" : "route";
  return { state: "degraded", title: `${ids.size} ${noun}${ids.size === 1 ? "" : "s"} with a DNS problem` };
}

/** The sidebar's status dot per admin tab, keyed by its path. */
export function navDots(health: HealthMap): Record<string, NavDot | undefined> {
  const adguard = module("AdGuard", health.adguard);
  return {
    "/docker": module("Docker", health.docker),
    "/routing": worst(module("Caddy", health.caddy), adguard, dns(health, false)),
    "/machines": worst(adguard, dns(health, true)),
  };
}
