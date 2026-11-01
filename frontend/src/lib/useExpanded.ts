import { useState } from "react";

// Which rows of a collapsible table are open — the Docker tab's stacks, the Machines tab's
// machines. They start collapsed; the ones opened are remembered for this browser tab's
// session (under `storageKey`), so a refresh or a visit to another page keeps them, and a
// new tab starts tidy again.
export function useExpanded(storageKey: string) {
  const [expanded, setExpanded] = useState<Set<string>>(() => read(storageKey));
  const keep = (next: Set<string>) => {
    setExpanded(next);
    write(storageKey, next);
  };

  const isOpen = (key: string) => expanded.has(key);
  const anyOpen = (keys: string[]) => keys.some((k) => expanded.has(k));
  const toggle = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    keep(next);
  };
  // A table's rows at once: collapse them all if any is open, else open them all.
  const toggleAll = (keys: string[]) => {
    const next = new Set(expanded);
    const open = anyOpen(keys);
    for (const k of keys) {
      if (open) next.delete(k);
      else next.add(k);
    }
    keep(next);
  };
  return { isOpen, anyOpen, toggle, toggleAll };
}

// Browser storage can be missing or refuse (a private window, blocked site data): then the
// table simply starts collapsed each time.
function read(storageKey: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function write(storageKey: string, keys: Set<string>) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Not kept — harmless.
  }
}
