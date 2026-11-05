import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { ConfirmDialog } from "../shared/ConfirmDialog";

type Rewrite = { domain: string; answer: string; managed: boolean };

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

  // Only fetched once the dialog is open: it's a preview of a destructive action, not
  // something the settings page needs to hold. Fresh every time, because the answer to
  // "what am I about to lose" must not come from a cache of some earlier state.
  const preview = useQuery({
    queryKey: ["adguard-rewrites"],
    queryFn: () => api.get<{ rewrites: Rewrite[] }>("/api/adguard/rewrites"),
    enabled: confirming,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const entries = preview.data?.rewrites ?? [];
  const lost = entries.filter((e) => !e.managed).length;

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
      setError(apiMessage(err, "Could not reach AdGuard."));
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

        <RewritePreview query={preview} entries={entries} lost={lost} />
      </ConfirmDialog>
    </div>
  );
}

// The list behind a disclosure: collapsed by default so the warning stays the headline,
// one click away so "every rewrite" is checkable rather than taken on trust. Each row says
// whether it survives — a managed pair is restored seconds later, everything else is not.
function RewritePreview({
  query,
  entries,
  lost,
}: {
  query: { isLoading: boolean; isError: boolean };
  entries: Rewrite[];
  lost: number;
}) {
  if (query.isLoading) {
    return (
      <span className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading AdGuard's rewrites…
      </span>
    );
  }
  if (query.isError) {
    return (
      <span className="mt-3 block text-xs text-amber-300">
        Couldn't read the current rewrites — AdGuard may be unreachable, in which case the
        clear will fail too.
      </span>
    );
  }
  if (entries.length === 0) {
    return (
      <span className="mt-3 block text-xs text-slate-500">
        AdGuard holds no rewrites right now — this will only write Loskai's.
      </span>
    );
  }

  return (
    <details className="group mt-3 rounded-lg border border-slate-800 bg-slate-950/60">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-slate-300 marker:content-none hover:text-slate-100">
        <span className="underline decoration-dotted underline-offset-2">
          Show the {entries.length} {entries.length === 1 ? "rewrite" : "rewrites"} this
          removes
        </span>
        {lost > 0 && (
          <span className="ml-2 text-rose-300">
            · {lost} not restored
          </span>
        )}
      </summary>
      {/* overscroll-contain: without it the wheel keeps going into the page behind the
          dialog once the list bottoms out, which reads as the dialog losing the gesture. */}
      <ul className="max-h-48 overflow-y-auto overscroll-contain border-t border-slate-800 px-3 py-2">
        {entries.map((e) => (
          <li
            key={`${e.domain}|${e.answer}`}
            className="flex items-baseline justify-between gap-3 py-0.5 font-mono text-xs"
          >
            <span className="truncate text-slate-300">
              {e.domain} <span className="text-slate-600">→</span> {e.answer}
            </span>
            <span
              className={`shrink-0 font-sans text-[11px] ${
                e.managed ? "text-slate-500" : "text-rose-300"
              }`}
            >
              {e.managed ? "restored" : "not restored"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
