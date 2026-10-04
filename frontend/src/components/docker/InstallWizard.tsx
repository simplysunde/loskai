import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { pathProblem } from "../../lib/validation";
import { Modal } from "../shared/Modal";

interface RecipeEnv {
  key: string;
  label: string;
  default?: string;
  secret?: boolean;
  // `path`: a host folder mounted into the container — the wizard says where it lands.
  type?: "text" | "path";
}
interface Recipe {
  id: string;
  name: string;
  type: string;
  description?: string;
  env: RecipeEnv[];
  suggested_subdomain?: string;
  service?: string | null;
  // instructions.md, verbatim. Shown before the form — it is the recipe's own
  // walk-through, and the only place a recipe author can say "log in with admin/admin".
  instructions: string;
  source: string;
  source_url?: string | null;
}
interface RecipeList {
  recipes: Recipe[];
  invalid: { id: string; source: string; error: string }[];
  // A recipe id defined by more than one source: `source` lost, `shadowed_by` won.
  shadowed: { id: string; source: string; shadowed_by: string }[];
  sources: { url: string; label: string; enabled: boolean; synced: boolean; count: number }[];
  local_count: number;
}
interface InstallResult {
  ok: boolean;
  output: string;
  container: string | null;
  warning?: string;
  // The stack folder already held data (left by a Delete that kept it), and it was reused.
  reused_data?: boolean;
}

// Multi-step wizard: pick a recipe -> read what it will do -> fill the manifest's env
// form -> deploy. Recipes are the merged set from every enabled source in priority order
// (first one to define an id wins; the losers are flagged, never hidden).
export function InstallWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<InstallResult | null>(null);

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
      api.post<InstallResult>(`/api/docker/recipes/${recipe.id}/install`, { answers }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      // The install registers an instance, which the Routing table and dashboard read.
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
  });

  function pick(recipe: Recipe) {
    setSelected(recipe);
    setReviewed(false);
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
        <ResultStep result={result} recipe={selected} onClose={onClose} />
      ) : selected && reviewed ? (
        <FillStep
          recipe={selected}
          answers={answers}
          setAnswers={setAnswers}
          pending={install.isPending}
          error={install.error instanceof ApiError ? install.error.message : null}
          onBack={() => setReviewed(false)}
          onInstall={() => install.mutate(selected)}
        />
      ) : selected ? (
        <ReviewStep
          recipe={selected}
          onBack={() => setSelected(null)}
          onContinue={() => setReviewed(true)}
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

// Why nothing is listed — three different problems with three different fixes, so the
// empty state has to say which one it is rather than "no recipes".
function EmptyState({ data }: { data?: RecipeList }) {
  const enabled = (data?.sources ?? []).filter((s) => s.enabled);
  const message = !enabled.length
    ? data?.local_count
      ? "Every recipe here is local. Add a git source in Settings > General for the shared set."
      : "No recipe sources are enabled. Add one in Settings > General, or drop a folder in data/recipes."
    : enabled.every((s) => !s.synced)
      ? `${enabled.map((s) => s.label).join(", ")} has never synced — hit Refresh recipes.`
      : "Nothing in the synced sources. Push a recipe folder, then refresh.";
  return (
    <div className="rounded-xl border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
      {message}
    </div>
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
        <EmptyState data={data} />
      ) : (
        <div className="grid gap-2">
          {data.recipes.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-left hover:border-teal-600/50"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-100">{r.name}</div>
                <div className="truncate text-xs text-slate-500">{r.description ?? r.type}</div>
              </div>
              <span
                title={r.source_url ?? "data/recipes"}
                className="ml-3 shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
              >
                {r.source} · {r.type}
              </span>
            </button>
          ))}
        </div>
      )}
      {data?.shadowed.length ? (
        <p className="mt-3 text-xs text-slate-500">
          {data.shadowed.map((s) => `${s.id} (${s.source} copy hidden by ${s.shadowed_by})`).join(", ")}
        </p>
      ) : null}
      {data?.invalid.length ? (
        <p className="mt-2 text-xs text-amber-400/80">
          {data.invalid.length} recipe(s) skipped (invalid):{" "}
          {data.invalid.map((i) => `${i.id} — ${i.error}`).join("; ")}
        </p>
      ) : null}
    </div>
  );
}

