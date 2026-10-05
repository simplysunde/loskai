import { useState, type ReactNode } from "react";

import { HostSelect } from "./HostSelect";
import type { HostOption } from "./hostOptions";
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
  hosts = [],
  machine = null,
  onHostPick,
}: {
  fields: RouteFieldsState;
  autoFocus?: boolean;
  preview?: ReactNode;
  follow?: FollowState;
  // The host dropdown's options, and which machine (if any) the route is linked to. A pick
  // reports its option, typing reports null — the form decides what that does to its link.
  hosts?: HostOption[];
  machine?: string | null;
  onHostPick?: (option: HostOption | null) => void;
}) {
  const following = Boolean(follow?.on);
  const machines = hosts.filter((h) => h.machine);
  const addresses = hosts.filter((h) => !h.machine);
  const linked = machine ? machines.find((h) => h.machine === machine) : undefined;
  // Machine mode: the host is picked by name and the route is linked. Address mode: typed,
  // or picked from the Docker host / this container. Starts on whichever the route is.
  const [byMachine, setByMachine] = useState(Boolean(machine));
  const showToggle = machines.length > 0 && !following;
  const machineMode = showToggle && byMachine;
  const typedPort = fields.port !== "";
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

      {showToggle && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Upstream</span>
          <div className="flex gap-0.5 rounded-lg border border-slate-800 p-0.5">
            <ModeButton
              active={machineMode}
              onClick={() => {
                if (machineMode) return;
                setByMachine(true);
                // No guessing a link from a matching IP: the machine is chosen, not inferred.
                fields.setHost("");
                onHostPick?.(null);
              }}
            >
              Machine
            </ModeButton>
            <ModeButton
              active={!machineMode}
              onClick={() => {
                if (!machineMode) return;
                setByMachine(false);
                // The address stays, now as plain text: editable, and no longer followed.
                onHostPick?.(null);
              }}
            >
              Address
            </ModeButton>
          </div>
        </div>
      )}

      {/* Host and port on one row: the host is the half usually picked from a list, the
          port the half usually typed. */}
      <div className={`${showToggle ? "mt-2" : "mt-3"} flex gap-2`}>
        {machineMode ? (
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-400">Machine</span>
            <select
              aria-label="Machine"
              value={linked?.machine ?? ""}
              onChange={(e) => {
                const option = machines.find((h) => h.machine === e.target.value);
                fields.setHost(option?.address ?? "");
                onHostPick?.(option ?? null);
              }}
              className={INPUT}
            >
              <option value="" disabled>
                Choose a machine…
              </option>
              {machines.map((h) => (
                <option key={h.machine} value={h.machine}>
                  {h.label} — {h.address}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-400">Host</span>
            <HostSelect
              value={fields.host}
              options={addresses}
              placeholder={fields.hostHint}
              readOnly={following}
              onType={(value) => {
                fields.setHost(value);
                onHostPick?.(null);
              }}
              onPick={(option) => {
                fields.setHost(option.address);
                onHostPick?.(null);
              }}
              className={following ? `${INPUT} cursor-default text-slate-400` : INPUT}
            />
          </label>
        )}
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
      <span className="mt-1 block text-xs text-slate-500">
        {following
          ? "Follows the container — Loskai rewrites this when its port changes."
          : machineMode
            ? linked
              ? `→ ${linked.address}${fields.port ? `:${fields.port}` : ""} — follows ${linked.label} when its address changes.`
              : "The route follows the machine: move it on the Machines tab and this moves too."
            : fields.upstreamHelp}
      </span>
      {!following && !machineMode && fields.host && !fields.hostOk && (
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
          onClick={() => {
            // Following replaces the machine link, so "Set by hand" comes back to an address.
            setByMachine(false);
            follow.set(true);
          }}
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
    </>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-0.5 text-xs ${
        active ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
