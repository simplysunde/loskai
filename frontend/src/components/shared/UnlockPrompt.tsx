import { useState, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { useUnlockFor } from "../../lib/settings";
import { answerUnlock, subscribeUnlock, unlockAsked } from "../../lib/unlock";
import { INPUT } from "../../lib/ui";
import { Overlay } from "./Modal";
import { YourPassword } from "./YourPassword";

// The one dialog asking for your password to unlock Loskai's SSH key — opened by what you
// did (`requestUnlock`): a change the key was locked for goes on once it is unlocked, and
// what was read while it was locked is read again.
export function UnlockPrompt() {
  const asked = useSyncExternalStore(subscribeUnlock, unlockAsked);
  return asked ? <Prompt /> : null;
}

function Prompt() {
  const qc = useQueryClient();
  const unlockFor = useUnlockFor();
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => api.post("/api/ssh/unlock", { password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh"] });
      qc.invalidateQueries({ predicate: (q) => q.state.error instanceof ApiError && q.state.error.status === 423 });
      answerUnlock(true);
    },
  });
  return (
    <Overlay onClose={() => answerUnlock(false)} label="Unlock Loskai's key">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password) unlock.mutate();
        }}
      >
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
          <KeyRound className="h-4 w-4 text-teal-300" /> Unlock Loskai's key
        </h2>
        <p className="mt-1 text-sm text-slate-400">To reach your machines. Your password unlocks it for {unlockFor}.</p>
        <YourPassword autoFocus value={password} onChange={setPassword} className={`mt-4 ${INPUT}`} />
        {unlock.isError && <p className="mt-2 text-sm text-rose-400">{apiMessage(unlock.error, "Couldn't unlock it")}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => answerUnlock(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password || unlock.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {unlock.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Unlock
          </button>
        </div>
      </form>
    </Overlay>
  );
}
