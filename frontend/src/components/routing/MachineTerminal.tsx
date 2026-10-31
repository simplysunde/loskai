import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import type { SshKey } from "../../lib/ssh";
import { Modal } from "../shared/Modal";
import { XtermSession } from "../shared/XtermSession";

// The server closes a machine's terminal with 4000 + an HTTP status: 4423 while the key is
// locked — the one case the password below fixes.
const LOCKED = 4423;

// A shell on a machine over SSH. It needs Loskai's key unlocked, so a locked key asks for
// the admin password here first; once open, the shell lasts until it is closed or the
// session ends, however long that is.
export function MachineTerminal({
  machine,
  sshKey,
  onSetup,
  onClose,
}: {
  machine: { id: string; name: string };
  sshKey: SshKey | null;
  onSetup: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const unlocked = Boolean(sshKey?.unlocked_until && Date.parse(sshKey.unlocked_until) > Date.now());
  const [needUnlock, setNeedUnlock] = useState(!unlocked);
  // Bumped to open a new session after unlocking.
  const [session, setSession] = useState(0);
  const [password, setPassword] = useState("");

  const unlock = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/unlock", { password }),
    onSuccess: () => {
      setPassword("");
      setNeedUnlock(false);
      setSession((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
  });

  return (
    <Modal
      title={
        <span className="flex items-center gap-3">
          Terminal — {machine.name}
          <button onClick={onSetup} className="text-xs font-normal text-teal-400 hover:underline">
            SSH setup
          </button>
        </span>
      }
      onClose={onClose}
      wide
    >
      {needUnlock ? (
        <form
          className="max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            unlock.mutate();
          }}
        >
          <p className="text-sm text-slate-300">Loskai's key is locked.</p>
          <p className="mt-1 text-xs text-slate-500">Your admin password unlocks it for 15 minutes.</p>
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            aria-label="Admin password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
          />
          {unlock.isError && (
            <p className="mt-2 text-sm text-rose-400">
              {unlock.error instanceof ApiError ? unlock.error.message : "Couldn't unlock the key"}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={!password || unlock.isPending}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {unlock.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Unlock and connect
            </button>
          </div>
        </form>
      ) : (
        <XtermSession
          key={session}
          url={`/api/ssh/machines/${machine.id}/terminal`}
          onClosed={(code) => {
            if (code === LOCKED) setNeedUnlock(true);
          }}
        />
      )}
    </Modal>
  );
}
