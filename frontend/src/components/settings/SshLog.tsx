import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "../../lib/api";
import { CARD_TABLE } from "../../lib/ui";

interface LogEntry {
  at: string;
  event: "open" | "close" | "refused" | "install" | "action" | "add-tool" | "sudo-rule" | "uninstall" | "setting";
  machine: string;
  from: string | null;
  target?: string;
  seconds?: number;
  ok?: boolean;
  error?: string;
  tool?: string;
  action?: string;
  programs?: string[];
  command?: string;
  user?: string; // the account that did it
  allow?: boolean; // sudo-rule: put on (true) or taken off
  sudo_rule_left?: boolean; // uninstall: the sudo rule stayed
  setting?: string; // setting: which, and what it was set to
  value?: string;
}

function what(e: LogEntry): string {
  switch (e.event) {
    case "open":
      return `Terminal opened (${e.target ?? ""})`;
    case "close":
      return `Terminal closed after ${duration(e.seconds ?? 0)}`;
    case "refused":
      return `Terminal refused: ${e.error ?? ""}`;
    case "install":
      return e.ok ? "Keys installed" : `Install failed: ${e.error ?? ""}`;
    case "action":
      return `Ran ${e.tool} › ${e.action}${e.target ? ` on ${e.target}` : ""}`;
    case "add-tool":
      return `Adding ${e.tool}: installing ${(e.programs ?? []).join(", ")}`;
    case "sudo-rule":
      return e.allow ? "Allowing updates without a password" : "Taking off updates without a password";
    case "setting":
      return `${e.ok ? "Set" : "Couldn't set"} ${e.tool} › ${e.setting} to ${e.value ?? ""}`;
    case "uninstall":
      return !e.ok
        ? `Couldn't take Loskai's key off: ${e.error ?? ""}`
        : e.sudo_rule_left
          ? "Loskai's key taken off; its sudo rule stayed"
          : "Loskai's key taken off";
  }
}

function duration(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// Every SSH terminal opened, closed or refused, and every install — newest first. Sessions,
// not keystrokes: what is typed can be a password at a sudo prompt. Given a machine (its
// page), only that machine's.
export function SshLog({ machine }: { machine?: string }) {
  const log = useQuery({
    queryKey: ["ssh-log", machine],
    queryFn: () => api.get<LogEntry[]>(machine ? `/api/ssh/log?machine=${encodeURIComponent(machine)}` : "/api/ssh/log"),
  });

  const entries = log.data ?? [];

  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800 px-3 py-2">
      {log.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
      ) : !entries.length ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <table className={`w-full text-left text-xs ${CARD_TABLE}`}>
          <thead className="text-slate-500 max-sm:hidden">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              {!machine && <th className="py-1 pr-3 font-medium">Machine</th>}
              <th className="py-1 pr-3 font-medium">Who</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 font-medium">What</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {entries.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-t border-slate-800/70 max-sm:py-1.5">
                <td className="whitespace-nowrap py-1 pr-3 text-slate-400">
                  {new Date(e.at).toLocaleString()}
                </td>
                {!machine && <td className="py-1 pr-3">{e.machine}</td>}
                <td className="py-1 pr-3 text-slate-400">{e.user ?? "—"}</td>
                <td className="py-1 pr-3 font-mono text-slate-400">{e.from ?? "—"}</td>
                <td
                  title={e.command ? `$ ${e.command}` : undefined}
                  className={`py-1 max-sm:basis-full ${e.event === "refused" || e.ok === false ? "text-amber-300" : ""}`}
                >
                  {what(e)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
