import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { Modal } from "../shared/Modal";

export type RecipeUpdate = {
  stack: string;
  recipe: string;
  name: string;
  icon: boolean;
  source: string | null;
  status: "current" | "available" | "edited" | "untracked" | "gone";
  updatable: boolean;
  reason: string | null;
  images: { service: string; from: string | null; to: string | null }[];
  diff: string;
  commits: { commit: string; date: string; subject: string; body: string }[];
  new_env: string[];
};

const STATUS: Record<RecipeUpdate["status"], string> = {
  current: "Up to date",
  available: "Update available",
  edited: "Update available",
  untracked: "Differs from the recipe",
  gone: "No longer in any source",
};

// Check for updates: sync the recipe sources (explicit, as every sync is), then list each
// installed recipe. One that has moved on opens to what changes — the recipe's commits since
// the install and the compose.yml difference — and an Update that replaces the recipe's
// compose.yml. The override is the user's, and is never touched.
export function RecipeUpdates({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const check = useQuery({
    queryKey: ["recipe-updates"],
    queryFn: async () => {
      // A source that can't be reached keeps what it last synced; the check still runs.
      const synced = await api
        .post<{ ok: boolean; output: string }>("/api/docker/recipes/refresh")
        .catch((e) => ({ ok: false, output: apiMessage(e, "sync failed") }));
      const list = await api.get<RecipeUpdate[]>("/api/docker/recipes/updates");
      return { list, syncFailed: synced.ok ? null : synced.output };
    },
    gcTime: 0,
  });
  const list = check.data?.list ?? [];
  const pending = list.filter((u) => u.status !== "current" && u.status !== "gone").length;

  return (
    <Modal title="Check for updates" onClose={onClose} wide>
      {check.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Checking the recipe sources…
        </div>
      ) : check.isError ? (
        <p className="text-sm text-rose-400">
          {apiMessage(check.error, "Couldn't check for updates")}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            {list.length === 0
              ? "No stacks were installed from a recipe."
              : pending
                ? `${pending} of ${list.length} installed recipes can be updated.`
                : "Every installed recipe is up to date."}
          </p>
          {check.data?.syncFailed && (
            <p className="text-xs text-amber-300">Some sources couldn't be synced — showing what they last had.</p>
          )}
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {list.map((u) => (
              <UpdateRow
                key={u.stack}
                update={u}
                open={open === u.stack}
                onToggle={() => setOpen(open === u.stack ? null : u.stack)}
                onUpdated={() => {
                  qc.invalidateQueries({ queryKey: ["recipe-updates"] });
                  qc.invalidateQueries({ queryKey: ["docker-stacks"] });
                  qc.invalidateQueries({ queryKey: ["docker-containers"] });
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function UpdateRow({
  update: u,
  open,
  onToggle,
  onUpdated,
}: {
  update: RecipeUpdate;
  open: boolean;
  onToggle: () => void;
  onUpdated: () => void;
}) {
  const [output, setOutput] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: () => api.post<{ ok: boolean; output: string }>(`/api/docker/stacks/${u.stack}/update-from-recipe`),
    onSuccess: (r) => {
      setOutput(r.ok ? null : r.output || "docker compose up failed");
      onUpdated();
    },
    onError: (e) => setOutput(apiMessage(e, "Update failed")),
  });
  const changed = u.status !== "current" && u.status !== "gone";
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li>
      <button
        onClick={onToggle}
        disabled={!changed}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left enabled:hover:bg-slate-800/40"
      >
        {u.icon ? (
          <img
            src={`/api/docker/recipes/${encodeURIComponent(u.recipe)}/icon`}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg bg-slate-800/60 object-contain p-1"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-sm font-semibold text-teal-300">
            {u.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">{u.name}</span>
          {u.images[0] && (
            <span className="block truncate font-mono text-xs text-slate-500">
              {u.images[0].from ?? "—"} → {u.images[0].to ?? "—"}
            </span>
          )}
        </span>
        {changed ? (
          <span className="flex items-center gap-1.5 text-xs text-teal-300">
            <ArrowUpCircle className="h-4 w-4" /> {STATUS[u.status]}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            {u.status === "current" && <Check className="h-3.5 w-3.5" />} {STATUS[u.status]}
          </span>
        )}
        {changed && <Chevron className="h-4 w-4 text-slate-500" />}
      </button>

      {open && changed && (
        <div className="space-y-3 border-t border-slate-800 bg-slate-950/40 px-4 py-3 text-sm">
          {u.status === "edited" && (
            <p className="text-xs text-amber-300">
              compose.yml was changed by hand since the install — updating replaces it. To keep a change,
              move it into compose.override.yml first (Edit on the stack).
            </p>
          )}
          {u.status === "untracked" && (
            <p
              className="text-xs text-amber-300"
              title="Not installed by this Loskai, or before updates were tracked: this is everything that differs, your own changes too."
            >
              Updating replaces compose.yml — check its volumes first.
            </p>
          )}
          {u.images.length > 1 && (
            <ul className="space-y-0.5 font-mono text-xs text-slate-400">
              {u.images.map((i) => (
                <li key={i.service}>
                  {i.service}: {i.from ?? "—"} → {i.to ?? "—"}
                </li>
              ))}
            </ul>
          )}
          {u.commits.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">What changed</p>
              {u.commits.map((c) => (
                <div key={c.commit}>
                  <p className="text-slate-200">
                    {c.subject} <span className="text-xs text-slate-500">{c.date}</span>
                  </p>
                  {c.body && <p className="whitespace-pre-line text-xs text-slate-400">{c.body}</p>}
                </div>
              ))}
            </div>
          )}
          {u.new_env.length > 0 && (
            <p className="text-xs text-slate-400">
              New settings, with their defaults: <span className="font-mono">{u.new_env.join(", ")}</span>
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
              The difference in compose.yml
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs">
              {u.diff.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "text-emerald-300"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "text-rose-300"
                        : "text-slate-500"
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          </details>
          {u.reason && <p className="text-xs text-slate-400">{u.reason}</p>}
          {u.updatable && (
            <div className="flex justify-end">
              <button
                onClick={() => apply.mutate()}
                disabled={apply.isPending}
                className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
              >
                {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Update
              </button>
            </div>
          )}
        </div>
      )}
      {/* Outside the details: a failed `up` comes after the file was replaced, when the
          row already reads up to date and has closed. */}
      {output && (
        <pre className="mx-4 mb-3 max-h-40 overflow-auto rounded-lg border border-rose-900/60 bg-slate-950 px-3 py-2 font-mono text-xs text-rose-300">
          {output}
        </pre>
      )}
    </li>
  );
}