// Step 1: what this install is about to do, and the recipe's own instructions.md. Shown
// before the form so the answers are filled in with the walk-through already read.
function ReviewStep({
  recipe,
  onBack,
  onContinue,
}: {
  recipe: Recipe;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs">
        <Row label="Stack">
          <code className="text-slate-300">{recipe.id}/</code> in the stacks directory —
          compose.yml plus a generated .env
        </Row>
        <Row label="Install">
          <code className="text-slate-300">{recipe.type}</code>
          {recipe.type === "git_build" ? " — clones the repo, then builds locally" : ""}
          {recipe.type === "registry_pull"
            ? " — needs docker login on the host, done once"
            : ""}
        </Row>
        {paths(recipe).length > 0 && (
          <Row label="Data">
            {paths(recipe).map((e) => (
              <span key={e.key} className="block">
                {e.label}:{" "}
                {e.default ? (
                  <code className="text-slate-300">{e.default}</code>
                ) : (
                  <span className="text-slate-300">you choose</span>
                )}
                {e.default ? ` — ${pathWhere(e.default, recipe.id).short}` : ""}
              </span>
            ))}
          </Row>
        )}
        <Row label="Asks for">
          {recipe.env.length
            ? recipe.env.map((e) => e.key).join(", ")
            : "nothing — the compose file needs no variables"}
        </Row>
        <Row label="From">
          {recipe.source}
          {recipe.source_url ? ` · ${recipe.source_url}` : " · data/recipes"}
        </Row>
      </dl>

      {recipe.instructions ? (
        // Rendered as plain preformatted text, not parsed: Markdown here would mean a new
        // dependency to display a file whose whole job is being readable as it is.
        <div>
          <p className="mb-1 text-xs font-medium text-slate-400">Instructions</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-300">
            {recipe.instructions}
          </pre>
        </div>
      ) : null}

      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Back
        </button>
        <button
          onClick={onContinue}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-400">{children}</dd>
    </div>
  );
}

function ResultStep({
  result,
  recipe,
  onClose,
}: {
  result: InstallResult;
  recipe: Recipe | null;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className={result.ok ? "text-emerald-400" : "text-amber-300"}>
        {result.ok ? "Deployed." : "Finished with errors — check the output."}
      </p>
      {result.ok && result.reused_data && (
        <p className="text-sm text-slate-300">
          Picked up the data left in its folder by an earlier install.
        </p>
      )}
      {result.warning && (
        <p className="flex items-start gap-2 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {result.warning}
        </p>
      )}
      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
        {result.output || "(no output)"}
      </pre>
      {result.ok && recipe?.suggested_subdomain && (
        <p className="text-sm text-slate-400">
          Suggested subdomain: <span className="text-teal-300">{recipe.suggested_subdomain}</span> —
          assign it from the Routing tab.
        </p>
      )}
      <div className="flex justify-end">
        <button onClick={onClose} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500">
          Done
        </button>
      </div>
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
            placeholder={e.type === "path" ? "./data or /srv/media" : undefined}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          {e.type === "path" && <PathNote value={answers[e.key] ?? ""} recipeId={recipe.id} />}
        </label>
      ))}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Back
        </button>
        <button
          onClick={onInstall}
          disabled={pending || paths(recipe).some((e) => !pathOk(answers[e.key] ?? ""))}
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Deploy
        </button>
      </div>
    </div>
  );
}

const paths = (recipe: Recipe) => recipe.env.filter((e) => e.type === "path");
const pathOk = (value: string) => value.trim() !== "" && pathProblem(value) === null;

// Where a mounted folder ends up, in the terms that matter: beside the compose file (kept
// when the stack is deleted, unless that is ticked), or anywhere else on the Docker host
// (never touched by Loskai). Compose resolves a relative path against the stack folder.
function pathWhere(value: string, recipeId: string): { short: string; long: string } {
  const v = value.trim();
  if (v.startsWith("/")) {
    return {
      short: "on the Docker host",
      long: "On the Docker host. Loskai never deletes it — if it doesn't exist, Docker creates it, owned by root.",
    };
  }
  const shown = `stacks/${recipeId}/${v.replace(/^\.\//, "")}`;
  return {
    short: "in its own folder",
    long: `In its own folder: ${shown}. Kept when the stack is deleted, unless you tick "Also delete its data".`,
  };
}

function PathNote({ value, recipeId }: { value: string; recipeId: string }) {
  const problem = value.trim() ? pathProblem(value) : "Required — the folder to mount.";
  return (
    <span className={`mt-1 block text-xs ${problem ? "text-rose-400" : "text-slate-500"}`}>
      {problem ?? pathWhere(value, recipeId).long}
    </span>
  );
}
