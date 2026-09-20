import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { ConfirmDialog } from "../shared/ConfirmDialog";

type ClearResult = {
  cleared: string[];
  restored: string[];
  conflicts: unknown[];
  errors: { domain: string; detail: string }[];
};

function summarise({ cleared, restored, errors }: ClearResult): string {
  const n = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? "" : "s"}`;
  const head = `Removed ${n(cleared.length, "rewrite")}, restored ${n(restored.length, "rewrite")}.`;
  return errors.length ? `${head} ${n(errors.length, "delete")} failed.` : head;
}

// The escape hatch for adopting an AdGuard that already has rewrites — from before Loskai,
// or from a different naming scheme. Every other path deletes only entries Loskai wrote, so
// this is the one destructive action against a third-party system in the app: the dialog
// spells out that hand-added rewrites go too, because nothing else in the UI does that.
export function ClearRewrites() {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const clear = useMutation({
    mutationFn: () => api.post<ClearResult>("/api/adguard/rewrites/clear"),
    onSuccess: (result) => {
      setConfirming(false);
      setError(null);
      setNote(summarise(result));
      // The DNS column and the health banner both read what AdGuard now holds.
      qc.invalidateQueries({ queryKey: ["adguard-status"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
    },
    onError: (err) => {
      setConfirming(false);
      setNote(null);
      setError(err instanceof ApiError ? err.message : "Could not reach AdGuard.");
    },
  });

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-300">Reset rewrites</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Delete every DNS rewrite in AdGuard, then write Loskai's back from the
            instance list. Use it when AdGuard carries rewrites from before Loskai.
          </p>
        </div>
        <button
          onClick={() => setConfirming(true)}
          disabled={clear.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-900/70 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
        >
          {clear.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Clear rewrites
        </button>
      </div>

      {note && <p className="mt-2 text-xs text-emerald-300">{note}</p>}
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      <ConfirmDialog
        open={confirming}
        title="Clear all DNS rewrites?"
        confirmLabel="Clear and restore"
        destructive
        onConfirm={() => clear.mutate()}
        onCancel={() => setConfirming(false)}
      >
        <span className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>
            This removes <span className="font-medium text-slate-200">every</span> rewrite
            AdGuard holds — including any you added by hand, and any under a previous base
            domain. Loskai's own are written back immediately, one per routed name.
            <span className="mt-2 block text-slate-500">
              Rewrites Loskai doesn't know about cannot be recovered. Nothing else in
              AdGuard is touched.
            </span>
          </span>
        </span>
      </ConfirmDialog>
    </div>
  );
}
