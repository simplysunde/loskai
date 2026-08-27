import type { ReactNode } from "react";

import type { RouteFieldsState } from "./useRouteFields";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

// The two inputs themselves. Each modal keeps its own chrome, TLS checkbox and submit —
// `preview` is the slot for the FQDN line AssignModal shows under the prefix (AddRouteModal
// renders its own further down, next to the submit).
export function RouteFields({
  fields,
  autoFocus = false,
  preview,
}: {
  fields: RouteFieldsState;
  autoFocus?: boolean;
  preview?: ReactNode;
}) {
  const { isDnsOnly } = fields;

  return (
    <>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          {isDnsOnly ? "Hostname (dots allowed)" : "Subdomain prefix"}
        </span>
        <input
          autoFocus={autoFocus}
          value={fields.prefix}
          onChange={(e) => fields.setPrefix(e.target.value)}
          placeholder={isDnsOnly ? "rack1.vm3" : "grafana"}
          className={INPUT}
        />
        {preview}
        {fields.prefix && !fields.prefixOk && (
          <span className="mt-1 block text-xs text-rose-400">
            {isDnsOnly
              ? "Each dot-separated label: lowercase letters, digits, hyphens."
              : "Single DNS label only: lowercase letters, digits, hyphens."}
          </span>
        )}
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          {isDnsOnly ? "Machine IP" : "Upstream (host:port)"}
        </span>
        <input
          value={fields.upstream}
          onChange={(e) => fields.setUpstream(e.target.value)}
          placeholder={fields.upstreamHint}
          className={INPUT}
        />
        <span className="mt-1 block text-xs text-slate-500">{fields.upstreamHelp}</span>
        {fields.upstream && !fields.upstreamOk && (
          <span className="mt-1 block text-xs text-rose-400">
            {isDnsOnly ? "A bare IPv4 address — no port." : "Use host:port — no scheme (http://) or path."}
          </span>
        )}
      </label>
    </>
  );
}
