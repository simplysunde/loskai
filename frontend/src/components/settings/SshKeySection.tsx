import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { useSsh, type SshKey } from "../../lib/ssh";
import { useScrollLock } from "../../lib/useScrollLock";
import { SshLog } from "../routing/SshLog";

// Loskai's own key, the one it logs in to every machine with. Using it needs nothing here:
// a machine's SSH setup creates it and puts it on that machine. What is left is the rare
// part — replacing it, and the log of what it was used for.
export function SshKeySection() {
  const sshKey = useSsh().data?.key;
  const [replacing, setReplacing] = useState(false);
  const [showLog, setShowLog] = useState(false);

  return (
    <section>
      <h2 className="text-sm font-medium text-slate-200">SSH key</h2>
      <p className="mt-1 text-xs text-slate-500">
        Loskai logs in to your machines with its own key, encrypted with the admin password. A
        machine's SSH setup, on the Machines tab, creates it and installs it there.
      </p>
      {sshKey === null && <p className="mt-3 text-xs text-slate-500">None yet.</p>}
      {sshKey && (
        <div className="mt-3 flex gap-2">
          <button
            title="Replace the key — every machine's SSH setup then has to be run again"
            onClick={() => setReplacing(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" /> New key
          </button>
          <button
            title="Terminals opened and closed, and installs"
            onClick={() => setShowLog(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <ScrollText className="h-4 w-4" /> Log
          </button>
        </div>
      )}
      {sshKey && !sshKey.from && (
        <p className="mt-2 text-xs text-amber-300">
          Not limited to the Docker host: set its LAN IP in Settings › General.
        </p>
      )}
      {replacing && <ReplaceKeyDialog onClose={() => setReplacing(false)} />}
      {showLog && <SshLog onClose={() => setShowLog(false)} />}
    </section>
  );
}

function ReplaceKeyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  useScrollLock(true);

  const make = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/key", { password, replace: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh"] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't replace the key"),
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
        <h2 className="text-base font-semibold text-slate-100">New SSH key</h2>
        <p className="mt-2 text-xs text-amber-300">
          Machines stop accepting Loskai until their SSH setup is run again.
        </p>
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
            Replace key
          </button>
        </div>
      </form>
    </div>
  );
}
