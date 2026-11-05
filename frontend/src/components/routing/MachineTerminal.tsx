import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { useUnlockFor } from "../../lib/settings";
import { runQuery, type ToolRun } from "../../lib/tools";
import type { SshKey } from "../../lib/ssh";
import { Modal } from "../shared/Modal";
import { XtermSession } from "../shared/XtermSession";
import { INPUT } from "../../lib/ui";

// The server closes a machine's terminal with 4000 + an HTTP status: 4423 while the key is
// locked — the one case the password below fixes. A session that ends by itself closes 1000.
const LOCKED = 4423;
const ENDED = 1000;

// What `POST …/run` says about a run before its terminal opens.
interface Prepared {
  automatic: boolean;
  needs_password: boolean;
  user?: string; // the login sudo asks the password of
  ticket: string | null;
}

type Stage = "unlock" | "preparing" | "password" | "terminal";

// A shell on a machine over SSH — or a tool's action, given `run`. It needs Loskai's key
// unlocked, so a locked key asks for your password here first. An automatic action asks
// next for sudo's password when sudo would — checked on the machine before anything runs —
// and its terminal closes itself once it is done; anything else lasts until it is closed or
// the session ends, however long that is.
export function MachineTerminal({
  machine,
  sshKey,
  run,
  onClose,
}: {
  machine: { id: string; name: string };
  sshKey: SshKey | null;
  run?: ToolRun;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const unlockFor = useUnlockFor();
  const unlocked = Boolean(sshKey?.unlocked_until && Date.parse(sshKey.unlocked_until) > Date.now());
  const [stage, setStage] = useState<Stage>(!unlocked ? "unlock" : run ? "preparing" : "terminal");
  // Bumped to open a new session after unlocking.
  const [session, setSession] = useState(0);
  const [password, setPassword] = useState("");
  const [sudoPassword, setSudoPassword] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  const prepare = useMutation({
    mutationFn: (withPassword?: string) => {
      const { title: _title, ...named } = run!;
      return api.post<Prepared>(`/api/ssh/machines/${machine.id}/run`, {
        ...named,
        ...(withPassword !== undefined ? { password: withPassword } : {}),
      });
    },
    onSuccess: (p) => {
      setPrepared(p);
      setSudoPassword("");
      setStage(p.needs_password && !p.ticket ? "password" : "terminal");
      setSession((n) => n + 1);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 423) setStage("unlock");
    },
  });

  // Asked once the key is open, before anything runs.
  useEffect(() => {
    if (stage === "preparing" && prepare.isIdle) prepare.mutate(undefined);
  }, [stage, prepare]);

  const unlock = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/unlock", { password }),
    onSuccess: () => {
      setPassword("");
      prepare.reset();
      setStage(run ? "preparing" : "terminal");
      setSession((n) => n + 1);
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
  });

  const query = run ? `?${runQuery(run)}${prepared?.ticket ? `&ticket=${encodeURIComponent(prepared.ticket)}` : ""}` : "";

  return (
    <Modal
      title={`${run?.title ?? "Terminal"} — ${machine.name}`}
      onClose={onClose}
      // The prompts are a small dialog; the terminal, once connected, a wide one.
      wide={stage === "terminal"}
      narrow={stage !== "terminal"}
    >
      {stage === "unlock" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            unlock.mutate();
          }}
        >
          <p className="text-sm text-slate-300">Loskai's key is locked.</p>
          <p className="mt-1 text-xs text-slate-500">Your password unlocks it for {unlockFor}.</p>
          <input
            autoFocus
            type="password"
            autoComplete="current-password"
            aria-label="Your password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-3 ${INPUT}`}
          />
          {unlock.isError && (
            <p className="mt-2 text-sm text-rose-400">
              {apiMessage(unlock.error, "Couldn't unlock the key")}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!password || unlock.isPending} className={SUBMIT}>
              {unlock.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Unlock and connect
            </button>
          </div>
        </form>
      ) : stage === "preparing" ? (
        prepare.isError && !(prepare.error instanceof ApiError && prepare.error.status === 423) ? (
          <p className="text-sm text-rose-400">
            {apiMessage(prepare.error, "Couldn't get it ready")}
          </p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        )
      ) : stage === "password" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            prepare.mutate(sudoPassword);
          }}
        >
          <p className="text-sm text-slate-300">
            sudo on {machine.name} asks for {prepared?.user ? <span className="font-mono">{prepared.user}</span> : "its user"}'s password.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {run?.title} runs as root. Checked on the machine first, used for this run only,
            never stored or logged.
          </p>
          <input
            autoFocus
            type="password"
            autoComplete="off"
            aria-label="sudo password"
            placeholder={`sudo password on ${machine.name}`}
            value={sudoPassword}
            onChange={(e) => setSudoPassword(e.target.value)}
            className={`mt-3 ${INPUT}`}
          />
          {prepare.isError && (
            <p className="mt-2 text-sm text-rose-400">
              {apiMessage(prepare.error, "Couldn't check it")}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!sudoPassword || prepare.isPending} className={SUBMIT}>
              {prepare.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Run
            </button>
          </div>
        </form>
      ) : (
        <XtermSession
          key={session}
          url={`/api/ssh/machines/${machine.id}/terminal${query}`}
          onClosed={(code) => {
            if (code === LOCKED) {
              prepare.reset();
              setStage("unlock");
            } else if (code === ENDED && prepared?.automatic) onClose();
          }}
        />
      )}
    </Modal>
  );
}

const SUBMIT =
  "flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50";
