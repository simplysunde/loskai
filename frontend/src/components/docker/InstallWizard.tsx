import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { mountLocation, pathQuestions, syncFailureMessage, useRecipes, type Recipe, type RecipeList, type SyncResult } from "../../lib/recipes";
import { Modal } from "../shared/Modal";
import { refreshRecords } from "../../lib/routes";
import { ConfigureStep } from "./InstallConfigure";
import { DoneStep, type InstallResult } from "./InstallDone";

// Multi-step wizard: choose a recipe -> review what it will do -> configure the manifest's
// env form -> deploy, and route it from the last step. Recipes are the merged set from every
// enabled source in priority order (first one to define an id wins; the losers are flagged,
// never hidden).
export function InstallWizard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<string[]>([]);
  const [optionsOn, setOptionsOn] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<InstallResult | null>(null);

  const { data, isLoading } = useRecipes();

  const refresh = useMutation({
    mutationFn: () => api.post<SyncResult>("/api/docker/recipes/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-recipes"] }),
  });

  // A source that has never synced has nothing to list — a new install's catalog was empty
  // until someone found Refresh recipes. So opening the catalog fetches it, once; every
  // later sync is the button's.
  const neverSynced = (data?.sources ?? []).some((s) => s.enabled && !s.synced);
  const fetchedFirst = useRef(false);
  const { mutate: syncSources } = refresh;
  useEffect(() => {
    if (!neverSynced || fetchedFirst.current) return;
    fetchedFirst.current = true;
    syncSources();
  }, [neverSynced, syncSources]);

  const install = useMutation({
    mutationFn: (recipe: Recipe) =>
      api.post<InstallResult>(`/api/docker/recipes/${recipe.id}/install`, {
        answers,
        mounts: folders.filter((f) => f.trim() !== ""),
        options: Object.keys(optionsOn).filter((id) => optionsOn[id]),
      }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      // The install registers an instance, which the Routing table and dashboard read.
      refreshRecords(qc);
    },
  });

  function pick(recipe: Recipe) {
    setSelected(recipe);
    setReviewed(false);
    const seed: Record<string, string> = {};
    for (const e of recipe.env) seed[e.key] = e.default ?? "";
    setAnswers(seed);
    // One empty row to start, so the field reads as something to fill in.
    setFolders(recipe.mounts ? [""] : []);
    setOptionsOn({});
    setResult(null);
  }

  const title = result ? "Installed" : selected ? `Install ${selected.name}` : "Install from a recipe";

  const step = result ? 3 : selected && reviewed ? 2 : selected ? 1 : 0;
  // Earlier steps stay reachable until the install has run; after it, there is no undo.
  const goTo = (target: number) => {
    if (result || target >= step) return;
    if (target === 0) setSelected(null);
    if (target <= 1) setReviewed(false);
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      <Steps current={step} onGo={goTo} locked={result !== null} />
      {result ? (
        <DoneStep result={result} recipe={selected} onClose={onClose} />
      ) : selected && reviewed ? (
        <ConfigureStep
          recipe={selected}
          answers={answers}
          setAnswers={setAnswers}
          folders={folders}
          setFolders={setFolders}
          optionsOn={optionsOn}
          setOptionsOn={setOptionsOn}
          pending={install.isPending}
          error={install.error ? apiMessage(install.error, "Install failed") : null}
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
        <ChooseStep
          data={data}
          loading={isLoading || (refresh.isPending && !data?.recipes.length)}
          refreshing={refresh.isPending}
          refreshFailed={
            refresh.error ? apiMessage(refresh.error, "Sync failed") : refresh.data ? syncFailureMessage(refresh.data) : null
          }
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

const STEPS = ["Choose", "Review", "Configure", "Done"];

function Steps({
  current,
  onGo,
  locked,
}: {
  current: number;
  onGo: (step: number) => void;
  locked: boolean;
}) {
  return (
    <ol className="mb-5 flex items-center gap-1.5 text-xs">
      {STEPS.map((label, i) => {
        const done = i < current;
        const reachable = done && !locked;
        return (
          <Fragment key={label}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-700" />}
            <li>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onGo(i)}
                aria-current={i === current ? "step" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                  i === current
                    ? "bg-teal-500/15 text-teal-200"
                    : done
                      ? `text-slate-300 ${reachable ? "hover:bg-slate-800" : ""}`
                      : "text-slate-600"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                    done ? "bg-teal-600 text-white" : i === current ? "bg-teal-500/30" : "bg-slate-800"
                  }`}
                >
                  {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
                </span>
                {label}
              </button>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function ChooseStep({
  data,
  loading,
  refreshing,
  refreshFailed,
  onRefresh,
  onPick,
}: {
  data?: RecipeList;
  loading: boolean;
  refreshing: boolean;
  refreshFailed: string | null;
  onRefresh: () => void;
  onPick: (r: Recipe) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const recipes = (data?.recipes ?? []).filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q),
  );
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            aria-label="Search recipes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
        </label>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="Pull every enabled recipe source"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh recipes
        </button>
      </div>
      {refreshFailed && <p className="-mt-2 mb-3 text-xs text-amber-300">{refreshFailed}</p>}
      {loading ? (
        <div className="flex justify-center py-10 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !data?.recipes.length ? (
        <EmptyState data={data} />
      ) : !recipes.length ? (
        <p className="py-10 text-center text-sm text-slate-500">No recipe matches “{query.trim()}”.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-teal-600/50 hover:bg-slate-900"
            >
              <div className="flex items-center gap-3">
                {r.icon ? (
                  <img
                    src={`/api/docker/recipes/${encodeURIComponent(r.id)}/icon`}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg bg-slate-800/60 object-contain p-1"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-sm font-semibold text-teal-300">
                    {r.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 truncate font-medium text-slate-100">{r.name}</span>
              </div>
              <p className="line-clamp-2 min-h-[2.5rem] text-xs text-slate-400">
                {r.description ?? "No description."}
              </p>
              <span
                title={r.source_url ?? "data/recipes"}
                className="mt-auto self-start rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500"
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
        </Row>
        {pathQuestions(recipe).length > 0 && (
          <Row label="Data">
            {pathQuestions(recipe).map((e) => (
              <span key={e.key} className="block">
                {e.label}:{" "}
                {e.default ? (
                  <code className="text-slate-300">{e.default}</code>
                ) : (
                  <span className="text-slate-300">you choose</span>
                )}
                {e.default ? ` — ${mountLocation(e.default, recipe.id).short}` : ""}
              </span>
            ))}
          </Row>
        )}
        {recipe.mounts && (
          <Row label="Folders">
            {recipe.mounts.label}: you add them — each lands at{" "}
            <code className="text-slate-300">{recipe.mounts.target}/&lt;its name&gt;</code>
            {recipe.mounts.read_only ? ", read-only" : ""}
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
