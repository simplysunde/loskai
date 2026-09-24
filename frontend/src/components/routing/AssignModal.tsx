import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";

import { useScrollLock } from "../../lib/useScrollLock";
import { RouteFields } from "./RouteFields";
import type { RouteRow } from "./ServiceTable";
import { useRouteFields } from "./useRouteFields";
import { SchemeSelect, type Scheme } from "./SchemeSelect";
import { isMachine } from "./ViewFilter";

// Assign URL form: a single-label prefix + an upstream host:port, with the assembled FQDN
// shown live. Presentational — submit is handed to onSubmit (wired to /api/routes). The
// upstream hint follows the Caddy mode (Docker names vs LAN IPs). Re-pointing a *machine*
// is a different form entirely and goes to AddMachineModal (Phase 21e).
export function AssignModal({
  open,
  baseDomain,
  mode,
  pending = false,
  error,
  onSubmit,
  onClose,
  initialPrefix = "",
  initialUpstream = "",
  initialTls = false,
  initialMachine = null,
  initialScheme = "https",
  rows = [],
}: {
  open: boolean;
  baseDomain: string | null;
  mode: "docker" | "lan" | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (payload: {
    prefix: string;
    upstream: string;
    upstream_tls: boolean;
    machine?: string | null;
    scheme?: Scheme;
  }) => void;
  onClose: () => void;
  // Prefilled when re-assigning an existing instance (the modal is keyed per target so
  // these seed fresh state on each open).
  initialPrefix?: string;
  initialUpstream?: string;
  initialTls?: boolean;
  // Which machine hosts this route, if any — editable here so a route created before the
  // link existed (or pointed somewhere by hand) can be attached to one without being
  // deleted and rebuilt.
  initialMachine?: string | null;
  initialScheme?: Scheme;
  rows?: RouteRow[];
}) {
  const [machine, setMachine] = useState<string | null>(initialMachine);
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const fields = useRouteFields({
    mode,
    baseDomain,
    initialPrefix,
    initialUpstream,
    initialTls,
  });
  useScrollLock(open);

  if (!open) return null;

  const canSubmit = fields.valid && !pending;
  const machines = rows.filter(isMachine);
  const pickMachine = (m: RouteRow) => {
    setMachine(m.id);
    // Keep the port, take the machine's address — the same swap the backend does when the
    // machine later moves.
    const [, port = ""] = (fields.upstream || ":").split(":");
    fields.set({ upstream: `${m.upstream}:${port}` });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-100">Assign URL</h2>

        <RouteFields
          fields={fields}
          autoFocus
          preview={
            <span className="mt-1 block text-xs text-slate-500">
              → <span className="text-teal-300">{fields.fqdn}</span>
            </span>
          }
        />

        {machines.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-800 p-2">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-400">
              <Link2 className="h-3.5 w-3.5" />
              Hosted on a machine
              {machine && (
                <button
                  onClick={() => setMachine(null)}
                  className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
                >
                  <Link2Off className="h-3 w-3" /> unlink
                </button>
              )}
            </p>
            <div className="max-h-28 space-y-1 overflow-y-auto overscroll-contain">
              {machines.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pickMachine(m)}
                  className={`flex w-full items-baseline justify-between gap-2 rounded-md border px-2 py-1 text-left text-xs ${
                    machine === m.id
                      ? "border-teal-600 bg-teal-500/10 text-teal-100"
                      : "border-slate-800 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  <span>{m.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">{m.upstream}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-600">
              Linked routes follow the machine's address when it moves.
            </p>
          </div>
        )}

        <SchemeSelect value={scheme} onChange={setScheme} />

        <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={fields.tls}
            onChange={(e) => fields.setTls(e.target.checked)}
            className="mt-0.5 accent-teal-500"
          />
          <span>
            Backend speaks HTTPS
            <span className="block text-xs text-slate-500">
              Dial the upstream over TLS, accepting a self-signed cert (e.g. Proxmox).
            </span>
          </span>
        </label>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            // `machine: null` is meaningful — it unlinks a route that was linked.
            onClick={() => onSubmit({ ...fields.payload(), machine, scheme })}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
