import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link2,
  Loader2,
  Play,
  RotateCw,
  ScrollText,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";

import { api } from "../../lib/api";
import { formatPercent, formatUptime } from "../../lib/format";
import { StatusBadge } from "../shared/StatusBadge";

export interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  uptime: number | null;
  ports: string[];
  subdomain: string | null;
  suggested_upstream: string | null;
  cpu: number | null;
  mem: { percent: number | null } | null;
}

export function ContainerList({
  onLogs,
  onTerminal,
  onAssign,
  onRemove,
}: {
  onLogs: (c: Container) => void;
  onTerminal: (c: Container) => void;
  onAssign: (c: Container) => void;
  onRemove: (c: Container) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => api.get<Container[]>("/api/docker/containers"),
    refetchInterval: 5_000,
    retry: false,
  });

  const action = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: string }) =>
      api.post(`/api/docker/containers/${id}/${verb}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-containers"] }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No containers.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Container</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Uptime</th>
            <th className="px-4 py-2.5 font-medium">CPU</th>
            <th className="px-4 py-2.5 font-medium">Mem</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((c) => {
            const running = c.status === "running";
            const busy = action.isPending && action.variables?.id === c.id;
            return (
              <tr key={c.id} className="hover:bg-slate-900/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-slate-100">
                    {c.name}
                    {c.subdomain && (
                      <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300">
                        {c.subdomain}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{c.image}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    status={running ? "healthy" : "unconfigured"}
                    label={c.status}
                  />
                </td>
                <td className="px-4 py-3 text-slate-400">{formatUptime(c.uptime)}</td>
                <td className="px-4 py-3 text-slate-400">{formatPercent(c.cpu)}</td>
                <td className="px-4 py-3 text-slate-400">{formatPercent(c.mem?.percent)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                    {running ? (
                      <>
                        <Act title="Stop" onClick={() => action.mutate({ id: c.id, verb: "stop" })}>
                          <Square className="h-3.5 w-3.5" />
                        </Act>
                        <Act title="Restart" onClick={() => action.mutate({ id: c.id, verb: "restart" })}>
                          <RotateCw className="h-3.5 w-3.5" />
                        </Act>
                      </>
                    ) : (
                      <Act title="Start" onClick={() => action.mutate({ id: c.id, verb: "start" })}>
                        <Play className="h-3.5 w-3.5" />
                      </Act>
                    )}
                    <Act title="Logs" onClick={() => onLogs(c)}>
                      <ScrollText className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Terminal" onClick={() => onTerminal(c)} disabled={!running}>
                      <TerminalSquare className="h-3.5 w-3.5" />
                    </Act>
                    <Act title={c.subdomain ? "Change URL" : "Assign URL"} onClick={() => onAssign(c)}>
                      <Link2 className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Remove" danger onClick={() => onRemove(c)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Act>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Act({
  title,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border border-slate-700 p-1.5 disabled:opacity-30 ${
        danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
