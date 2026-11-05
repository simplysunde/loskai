import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { recipeSources, useSettings, type RecipeSource } from "../../lib/settings";

// What GET /api/docker/recipes reports per source — sync state the settings list shows so
// "added a repo" and "that repo has actually been cloned" are distinguishable here rather
// than only in the wizard.
interface SourceStatus {
  url: string;
  label: string;
  enabled: boolean;
  builtin: boolean;
  synced: boolean;
  count: number;
}

interface SyncResult {
  ok: boolean;
  results: { url: string; label: string; ok: boolean; output: string }[];
}

// The install wizard's git sources: one row per repo, each independently switched on or
// off, top of the list winning a name clash. The shipped default is an ordinary row with
// a badge — disabling or deleting it is allowed, which is why an empty list is a stored
// value and not a reset (backend `recipe_sources`). The local `data/recipes` dir is not a
// row: it is always scanned, needs no URL, and can't be turned off.
//
// This is the only place sources can be set: there is no env var for them, so the panel
// is never read-only (backend `STORED_ONLY_KEYS`).
export function RecipeSources() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { data: settings } = useSettings();
  const recipes = useQuery({
    queryKey: ["docker-recipes"],
    queryFn: () => api.get<{ sources: SourceStatus[]; local_count: number }>("/api/docker/recipes"),
    retry: false,
  });

  const sources = recipeSources(settings);
  const statusOf = (url: string) => recipes.data?.sources.find((s) => s.url === url);

  const save = useMutation({
    mutationFn: (next: RecipeSource[]) => api.put("/api/settings", { recipes_repos: next }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["docker-recipes"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save"),
  });

  const sync = useMutation({
    mutationFn: (url?: string) =>
      api.post<SyncResult>("/api/docker/recipes/refresh", url ? { url } : undefined),
    onSuccess: (result) => {
      setError(null);
      const failed = result.results.filter((r) => !r.ok);
      setNote(
        failed.length
          ? `${failed.map((r) => r.label).join(", ")} failed — the last sync still applies.`
          : `Synced ${result.results.length === 1 ? result.results[0].label : `${result.results.length} sources`}.`,
      );
      qc.invalidateQueries({ queryKey: ["docker-recipes"] });
    },
    onError: (err) => {
      setNote(null);
      setError(err instanceof ApiError ? err.message : "Sync failed");
    },
  });

  function replace(index: number, entry: Partial<RecipeSource>) {
    save.mutate(sources.map((s, i) => (i === index ? { ...s, ...entry } : s)));
  }

  function add() {
    const url = draft.trim();
    // Every save is the whole list: before settings load, `sources` is [] and appending
    // to it would wipe every stored row.
    if (!url || !settings) return;
    setDraft("");
    save.mutate([...sources, { url, enabled: true }]);
  }

  return (
    <section className="border-t border-slate-800 pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-slate-300">Recipe sources</h2>
        {sources.length > 1 && (
          <button
            type="button"
            onClick={() => sync.mutate(undefined)}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Sync all
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Git repos the install wizard syncs recipes from. The first source to define a
        recipe wins, so order is priority.
      </p>

      <ul className="mt-3 space-y-2">
        {sources.map((source, index) => {
          const status = statusOf(source.url);
          return (
            <li
              key={source.url}
              className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
            >
              <input
                type="checkbox"
                checked={source.enabled}
                disabled={save.isPending}
                onChange={(e) => replace(index, { enabled: e.target.checked })}
                aria-label={`Enable ${source.name ?? source.url}`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-teal-500 disabled:opacity-50"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-mono text-xs ${
                    source.enabled ? "text-slate-200" : "text-slate-500 line-through"
                  }`}
                >
                  {source.url}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                  {source.builtin && <span className="text-slate-400">built-in default</span>}
                  {!source.enabled
                    ? "disabled"
                    : !status
                      ? null
                      : status.synced
                        ? `${status.count} ${status.count === 1 ? "recipe" : "recipes"}`
                        : "never synced"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="Sync this source"
                  onClick={() => sync.mutate(source.url)}
                  disabled={!source.enabled || sync.isPending}
                  className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  title="Remove this source"
                  aria-label={`Remove ${source.url}`}
                  onClick={() => save.mutate(sources.filter((_, i) => i !== index))}
                  disabled={save.isPending}
                  className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {sources.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">
          No git sources. The wizard still lists anything in <code>data/recipes</code>.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="https://github.com/you/loskai-recipes"
          aria-label="Recipe source URL"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-teal-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || !settings || save.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </button>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        <code>data/recipes</code> is always scanned last — drop a folder in for a private
        or in-progress recipe.
        {recipes.data?.local_count ? ` ${recipes.data.local_count} there now.` : null}
      </p>

      {note && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300">
          <Check className="h-3.5 w-3.5" /> {note}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </section>
  );
}
