import type { ReactNode } from "react";

import type { RouteFieldsState } from "./useRouteFields";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

// A container's route can follow it: the upstream is the container's live address, kept in
// step by the backend when its port changes (shared/follow.py). Passed only for a
// container route — its absence means the upstream is always typed.
export interface FollowState {
  on: boolean;
  // The container's address right now, or null when Docker can't name its port.
  derived: string | null;
  set: (on: boolean) => void;
}

const LINK = "text-xs text-teal-400 hover:text-teal-300 hover:underline";

// The two inputs themselves. Each modal keeps its own chrome, TLS checkbox and submit —
// `preview` is the slot for the FQDN line AssignModal shows under the prefix (AddRouteModal
// renders its own further down, next to the submit).
export function RouteFields({
  fields,
  autoFocus = false,
  preview,
  follow,
}: {
  fields: RouteFieldsState;
  autoFocus?: boolean;
  preview?: ReactNode;
  follow?: FollowState;
}) {
  const following = Boolean(follow?.on);
  return (
    <>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Subdomain prefix
        </span>
        <input
          autoFocus={autoFocus}
          value={fields.prefix}
          onChange={(e) => fields.setPrefix(e.target.value)}
          placeholder="grafana"
          className={INPUT}
        />
        {preview}
        {fields.prefix && !fields.prefixOk && (
          <span className="mt-1 block text-xs text-rose-400">
            Single DNS label only: lowercase letters, digits, hyphens.
          </span>
        )}
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-slate-400">
          Upstream (host:port)
        </span>
        <input
          value={fields.upstream}
          onChange={(e) => fields.setUpstream(e.target.value)}
          placeholder={fields.upstreamHint}
          readOnly={following}
          className={following ? `${INPUT} cursor-default text-slate-400` : INPUT}
        />
        <span className="mt-1 block text-xs text-slate-500">
          {following
            ? "Follows the container — Loskai rewrites this when its port changes."
            : fields.upstreamHelp}
        </span>
        {!following && fields.upstream && !fields.upstreamOk && (
          <span className="mt-1 block text-xs text-rose-400">
            Use host:port — no scheme (http://) or path.
          </span>
        )}
      </label>
      {/* Outside the <label>: a button inside one also focuses the input. */}
      {follow && following && (
        <button type="button" onClick={() => follow.set(false)} className={`mt-1 ${LINK}`}>
          Set by hand
        </button>
      )}
      {follow && !following && follow.derived && (
        <button type="button" onClick={() => follow.set(true)} className={`mt-1 ${LINK}`}>
          Follow the container ({follow.derived})
        </button>
      )}
      {follow && !following && !follow.derived && (
        <span className="mt-1 block text-xs text-slate-500">
          Docker can't name this container's port, so it can't follow it. Give it a{" "}
          <code className="text-slate-400">loskai.port</code> label to change that.
        </span>
      )}
    </>
  );
}
