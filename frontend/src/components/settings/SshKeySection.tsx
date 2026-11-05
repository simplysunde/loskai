import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { useSsh, type SshKey } from "../../lib/ssh";
import { INPUT } from "../../lib/ui";
import { Overlay } from "../shared/Modal";

// Loskai's own key, the one it logs in to every machine with. Using it needs nothing here:
// a machine's SSH setup creates it and puts it on that machine. What is left is the rare
// part — telling it apart, and replacing it.
export function SshKeySection() {
  const sshKey = useSsh().data?.key;
  const [replacing, setReplacing] = useState(false);

  return (
    <section>
      <h2 className="text-sm font-medium text-slate-200">Loskai's key</h2>
      <p className="mt-1 text-xs text-slate-500">
        Loskai logs in to your machines with its own key, which each account unlocks with its
        own password. A machine's SSH setup — the cog on its row — creates it and installs it
        there.
      </p>
      {sshKey === null && <p className="mt-3 text-xs text-slate-500">None yet.</p>}
      {sshKey && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code
            title="As ssh-keygen -lf ~/.ssh/authorized_keys shows it on a machine"
            className="cursor-help font-mono text-xs text-slate-300"
          >
            {sshKey.fingerprint}
          </code>
          <button
            title="Replace the key — every machine's SSH setup then has to be run again"
            onClick={() => setReplacing(true)}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" /> New key
          </button>
        </div>
      )}
      {sshKey && !sshKey.from && (
        <p className="mt-2 text-xs text-amber-300">
          Not limited to the Docker host: set its LAN IP in Settings › General.
        </p>
      )}
      {replacing && <ReplaceKeyDialog onClose={() => setReplacing(false)} />}
    </section>
  );
}

function ReplaceKeyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const make = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/key", { password, replace: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh"] });
      onClose();
    },
    onError: (err) => setError(apiMessage(err, "Couldn't replace the key")),
  });

  return (
    <Overlay onClose={onClose}>
      <form
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
          aria-label="Your password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`mt-4 ${INPUT}`}
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
    </Overlay>
  );
}
