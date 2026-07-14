import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { Modal } from "../shared/Modal";

interface RecipeEnv {
  key: string;
  label: string;
  default?: string;
  secret?: boolean;
}
interface Recipe {
  id: string;
  name: string;
  type: string;
  description?: string;
  env: RecipeEnv[];
  suggested_subdomain?: string;
  source: "repo" | "local";
}
interface RecipeList {
  recipes: Recipe[];
  invalid: { id: string; source: string; error: string }[];
  shadowed: { id: string; shadowed_by: string }[];
}

// Multi-step wizard: pick a recipe -> fill the manifest's env form -> deploy. Recipes are
// the merged repo + local set (repo wins; shadowed local flagged).
export function InstallWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; output: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["docker-recipes"],
    queryFn: () => api.get<RecipeList>("/api/docker/recipes"),
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: () => api.post("/api/docker/recipes/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-recipes"] }),
  });

  const install = useMutation({
    mutationFn: (recipe: Recipe) =>
      api.post<{ ok: boolean; output: string }>(`/api/docker/recipes/${recipe.id}/install`, { answers }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
    },
  });

  function pick(recipe: Recipe) {
    setSelected(recipe);
    const seed: Record<string, string> = {};
    for (const e of recipe.env) seed[e.key] = e.default ?? "";
    setAnswers(seed);
    setResult(null);
  }

  const title = useMemo(() => {
    if (result) return "Installed";
    if (selected) return `Install ${selected.name}`;
    return "Install from a recipe";
  }, [selected, result]);

  return (
    <Modal title={title} onClose={onClose} wide>
      {result ? (
        <div className="space-y-3">
          <p className={result.ok ? "text-emerald-400" : "text-amber-300"}>
            {result.ok ? "Deployed." : "Finished with errors — check the output."}
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
            {result.output || "(no output)"}
          </pre>
          {selected?.suggested_subdomain && (
            <p className="text-sm text-slate-400">
              Suggested subdomain: <span className="text-teal-300">{selected.suggested_subdomain}</span> —
              assign it from the Routing tab.
            </p>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500">
              Done
            </button>
          </div>
        </div>
      ) : selected ? (
        <FillStep
          recipe={selected}
          answers={answers}
          setAnswers={setAnswers}
          pending={install.isPending}
          error={install.error instanceof ApiError ? install.error.message : null}
          onBack={() => setSelected(null)}
          onInstall={() => install.mutate(selected)}
        />
      ) : (
        <PickStep
          data={data}
          loading={isLoading}
          refreshing={refresh.isPending}
          onRefresh={() => refresh.mutate()}
          onPick={pick}
        />
      )}
    </Modal>
  );
}

function PickStep({
  data,
  loading,
  refreshing,
  onRefresh,
  onPick,
}: {
  data?: RecipeList;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onPick: (r: Recipe) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh recipes
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-10 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !data?.recipes.length ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
          No recipes. Set a recipes repo URL in Settings, or drop one in the local recipes dir.
        </div>
      ) : (
        <div className="grid gap-2">
          {data.recipes.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left hover:border-teal-600/50"
            >
              <div>
                <div className="font-medium text-slate-100">{r.name}</div>
                <div className="text-xs text-slate-500">{r.description ?? r.type}</div>
              </div>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {r.source} · {r.type}
              </span>
            </button>
          ))}
        </div>
      )}
      {data?.invalid.length ? (
        <p className="mt-3 text-xs text-amber-400/80">
          {data.invalid.length} recipe(s) skipped (invalid): {data.invalid.map((i) => i.id).join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function FillStep({
  recipe,
  answers,
  setAnswers,
  pending,
  error,
  onBack,
  onInstall,
}: {
  recipe: Recipe;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onInstall: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Creates a stack, writes a generated <code className="text-slate-300">.env</code>, and runs{" "}
        <code className="text-slate-300">{recipe.type}</code>.
      </p>
      {recipe.env.map((e) => (
        <label key={e.key} className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">{e.label}</span>
          <input
            type={e.secret ? "password" : "text"}
            value={answers[e.key] ?? ""}
            onChange={(ev) => setAnswers({ ...answers, [e.key]: ev.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
        </label>
      ))}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Back
        </button>
        <button
          onClick={onInstall}
          disabled={pending}
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Deploy
        </button>
      </div>
    </div>
  );
}
