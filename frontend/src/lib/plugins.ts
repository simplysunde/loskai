import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// What a machine's page can run, from the plugin files in the image
// (docs/reference/plugin-schema.md). The commands come along so what runs can be read.
export type PluginTarget = "service" | "container" | "lxc" | "vm";

export interface PluginAction {
  id: string;
  label: string;
  description: string;
  target: PluginTarget | null; // null: the machine itself
  confirm: string | null;
  run: string | Record<string, string>; // one command, or one per package manager
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  requires: string[];
  install: Record<string, { packages?: Record<string, string>; script?: string }>;
  actions: PluginAction[];
}

// What the machine's terminal is asked to run — named, never the command itself.
export interface PluginRun {
  plugin: string;
  action?: string;
  target?: string;
  install?: string;
  title: string;
}

export function usePlugins() {
  return useQuery({
    queryKey: ["ssh-plugins"],
    queryFn: () => api.get<Plugin[]>("/api/ssh/plugins"),
    staleTime: Infinity, // they change only with the image
  });
}

export function runQuery(run: PluginRun): string {
  const q = new URLSearchParams({ plugin: run.plugin });
  if (run.action) q.set("action", run.action);
  if (run.target) q.set("target", run.target);
  if (run.install) q.set("install", run.install);
  return q.toString();
}

// The command an action runs on a machine with `manager`, or null when it has none for it.
export function commandFor(action: PluginAction, manager: string | null | undefined): string | null {
  if (typeof action.run === "string") return action.run;
  return manager ? (action.run[manager] ?? null) : null;
}
