import { useCallback, useSyncExternalStore } from "react";

// The rows whose Start failed while their session went on running — stopped at a question
// (Claude's "trust this folder?"), waiting for someone to Attach. In this browser only, a
// convenience like the hosts tested before: kept across a reload, gone once a button on the
// row is clicked. Storage that can't be read or written keeps it for this page only.
const KEY = "loskai-waiting";
const listeners = new Set<() => void>();
let memory: string[] | null = null;

function read(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return memory ?? [];
  }
}

function write(list: string[]) {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept past this page, then.
  }
  listeners.forEach((l) => l());
}

// As a string, so an unchanged list is the same snapshot.
const current = () => JSON.stringify(read());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const waitingKey = (machine: string, tool: string, kind: string, name: string) => `${machine}/${tool}/${kind}/${name}`;

export function useWaiting() {
  const list: string[] = JSON.parse(useSyncExternalStore(subscribe, current));
  const mark = useCallback((key: string) => {
    const now = read();
    if (!now.includes(key)) write([...now, key]);
  }, []);
  const clear = useCallback((key: string) => {
    const now = read();
    if (now.includes(key)) write(now.filter((k) => k !== key));
  }, []);
  return { waiting: (key: string) => list.includes(key), mark, clear };
}
