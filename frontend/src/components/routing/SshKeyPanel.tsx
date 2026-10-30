import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, RefreshCw } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import type { SshKey } from "../../lib/ssh";
import { useScrollLock } from "../../lib/useScrollLock";

const LINE_HINT =
  "Add this line to ~/.ssh/authorized_keys for the user Loskai logs in as, on each machine.";
const FROM_HINT = "from= makes the key work only from the Docker host, so a copy of it is useless elsewhere.";

// Loskai's own key: made with the admin password, which encrypts it, and shown only as the
// public line to put on each machine.
export function SshKeyPanel({ sshKey }: { sshKey: SshKey | null | undefined }) {
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);

  if (sshKey === undefined) return null;

  return (
    <section className="mb-4 rounded-xl border border-slate-800 px-4 py-3">
      <div className="flex items-center gap-3">
        <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
        <span className="shrink-0 text-sm font-medium text-slate-200">SSH key</span>
        {sshKey ? (
          <>
            <code
              title={`${LINE_HINT} ${sshKey.from ? FROM_HINT : ""}`}
              className="min-w-0 flex-1 truncate font-mono text-xs text-slate-400"
            >
              {sshKey.authorized_keys}
            </code>
            <button
              title="Copy the line"
              onClick={async () => {
                if (!(await copyText(sshKey.authorized_keys))) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex shrink-0 items-center rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              title="Replace the key — machines must be given the new line"
              onClick={() => setAsking(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> New key
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-xs text-slate-500">None yet.</span>
            <button
              onClick={() => setAsking(true)}
              className="shrink-0 rounded-lg bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-500"
            >
              Create key
            </button>
          </>
        )}
      </div>
      {sshKey && !sshKey.from && (
        <p className="mt-2 text-xs text-amber-300">
          Not limited to the Docker host: set its LAN IP in Settings › General.
        </p>
      )}
      {asking && <KeyPasswordDialog replacing={!!sshKey} onClose={() => setAsking(false)} />}
    </section>
  );
}

function KeyPasswordDialog({ replacing, onClose }: { replacing: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  useScrollLock(true);

  const make = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/key", { password, replace: replacing }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't make the key"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          make.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-slate-100">{replacing ? "New SSH key" : "Create SSH key"}</h2>
        <p className="mt-1 text-xs text-slate-500">Your admin password encrypts the key.</p>
        {replacing && (
          <p className="mt-2 text-xs text-amber-300">
            Machines that accept the current key won't accept Loskai until they get the new line.
          </p>
        )}
        <input
          autoFocus
          type="password"
          autoComplete="current-password"
          aria-label="Admin password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
        />
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password || make.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {make.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {replacing ? "Replace key" : "Create key"}
          </button>
        </div>
      </form>
    </div>
  );
}
