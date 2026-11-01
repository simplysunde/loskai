import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// What a machine's page can run, from the tool files in the image
// (docs/reference/tool-schema.md). The commands come along so what runs can be read.
export type ToolTarget = "service" | "container" | "lxc" | "vm";

export interface ToolAction {
  id: string;
  label: string;
  description: string;
  target: ToolTarget | null; // null: the machine itself
  confirm: string | null;
  run: string | Record<string, string>; // one command, or one per package manager
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  requires: string[]; // programs, as the overview names them
  installable: string[]; // those Loskai can install
  actions: ToolAction[];
}

// What the machine's terminal is asked to run — named, never the command itself.
export interface ToolRun {
  tool: string;
  action?: string;
  target?: string;
  install?: boolean;
  title: string;
}

export function useTools() {
  return useQuery({
    queryKey: ["ssh-tools"],
    queryFn: () => api.get<Tool[]>("/api/ssh/tools"),
    staleTime: Infinity, // they change only with the image
  });
}

export function runQuery(run: ToolRun): string {
  const q = new URLSearchParams({ tool: run.tool });
  if (run.action) q.set("action", run.action);
  if (run.target) q.set("target", run.target);
  if (run.install) q.set("install", "true");
  return q.toString();
}

// The programs `tool` requires that a machine with `programs` lacks — none: it applies.
export function missing(tool: Tool, programs: string[]): string[] {
  return tool.requires.filter((p) => !programs.includes(p));
}

// The command an action runs on a machine with `manager`, or null when it has none for it.
export function commandFor(action: ToolAction, manager: string | null | undefined): string | null {
  if (typeof action.run === "string") return action.run;
  return manager ? (action.run[manager] ?? null) : null;
}
