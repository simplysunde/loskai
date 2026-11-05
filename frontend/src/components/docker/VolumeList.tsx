import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { ConfirmDialog } from "../shared/ConfirmDialog";

export interface Volume {
  name: string;
  driver: string | null;
  // Bytes; null where Docker hasn't computed it.
  size: number | null;
  project: string | null;
  // Named by Docker itself — the 64-hex id says nothing, so it's shortened.
  anonymous: boolean;
  used_by: string[];
}

// Named volumes on the host: what each one is for (its stack), how big it is, and what
// mounts it — so a volume nothing uses is visible as such, and can be deleted. Only those:
// one in use offers no delete, and the backend never forces it either.
export function VolumeList() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Volume | null>(null);
  const remove = useMutation({
    mutationFn: (v: Volume) => api.del(`/api/docker/volumes/${encodeURIComponent(v.name)}`),
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["docker-volumes"] });
    },
    onError: () => setConfirm(null),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["docker-volumes"],
    queryFn: () => api.get<Volume[]>("/api/docker/volumes"),
    // Sizes come from `docker system df`, which walks every volume — not a 5s poll.
    refetchInterval: 60_000,
    retry: false,
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
        No named volumes. Stacks that keep their data beside the compose file (./data) use a
        folder, not a volume.
      </div>
    );
  }

  const unused = rows.filter((v) => v.used_by.length === 0).length;
  const total = rows.reduce((sum, v) => sum + (v.size ?? 0), 0);

  return (
    <div>
      {remove.error && (
        <div className="mb-2 rounded-lg border border-rose-600/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Couldn't delete the volume:{" "}
          {apiMessage(remove.error, "request failed")}
        </div>
      )}
      <p className="mb-2 text-xs text-slate-500">
        {rows.length} {rows.length === 1 ? "volume" : "volumes"} · {formatBytes(total)}
        {unused > 0 && <span className="text-amber-300/80"> · {unused} unused</span>}
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Volume</th>
              <th className="px-4 py-2.5 font-medium">Stack</th>
              <th className="px-4 py-2.5 font-medium text-right">Size</th>
              <th className="px-4 py-2.5 font-medium">Used by</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {rows.map((v) => (
              <tr key={v.name} className="hover:bg-slate-900/40">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span title={v.name} className="font-mono text-xs text-slate-200">
                      {v.anonymous ? `${v.name.slice(0, 12)}…` : v.name}
                    </span>
                    {v.anonymous && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        anonymous
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">{v.project ?? "—"}</td>
                <td className="px-4 py-3 text-right text-slate-400">{formatBytes(v.size)}</td>
                <td className="px-4 py-3">
                  {v.used_by.length ? (
                    <span className="text-xs text-slate-300">{v.used_by.join(", ")}</span>
                  ) : (
                    <span
                      title="No container mounts it, running or stopped"
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                    >
                      unused
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    {v.used_by.length === 0 && (
                      <button
                        title="Delete volume"
                        aria-label={`Delete volume ${v.name}`}
                        onClick={() => setConfirm(v)}
                        className="rounded-lg border border-slate-700 p-1.5 text-rose-300 hover:bg-rose-500/10"
                      >
                        {remove.isPending && remove.variables?.name === v.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title="Delete volume"
        destructive
        confirmLabel="Delete"
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && remove.mutate(confirm)}
      >
        Delete <span className="font-mono text-slate-200">{confirm?.name}</span>
        {confirm?.size ? ` (${formatBytes(confirm.size)})` : ""}? Its data is gone for good —
        there is no undo.
      </ConfirmDialog>
    </div>
  );
}
