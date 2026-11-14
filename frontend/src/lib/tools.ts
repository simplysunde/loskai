import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// What a machine's page can run, from the tool files in the image
// (docs/reference/tool-schema.md). The commands come along so what runs can be read.
// `repo` is only asked for (Clone's address), never a row.
export type TargetKind = "service" | "container" | "lxc" | "vm" | "session" | "project" | "repo" | "host" | "key" | "key-host" | "key-label";

export interface ToolAction {
  id: string;
  label: string;
  description: string;
  target: TargetKind | null; // null: the machine itself
  ask: TargetKind | null; // a name typed for it, checked like a target
  confirm: string | null;
  // The tmux session it runs in: null Loskai's own, a name shared per target, false none.
  session: string | false | null;
  // Runs to the end by itself: sudo's password is asked for first, and its terminal closes.
  automatic?: boolean;
  // On a row only while its shared session is running, or only while it isn't.
  when?: "running" | "stopped" | null;
  // The rest of the time: hidden, or there but greyed out.
  otherwise?: "hidden" | "disabled";
  // On the card or its row (the default); in a settings dialog — one set up once (a
  // project's Own key); or in Keys, beside the list of SSH keys (New account key).
  place?: "card" | "settings" | "keys";
  run: string | Record<string, string>; // one command, or one per package manager
}

// A value on the machine a tool's card shows and sets (`settings:` in its file) — or, with a
// `target`, one of each of those rows (a project's own commit name), set under the row.
export interface ToolSetting {
  id: string;
  label: string;
  description: string;
  value: string; // the kind of value it takes
  read: string;
  write: string;
  unset?: string | null; // what taking it off runs: set to nothing. None: it needs a value
  target?: TargetKind | null;
  overrides?: string | null; // the machine's setting it replaces where it is set
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

export function runQueryString(run: ToolRun): string {
  if (run.sudo) return new URLSearchParams({ sudo: run.sudo }).toString();
  const q = new URLSearchParams({ tool: run.tool ?? "" });
  if (run.action) q.set("action", run.action);
  if (run.target) q.set("target", run.target);
  if (run.install) q.set("install", "true");
  return q.toString();
}

// The settings a row of `kind` has of its own — a project's commit name and email.
// The card's own settings: the machine's values, not a row's.
export function cardSettingsOf(tool: Tool): ToolSetting[] {
  return (tool.settings ?? []).filter((s) => !s.target);
}

// Whether a card has a settings cog: settings of its own, or (Git's) the machine's projects
// folder — Loskai's own, on its record, where Claude Code finds its projects.
export function hasCardSettings(tool: Tool): boolean {
  return tool.id === "git" || cardSettingsOf(tool).length > 0 || settingsActionsOf(tool).length > 0;
}

// The actions a settings dialog offers, not its card: the card's (on no row), or a kind of
// row's.
export function settingsActionsOf(tool: Tool, kind: TargetKind | null = null): ToolAction[] {
  return tool.actions.filter((a) => a.place === "settings" && (a.target ?? null) === kind);
}

// Whether an action is on its card (or its row) — not in a dialog: Settings, Keys.
export function isOnCard(action: ToolAction): boolean {
  return (action.place ?? "card") === "card";
}

// Whether a tool keeps the SSH user's keys (Git): its actions on a key, and those placed
// beside the list, are the buttons of the machine's Keys (its SSH settings); a project's
// overrides say which key it uses.
export function hasKeys(tool: Tool): boolean {
  return tool.actions.some((a) => a.target === "key" || a.place === "keys");
}

export function rowSettingsOf(tool: Tool, kind: TargetKind): ToolSetting[] {
  return (tool.settings ?? []).filter((s) => s.target === kind);
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

// The tool whose actions are the machine's own — update, reboot, shut down: on its General
// section, beside what the overview says, not a card under Tools.
export const MACHINE_TOOL = "system";

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

// What an asked-for value looks like, in its field: a name, a repository's address (Clone),
// or a host (Test key).
const ASKED: Partial<Record<TargetKind, { placeholder: string; width: string; what: string }>> = {
  repo: { placeholder: "https://… or git@host:path", width: "w-56", what: "repository" },
  host: { placeholder: "github.com", width: "w-36", what: "host" },
};

export function askedOf(kind: TargetKind | null | undefined) {
  return (kind && ASKED[kind]) || { placeholder: "name", width: "w-32", what: "name" };
}
