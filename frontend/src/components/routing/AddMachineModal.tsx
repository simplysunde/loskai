import { useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";

import type { SshHost } from "../../lib/ssh";
import { useScrollLock } from "../../lib/useScrollLock";
import { assembleFqdn, isValidDnsOnlyPrefix, isValidDnsTarget } from "../../lib/validation";

// What the parent posts to /api/machines. `ssh` sets the machine's SSH config entry, null
// removes it, and left out the entry only follows a rename or a move.
export interface NewMachine {
  hostname: string;
  address: string;
  name?: string;
  instance_id?: string;
  ssh?: { user: string; port: number } | null;
}

// The backend's rule (assign.MachineSsh): a login name, as `useradd` would take it.
const SSH_USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const SSH_HINT = "The user Loskai logs in as over SSH. Empty: not in the SSH config.";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

// Naming a machine is its own form, not a mode of the route picker: there is no source to
// choose, no port, no TLS, and the hostname may be dotted — none of which is true of a
// route. What they share is the table they land in and the instance they become.
export function AddMachineModal({
  open,
  baseDomain,
  editing,
  ssh,
  pending = false,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  baseDomain: string | null;
  // Set when re-pointing an existing machine — its address is what usually changes.
  editing?: { id: string; hostname: string; address: string; name: string } | null;
  // The machine's SSH config entry, if it has one.
  ssh?: SshHost | null;
  pending?: boolean;
  error?: string | null;
  onSubmit: (machine: NewMachine) => void;
  onClose: () => void;
}) {
  const [hostname, setHostname] = useState(editing?.hostname ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [sshUser, setSshUser] = useState(ssh?.user ?? "");
  const [sshPort, setSshPort] = useState(String(ssh?.port ?? 22));

  useScrollLock(open);

  if (!open) return null;

  const hostnameOk = isValidDnsOnlyPrefix(hostname);
  const addressOk = isValidDnsTarget(address);
  const port = Number(sshPort);
  const sshOk = !sshUser || (SSH_USER.test(sshUser) && Number.isInteger(port) && port >= 1 && port <= 65535);
  const canSubmit = hostnameOk && addressOk && sshOk && !pending;
  // Only say something about SSH when there is something to say: an entry to set, or one to
  // remove. Left out, the backend keeps the entry and only carries a rename or move to it.
  const sshChange = sshUser ? { ssh: { user: sshUser, port } } : ssh ? { ssh: null } : {};
  const fqdn = baseDomain ? assembleFqdn(hostname || "name", baseDomain) : hostname;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <HardDrive className="h-4 w-4 text-teal-300" />
          {editing ? "Edit machine" : "Name a machine"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Gives a LAN machine a name that resolves to its address — for SSH, SMB, a NAS, any
          port at all. No reverse proxy and no certificate involved. Routes can then point at
          it instead of repeating its IP.
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            Hostname (dots allowed)
          </span>
          <input
            autoFocus
            value={hostname}
            // Lowercase-only, so normalise rather than reject — the same rule
            // useRouteFields applies to a route prefix. Typing a capital must not
            // silently disable the submit button.
            onChange={(e) => setHostname(e.target.value.toLowerCase())}
            placeholder="rack1.vm3"
            className={INPUT}
          />
          <span className="mt-1 block text-xs text-slate-500">
            → <span className="text-teal-300">{fqdn}</span>
          </span>
          {hostname && !hostnameOk && (
            <span className="mt-1 block text-xs text-rose-400">
              Each dot-separated label: lowercase letters, digits, hyphens.
            </span>
          )}
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">Machine IP</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.10.50"
            className={INPUT}
          />
          <span className="mt-1 block text-xs text-slate-500">
            The address the name resolves to. DNS maps names to addresses, so no port here.
          </span>
          {address && !addressOk && (
            <span className="mt-1 block text-xs text-rose-400">
              A bare IPv4 address — no port.
            </span>
          )}
        </label>

        <div className="mt-3 flex gap-2">
          <label className="block flex-1" title={SSH_HINT}>
            <span className="mb-1 block text-xs font-medium text-slate-400">SSH user</span>
            <input
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value.trim())}
              placeholder="none"
              className={INPUT}
            />
          </label>
          <label className="block w-24">
            <span className="mb-1 block text-xs font-medium text-slate-400">Port</span>
            <input
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value.trim())}
              inputMode="numeric"
              disabled={!sshUser}
              className={`${INPUT} disabled:opacity-50`}
            />
          </label>
        </div>
        {!sshOk && (
          <span className="mt-1 block text-xs text-rose-400">
            A login name (letters, digits, _ . -) and a port from 1 to 65535.
          </span>
        )}

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                hostname,
                address,
                name: editing?.name ?? hostname,
                instance_id: editing?.id,
                ...sshChange,
              })
            }
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save machine" : "Name machine"}
          </button>
        </div>
      </div>
    </div>
  );
}
