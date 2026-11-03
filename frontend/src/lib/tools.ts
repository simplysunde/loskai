import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// What a machine's page can run, from the tool files in the image
// (docs/reference/tool-schema.md). The commands come along so what runs can be read.
export type ToolTarget = "service" | "container" | "lxc" | "vm" | "session" | "project";

export interface ToolAction {
  id: string;
  label: string;
  description: string;
  target: ToolTarget | null; // null: the machine itself
  ask: ToolTarget | null; // a name typed for it, checked like a target
  confirm: string | null;
  // The tmux session it runs in: null Loskai's own, a name shared per target, false none.
  session: string | false | null;
  // Runs to the end by itself: sudo's password is asked for first, and its terminal closes.
  automatic?: boolean;
  run: string | Record<string, string>; // one command, or one per package manager
}

// A value on the machine a tool's card shows and sets (`settings:` in its file).
export interface ToolSetting {
  id: string;
  label: string;
  description: string;
  value: string; // the kind of value it takes
  read: string;
  write: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  requires: string[]; // programs, as the overview names them
  installable: string[]; // those Loskai can install
  actions: ToolAction[];
  settings?: ToolSetting[];
}

// What the machine's terminal is asked to run — named, never the command itself: a tool's
// action or install, or putting the sudo rule for updates on or taking it off.
export interface ToolRun {
  tool?: string;
  sudo?: "allow" | "remove";
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
  if (run.sudo) return new URLSearchParams({ sudo: run.sudo }).toString();
  const q = new URLSearchParams({ tool: run.tool ?? "" });
  if (run.action) q.set("action", run.action);
  if (run.target) q.set("target", run.target);
  if (run.install) q.set("install", "true");
  return q.toString();
}

// The tmux session a shared-`session` action runs in for `target`, named as tool.session_name.
export function sessionName(session: string, target: string): string {
  return `${session}-${target}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

// The programs `tool` requires that a machine with `programs` lacks — none: it applies.
export function missing(tool: Tool, programs: string[]): string[] {
  return tool.requires.filter((p) => !programs.includes(p));
}

// A tool that applies to a machine with `programs` — it has everything the tool requires.
export function applies(tool: Tool, programs: string[]): boolean {
  return missing(tool, programs).length === 0;
}

// A tool Loskai can add to a machine with `programs`: it lacks something, all installable.
export function addable(tool: Tool, programs: string[]): boolean {
  const lacking = missing(tool, programs);
  return lacking.length > 0 && lacking.every((p) => tool.installable.includes(p));
}

// A standard tool — System, Services, Proxmox — needs nothing Loskai installs, and shows on
// the machine page itself; an added one (tmux, Claude Code, Tailscale) has its own page.
export function isStandard(tool: Tool): boolean {
  return tool.installable.length === 0;
}

// The command an action runs on a machine with `manager`, or null when it has none for it.
export function commandFor(action: ToolAction, manager: string | null | undefined): string | null {
  if (typeof action.run === "string") return action.run;
  return manager ? (action.run[manager] ?? null) : null;
}
