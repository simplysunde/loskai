import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "../../lib/api";
import { Modal } from "../shared/Modal";

interface LogEntry {
  at: string;
  event: "open" | "close" | "refused" | "install";
  machine: string;
  from: string | null;
  target?: string;
  seconds?: number;
  ok?: boolean;
  error?: string;
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
  }
}

function duration(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// Every SSH terminal opened, closed or refused, and every install — newest first. Sessions,
// not keystrokes: what is typed can be a password at a sudo prompt.
export function SshLog({ onClose }: { onClose: () => void }) {
  const log = useQuery({
    queryKey: ["ssh-log"],
    queryFn: () => api.get<LogEntry[]>("/api/ssh/log"),
  });

  return (
    <Modal title="SSH log" onClose={onClose}>
      {log.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
      ) : !log.data?.length ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">Machine</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 font-medium">What</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {log.data.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-t border-slate-800/70">
                <td className="whitespace-nowrap py-1 pr-3 text-slate-400">
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="py-1 pr-3">{e.machine}</td>
                <td className="py-1 pr-3 font-mono text-slate-400">{e.from ?? "—"}</td>
                <td className={`py-1 ${e.event === "refused" || e.ok === false ? "text-amber-300" : ""}`}>
                  {what(e)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
