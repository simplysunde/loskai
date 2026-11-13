import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { Link } from "react-router-dom";

import { api, apiMessage } from "../../lib/api";
import { syncFailed, type SyncResult } from "../../lib/recipes";
import { RouteLink } from "../shared/RouteLink";
import { useContainers } from "../../lib/containers";
import { useCaddySetUp } from "../../lib/useHealth";
import { useSettings } from "../../lib/settings";
import { isValidPrefix, pathProblem } from "../../lib/validation";
import { containerPrefill, suggestPrefix } from "../routing/containerPrefill";
import { Modal } from "../shared/Modal";
import { OptionList, type RecipeOption } from "./RecipeOptions";
import { INPUT } from "../../lib/ui";

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
  // Where a link the app logs after install points (a login): the last step shows it.
  log_link?: string | null;
  // Folders the user adds at install, however many they have: each lands at
  // `target/<its name>`. Written to compose.override.yml, never into the recipe's file.
  mounts?: { label: string; target: string; read_only: boolean } | null;
  // Features switched on at install (a GPU, say), each added to the override when on.
  options?: RecipeOption[];
  // instructions.md, verbatim. Shown before the form — it is the recipe's own
  // walk-through, and the only place a recipe author can say "log in with admin/admin".
  instructions: string;
  // The recipe ships an icon.png — shown here, and given to the route at install.
  icon?: boolean;
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
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<InstallResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["docker-recipes"],
    queryFn: () => api.get<RecipeList>("/api/docker/recipes"),
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: () => api.post<SyncResult>("/api/docker/recipes/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-recipes"] }),
  });

  const install = useMutation({
    mutationFn: (recipe: Recipe) =>
      api.post<InstallResult>(`/api/docker/recipes/${recipe.id}/install`, {
        answers,
        mounts: folders.filter((f) => f.trim() !== ""),
        options: Object.keys(chosen).filter((id) => chosen[id]),
      }),
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
    // One empty row to start, so the field reads as something to fill in.
    setFolders(recipe.mounts ? [""] : []);
    setChosen({});
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
        <ResultStep result={result} recipe={selected} onClose={onClose} />
      ) : selected && reviewed ? (
        <FillStep
          recipe={selected}
          answers={answers}
          setAnswers={setAnswers}
          folders={folders}
          setFolders={setFolders}
          chosen={chosen}
          setChosen={setChosen}
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
        <PickStep
          data={data}
          loading={isLoading}
          refreshing={refresh.isPending}
          refreshFailed={
            refresh.error ? apiMessage(refresh.error, "Sync failed") : refresh.data ? syncFailed(refresh.data) : null
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

function PickStep({
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

function ResultStep({
  result,
  recipe,
  onClose,
}: {
  result: InstallResult;
  recipe: Recipe | null;
  onClose: () => void;
}) {
  // A Loskai run without Caddy offers no route it can't make — a link to the Dashboard instead.
  const routing = useCaddySetUp();
  return (
    <div className="space-y-3">
      <p className={result.ok ? "text-emerald-400" : "text-amber-300"}>
        {result.ok ? "Deployed." : "Finished with errors — check the output."}
      </p>
      {result.ok && result.reused_data && (
        <p className="text-sm text-slate-300">
          Picked up the data already in its folder.
        </p>
      )}
      {result.warning && (
        <p className="flex items-start gap-2 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {result.warning}
        </p>
      )}
      {result.ok && result.container && recipe?.log_link && (
        <LogLink prefix={recipe.log_link} container={result.container} />
      )}
      {result.ok && result.container && recipe && routing && (
        <RouteNow recipe={recipe} containerName={result.container} />
      )}
      {result.ok && result.container && recipe && !routing && (
        <LinkNow recipe={recipe} containerName={result.container} />
      )}
      <details className="text-xs text-slate-500" open={!result.ok}>
        <summary className="cursor-pointer select-none hover:text-slate-300">Output</summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
          {result.output || "(no output)"}
        </pre>
      </details>
      <div className="flex justify-end">
        <button onClick={onClose} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500">
          Done
        </button>
      </div>
    </div>
  );
}

// The newest link under the recipe's `log_link` in the container's logs — a login, say,
// that the app prints once it starts and replaces when it restarts. Only links under that
// prefix: the container decides the rest of the address, never which site it is on.
function LogLink({ prefix, container }: { prefix: string; container: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The rest of the address is the characters a URL is made of — not a quote, a bracket
    // or a colour code a log wraps it in — less a sentence's full stop or comma at its end.
    const pattern = new RegExp(`${escaped}[A-Za-z0-9\\-._~:/?#@!$&*+,;=%]*`, "g");
    const es = new EventSource(`/api/docker/containers/${encodeURIComponent(container)}/logs`);
    es.onmessage = (e) => {
      const found = String(e.data).match(pattern);
      if (found) setUrl(found[found.length - 1].replace(/[.,;:!?]+$/, ""));
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [prefix, container]);

  const box = "rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm";
  if (!url) {
    return (
      <div className={`${box} flex items-center gap-2 text-slate-500`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Waiting for its link…
      </div>
    );
  }
  return (
    <div className={box} title="From the container's logs — the instructions say what it is for">
      <p className="mb-1 font-medium text-slate-200">Open its link</p>
      <a href={url} target="_blank" rel="noreferrer" className="block truncate text-teal-300 underline underline-offset-2">
        {url}
      </a>
    </div>
  );
}

interface RouteResult {
  url: string;
  warning: string | null;
}

// Without Caddy, the install's last step puts it on the Dashboard: a link to where a browser
// reaches it — the Docker host and its published port — following the container, so a new
// port moves the link. Where that can't be named, it says why: no Docker host IP set (the
// usual case on a fresh Loskai-alone install), or no single port a browser can reach.
function LinkNow({ recipe, containerName }: { recipe: Recipe; containerName: string }) {
  const qc = useQueryClient();
  const containers = useContainers();
  const container = containers.data?.find((c) => c.name === containerName);
  const hostIp = useSettings().data?.host_ip?.value;
  const [name, setName] = useState(recipe.name);

  const link = useMutation({
    mutationFn: () =>
      api.post<RouteResult>("/api/links", {
        name: name.trim(),
        upstream: container?.published_upstream ?? "",
        container: containerName,
        follow_container: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const box = "rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm";
  if (containers.isLoading) {
    return (
      <div className={`${box} flex items-center gap-2 text-slate-500`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Looking up its container…
      </div>
    );
  }
  const url = link.data?.url ?? container?.url;
  if (url) {
    return (
      <div className={`${box} text-emerald-300`}>
        On the Dashboard at{" "}
        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {url}
        </a>
      </div>
    );
  }
  if (!container?.published_upstream) {
    const routing = (
      <Link to="/routing" className="text-teal-300 underline underline-offset-2">
        Routing tab
      </Link>
    );
    return (
      <div className={`${box} text-slate-400`}>
        {hostIp ? (
          <>
            It has no single port a browser can reach — none published, several, or only on
            127.0.0.1 — so link it from the {routing}, where you can type the address.
          </>
        ) : (
          <>
            Loskai doesn't know this host's LAN IP, so it can't say where a browser reaches it.
            Set <span className="text-slate-300">Docker Host LAN IP</span> in{" "}
            <Link to="/settings" className="text-teal-300 underline underline-offset-2">
              Settings
            </Link>
            , or link it from the {routing}, where you can type the address.
          </>
        )}
      </div>
    );
  }
  return (
    <div className={box}>
      <p className="mb-2 font-medium text-slate-200">Put it on the Dashboard</p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-teal-500"
        />
        <span className="min-w-0 truncate font-mono text-xs text-slate-500">http://{container.published_upstream}</span>
        <button
          onClick={() => link.mutate()}
          disabled={!name.trim() || link.isPending}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {link.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add link
        </button>
      </div>
      {link.isError && <p className="mt-2 text-xs text-rose-400">{apiMessage(link.error, "Couldn't add the link")}</p>}
    </div>
  );
}

// The install's last step routes it: the recipe's suggested name, and an upstream that
// follows the container (the server derives it from Docker, as the route forms do). Anything
// more particular — a scheme, a machine, a port Docker can't name — is the Routing tab's.
function RouteNow({ recipe, containerName }: { recipe: Recipe; containerName: string }) {
  const qc = useQueryClient();
  const containers = useContainers();
  const settings = useSettings();
  const container = containers.data?.find((c) => c.name === containerName);
  const prefill = container ? containerPrefill(container) : null;
  const [prefix, setPrefix] = useState<string | null>(null);
  const value = prefix ?? (recipe.suggested_subdomain ? suggestPrefix(recipe.suggested_subdomain) : prefill?.prefix ?? "");
  const baseDomain = settings.data?.base_domain?.value ?? null;

  const route = useMutation({
    mutationFn: () =>
      api.post<RouteResult>("/api/routes", {
        prefix: value,
        upstream: prefill?.upstream ?? "",
        container: containerName,
        follow_container: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const box = "rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm";
  if (containers.isLoading) {
    return (
      <div className={`${box} flex items-center gap-2 text-slate-500`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Looking up its container…
      </div>
    );
  }
  if (route.data) {
    return (
      <div className={`${box} text-emerald-300`}>
        Routed at{" "}
        <a href={route.data.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {route.data.url}
        </a>
        {route.data.warning && <span className="mt-1 block text-amber-300">{route.data.warning}</span>}
      </div>
    );
  }
  // A reinstall keeps its earlier record, route included — where it opens is the server's.
  if (container?.subdomain) {
    return (
      <div className={`${box} text-slate-400`}>
        Already routed{container.url ? <> at <RouteLink url={container.url} /></> : ""}.
      </div>
    );
  }
  if (!container?.suggested_upstream) {
    return (
      <div className={`${box} text-slate-400`}>
        Docker can't name this container's port, so route it from the{" "}
        <Link to="/routing" className="text-teal-300 underline underline-offset-2">
          Routing tab
        </Link>{" "}
        — Add route → Container, where you can type it.
      </div>
    );
  }

  const ok = isValidPrefix(value);
  return (
    <div className={box}>
      <p className="mb-2 font-medium text-slate-200">Route it</p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Subdomain prefix"
          value={value}
          onChange={(e) => setPrefix(e.target.value.toLowerCase())}
          className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-teal-500"
        />
        <span className="min-w-0 truncate text-slate-500">.{baseDomain ?? "BASE_DOMAIN"}</span>
        <button
          onClick={() => route.mutate()}
          disabled={!ok || route.isPending}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {route.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add route
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {value && !ok
          ? "Single DNS label only: lowercase letters, digits, hyphens."
          : `→ ${container.suggested_upstream}, following the container if its port changes. Scheme and the rest are on the Routing tab.`}
      </p>
      {route.error && (
        <p className="mt-1 text-xs text-rose-400">
          {apiMessage(route.error, "Routing failed")}
        </p>
      )}
    </div>
  );
}

function FillStep({
  recipe,
  answers,
  setAnswers,
  folders,
  setFolders,
  chosen,
  setChosen,
  pending,
  error,
  onBack,
  onInstall,
}: {
  recipe: Recipe;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  folders: string[];
  setFolders: (f: string[]) => void;
  chosen: Record<string, boolean>;
  setChosen: (c: Record<string, boolean>) => void;
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
            className={INPUT}
          />
          {e.type === "path" && <PathNote value={answers[e.key] ?? ""} recipeId={recipe.id} />}
        </label>
      ))}
      {recipe.mounts && (
        <FolderRows spec={recipe.mounts} folders={folders} setFolders={setFolders} />
      )}
      {recipe.options && recipe.options.length > 0 && (
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Options</span>
          <OptionList
            options={recipe.options}
            on={chosen}
            onChange={(id, value) => setChosen({ ...chosen, [id]: value })}
          />
        </div>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Back
        </button>
        <button
          onClick={onInstall}
          disabled={
            pending ||
            paths(recipe).some((e) => !pathOk(answers[e.key] ?? "")) ||
            (recipe.mounts != null && folderProblems(folders).some(Boolean))
          }
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

// Where each added folder lands, or why it can't: the same checks as a path field, plus
// the two a folder list adds — a folder with no name of its own (`/`), and two folders
// that would land at one place. A blank row is skipped, not an error.
function folderProblems(folders: string[]): (string | null)[] {
  const names = folders.map((f) => f.trim().replace(/\/+$/, "").split("/").pop() ?? "");
  return folders.map((f, i) => {
    if (!f.trim()) return null;
    const problem = pathProblem(f);
    if (problem) return problem;
    if (["", ".", ".."].includes(names[i])) return `'${f.trim()}' has no folder name to mount it under.`;
    const other = names.findIndex((n, j) => j !== i && n === names[i] && folders[j].trim());
    if (other !== -1) return `Lands at the same place as '${folders[other].trim()}' — rename one, or mount their parent.`;
    return null;
  });
}

function FolderRows({
  spec,
  folders,
  setFolders,
}: {
  spec: NonNullable<Recipe["mounts"]>;
  folders: string[];
  setFolders: (f: string[]) => void;
}) {
  const problems = folderProblems(folders);
  const base = spec.target.replace(/\/+$/, "");
  const set = (i: number, value: string) => setFolders(folders.map((f, j) => (j === i ? value : f)));
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-400">{spec.label}</span>
      <div className="space-y-2">
        {folders.map((f, i) => (
          <div key={i}>
            <div className="flex gap-2">
              <input
                aria-label={`${spec.label} ${i + 1}`}
                value={f}
                onChange={(ev) => set(i, ev.target.value)}
                placeholder="/srv/media/movies"
                className={INPUT}
              />
              <button
                onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                aria-label="Remove folder"
                className="rounded-lg px-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {f.trim() && (
              <span className={`mt-1 block text-xs ${problems[i] ? "text-rose-400" : "text-slate-500"}`}>
                {problems[i] ??
                  `→ ${base}/${f.trim().replace(/\/+$/, "").split("/").pop()}${spec.read_only ? ", read-only" : ""}`}
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setFolders([...folders, ""])}
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" /> Add folder
      </button>
      <span className="mt-1 block text-xs text-slate-500">
        A folder that doesn't exist on the Docker host fails the deploy — it is never created empty.
      </span>
    </div>
  );
}
