import { Loader2 } from "lucide-react";

import { HostSelect } from "./HostSelect";
import type { HostOption } from "./hostOptions";
import type { RouteFieldsState } from "./useRouteFields";
import { INPUT } from "../../lib/ui";
import { Hint } from "../shared/Hint";

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

// The prefix and the upstream — host, port, and whether it speaks HTTPS. Each modal keeps
// its own chrome and submit, and shows where it will open (`OpensAt`) above them.
//
// `link`: the same address for a link (Phase 45) — no prefix (the form asks for a name
// instead), and an address the browser opens rather than one Caddy dials.
export function RouteFields({
  fields,
  autoFocus = false,
  follow,
  hosts = [],
  link = false,
}: {
  fields: RouteFieldsState;
  autoFocus?: boolean;
  follow?: FollowState;
  // The host dropdown's options: the Docker host, this container, the named machines.
  hosts?: HostOption[];
  link?: boolean;
}) {
  const following = Boolean(follow?.on);
  const typedPort = fields.port !== "";
  const hostHelp = following
    ? "Follows the container — Loskai rewrites this when its port changes."
    : link
      ? "Opened from the browser — a LAN IP and port, never a container's name."
      : fields.upstreamHelp;
  return (
    <>
      {!link && (
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
          {fields.prefix && !fields.prefixOk && (
            <span className="mt-1 block text-xs text-rose-400">
              Single DNS label only: lowercase letters, digits, hyphens.
            </span>
          )}
        </label>
      )}

      {/* Host and port on one row: the host is the half usually picked from a list, the
          port the half usually typed. */}
      <div className="mt-3 flex gap-2">
        {/* A <div>, not a <label>: a label would name the hint's button instead of the
            field. HostSelect names itself (aria-label "Host"). */}
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            <Hint text={hostHelp}>Host</Hint>
          </span>
          <HostSelect
            value={fields.host}
            options={hosts}
            placeholder={fields.hostHint}
            readOnly={following}
            onType={fields.setHost}
            onPick={(option) => fields.setHost(option.address)}
            className={following ? `${INPUT} cursor-default text-slate-400` : INPUT}
          />
        </div>
        <label className="block w-24 shrink-0">
          <span className="mb-1 block text-xs font-medium text-slate-400">Port</span>
          <input
            aria-label="Port"
            inputMode="numeric"
            value={fields.port}
            onChange={(e) => fields.setPort(e.target.value)}
            placeholder="3000"
            readOnly={following}
            className={following ? `${INPUT} cursor-default text-slate-400` : INPUT}
          />
        </label>
      </div>
      {!following && fields.host && !fields.hostOk && (
        <span className="mt-1 block text-xs text-rose-400">
          Just the host — no scheme (http://), path or port.
        </span>
      )}
      {!following && typedPort && !fields.portOk && (
        <span className="mt-1 block text-xs text-rose-400">The port is a number, 1–65535.</span>
      )}
      {/* Buttons sit outside the <label>s: a button inside one also focuses its input. */}
      {follow && following && (
        <button type="button" onClick={() => follow.set(false)} className={`mt-1 ${LINK}`}>
          Set by hand
        </button>
      )}
      {follow && !following && follow.derived && (
        <button
          type="button"
          onClick={() => follow.set(true)}
          className={`mt-1 ${LINK}`}
        >
          Follow the container ({follow.derived})
        </button>
      )}
      {follow && !following && !follow.derived && (
        <span className="mt-1 block text-xs text-slate-500">
          Docker can't name this container's port, so it can't follow it. Give it a{" "}
          <code className="text-slate-400">loskai.port</code> label to change that.
        </span>
      )}
      <label
        title={
          link
            ? "Open it with https:// — the browser shows its certificate warning if it is self-signed"
            : "Dial the upstream over TLS, accepting a self-signed certificate (e.g. Proxmox)"
        }
        className="mt-3 flex w-fit items-center gap-2 text-xs text-slate-400"
      >
        <input
          type="checkbox"
          checked={fields.tls}
          onChange={(e) => fields.setTls(e.target.checked)}
          className="accent-teal-500"
        />
        {link ? "Opens over HTTPS" : "Backend speaks HTTPS"}
      </label>
    </>
  );
}

// Both route forms end the same way: Cancel, and the submit — spinning while it saves.
export function RouteFormFooter({
  label,
  pending,
  disabled,
  onCancel,
  onSubmit,
}: {
  label: string;
  pending: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button onClick={onCancel} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
        Cancel
      </button>
      <button
        disabled={disabled}
        onClick={onSubmit}
        className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  );
}

// Where a route or link will open once saved (`fields.opensAt`), above a form's buttons.
export function OpensAt({ url }: { url: string }) {
  return (
    <p className="mt-4 text-xs text-slate-500">
      → <span className="font-mono text-slate-300">{url}</span>
    </p>
  );
}
