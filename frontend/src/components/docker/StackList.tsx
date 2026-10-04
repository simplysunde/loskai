import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Play, RotateCw, Square, Trash2, UploadCloud } from "lucide-react";

import { api } from "../../lib/api";
import { StatusBadge } from "../shared/StatusBadge";

export interface Stack {
  name: string;
  services: string[];
  status: "up" | "down" | "partial" | "unknown";
  // What else the folder holds besides compose.yml and .env — its data. Folders end in "/".
  data?: string[];
}

const STATUS: Record<string, string> = {
  up: "healthy",
  partial: "degraded",
  down: "unconfigured",
  unknown: "unknown",
};

export function StackList({
  onEdit,
  onDelete,
}: {
  onEdit: (name: string) => void;
  onDelete: (stack: Stack) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["docker-stacks"],
    queryFn: () => api.get<Stack[]>("/api/docker/stacks"),
    refetchInterval: 8_000,
    retry: false,
  });

  const action = useMutation({
    mutationFn: ({ name, verb }: { name: string; verb: string }) =>
      api.post(`/api/docker/stacks/${name}/action`, { action: verb }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-stacks"] }),
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
        No stacks in the stacks directory yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Stack</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((s) => {
            const busy = action.isPending && action.variables?.name === s.name;
            return (
              <tr key={s.name} className="hover:bg-slate-900/40">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.services.join(", ") || "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={STATUS[s.status]} label={s.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                    <Act title="Up" onClick={() => action.mutate({ name: s.name, verb: "up" })}>
                      <Play className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Down" onClick={() => action.mutate({ name: s.name, verb: "down" })}>
                      <Square className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Restart" onClick={() => action.mutate({ name: s.name, verb: "restart" })}>
                      <RotateCw className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Pull + update" onClick={() => action.mutate({ name: s.name, verb: "pull" })}>
                      <UploadCloud className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Edit" onClick={() => onEdit(s.name)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Act>
                    <Act title="Delete" danger onClick={() => onDelete(s)}>
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
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-lg border border-slate-700 p-1.5 ${
        danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
