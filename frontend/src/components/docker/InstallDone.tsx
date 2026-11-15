import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { api, apiMessage } from "../../lib/api";
import type { Recipe } from "../../lib/recipes";
import { RouteLink } from "../shared/RouteLink";
import { useContainers } from "../../lib/containers";
import { useCaddySetUp } from "../../lib/useHealth";
import { useSettings } from "../../lib/settings";
import { isValidPrefix } from "../../lib/validation";
import { containerPrefill, suggestPrefix } from "../routing/containerPrefill";
import { refreshRecords } from "../../lib/routes";
import { Hint } from "../shared/Hint";

// The install wizard's last step: what the install did, the link its logs print, and — the
// one place the Docker tab makes one — a route for it, or a link while Caddy isn't set up.

export interface InstallResult {
  ok: boolean;
  output: string;
  container: string | null;
  warning?: string;
  // The stack folder already held data (left by a Delete that kept it), and it was reused.
  reused_data?: boolean;
}

export function DoneStep({
  result,
  recipe,
  onClose,
}: {
  result: InstallResult;
  recipe: Recipe | null;
  onClose: () => void;
}) {
  // A Loskai run without Caddy offers no route it can't make — a link to the Dashboard instead.
  const caddySetUp = useCaddySetUp();
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
      {result.ok && result.container && recipe && caddySetUp && (
        <RouteNow recipe={recipe} containerName={result.container} />
      )}
      {result.ok && result.container && recipe && !caddySetUp && (
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
    <div className={box}>
      <p className="mb-1 font-medium text-slate-200">
        <Hint text="From the container's logs — the instructions say what it is for">Open its link</Hint>
      </p>
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
      refreshRecords(qc);
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
      refreshRecords(qc);
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
