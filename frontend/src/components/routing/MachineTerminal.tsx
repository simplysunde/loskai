import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { runQuery, type ToolRun } from "../../lib/tools";
import { keyUnlocked, type SshKey } from "../../lib/ssh";
import { requestUnlock } from "../../lib/unlock";
import { Modal } from "../shared/Modal";
import { QuickTerminal, type QuickPhase } from "../shared/QuickTerminal";
import { XtermSession } from "../shared/XtermSession";
import { INPUT } from "../../lib/ui";

// The server closes a machine's terminal with 4000 + an HTTP status: 4423 while the key is
// locked — the one case your password fixes. A session that ends by itself closes 1000.
const LOCKED = 4423;
const ENDED = 1000;
// What a run prints before it waits for Enter (`tool.terminal_command`): `[done, exit N]`, or for an
// automatic one `[failed, exit N]`. Inside tmux its exit code never reaches the session's
// end, so the output is how it is told — and a session that ends once the prompt is up
// ended by Enter, not by the connection dropping.
const FAILED = /\[failed, exit (\d+)\]/;
const PROMPT = /\[(?:done|failed), exit \d+\] Enter closes this/;
// The output as text, without the colour and cursor codes tmux draws it with.
const CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const plain = (text: string) => text.replace(CODES, "");

// What `POST …/run` says about a run before its terminal opens.
interface Prepared {
  automatic: boolean;
  needs_password: boolean;
  user?: string; // the login sudo asks the password of
  ticket: string | null;
}

type Stage = "unlock" | "preparing" | "password" | "terminal";

// A shell on a machine over SSH — or a tool's action, given `run`. It needs Loskai's key
// unlocked, so a locked key asks for your password first (`UnlockPrompt`, alone: the
// terminal opens once it is unlocked, and cancelling it closes this). An automatic action asks
// next for sudo's password when sudo would — checked on the machine before anything runs —
// and its terminal closes itself once it is done; anything else lasts until it is closed or
// the session ends, however long that is.
//
// `quick`: the run is automatic, so it drops down from the top (QuickTerminal) rather than
// opening a dialog — only the prompts, the key's and sudo's passwords, are dialogs.
// `onEnded` hears how a quick run ended — done, or failed — once it has.
export function MachineTerminal({
  machine,
  sshKey,
  run,
  quick = false,
  onClose,
  onEnded,
}: {
  machine: { id: string; name: string };
  sshKey: SshKey | null;
  run?: ToolRun;
  quick?: boolean;
  onClose: () => void;
  onEnded?: (ok: boolean) => void;
}) {
  const unlocked = keyUnlocked(sshKey);
  const [stage, setStage] = useState<Stage>(!unlocked ? "unlock" : run ? "preparing" : "terminal");
  // Bumped to open a new session after unlocking.
  const [session, setSession] = useState(0);
  const [sudoPassword, setSudoPassword] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  // How a quick run ended, and the last of what it printed, to find out.
  const [ended, setEnded] = useState<{ phase: "done" | "failed"; detail?: string } | null>(null);
  const heard = useRef(onEnded);
  useEffect(() => {
    heard.current = onEnded;
  });
  useEffect(() => {
    if (ended) heard.current?.(ended.phase === "done");
  }, [ended]);
  const tail = useRef("");

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
    // Locked: the password was asked for (api.ts) and not given.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 423) onClose();
    },
  });

  // Asked once the key is open, before anything runs.
  useEffect(() => {
    if (stage === "preparing" && prepare.isIdle) prepare.mutate(undefined);
  }, [stage, prepare]);

  // Locked — at the start, or the terminal closed because it locked meanwhile: your password,
  // then on as if it had been unlocked.
  const asking = useRef(false);
  useEffect(() => {
    if (stage !== "unlock" || asking.current) return;
    asking.current = true;
    void requestUnlock().then((ok) => {
      asking.current = false;
      if (!ok) return onClose();
      prepare.reset();
      setStage(run ? "preparing" : "terminal");
      setSession((n) => n + 1);
    });
  }, [stage, run, prepare, onClose]);

  const query = run ? `?${runQuery(run)}${prepared?.ticket ? "&sudo_password=true" : ""}` : "";
  const ticket = prepared?.ticket ? JSON.stringify({ type: "ticket", ticket: prepared.ticket }) : undefined;

  if (run && quick && (stage === "preparing" || stage === "terminal") && (!prepared || prepared.automatic)) {
    const notReady = stage === "preparing" && prepare.isError && !(prepare.error instanceof ApiError && prepare.error.status === 423);
    const phase: QuickPhase = notReady ? "failed" : stage === "preparing" ? "preparing" : ended?.phase ?? "running";
    return (
      <QuickTerminal
        title={`${run.title} — ${machine.name}`}
        phase={phase}
        detail={notReady ? apiMessage(prepare.error, "Couldn't get it ready") : ended?.detail}
        onClose={onClose}
      >
        {stage === "terminal" && (
          <XtermSession
            key={session}
            url={`/api/ssh/machines/${machine.id}/terminal${query}`}
            first={ticket}
            height="h-[22vh]"
            onOutput={(text) => {
              tail.current = (tail.current + text).slice(-400);
              const failed = FAILED.exec(plain(tail.current));
              if (failed && !ended) setEnded({ phase: "failed", detail: `exit ${failed[1]}` });
            }}
            onClosed={(code, reason) => {
              if (code === LOCKED) {
                prepare.reset();
                setStage("unlock");
              } else if (ended?.phase === "failed") {
                // Enter, after reading why: it is done with.
                if (code === ENDED) onClose();
              } else if (code === ENDED) {
                setEnded({ phase: "done" });
              } else {
                setEnded({ phase: "failed", detail: reason || `closed (${code})` });
              }
            }}
          />
        )}
      </QuickTerminal>
    );
  }

  if (stage === "unlock") return null;

  return (
    <Modal
      title={`${run?.title ?? "Terminal"} — ${machine.name}`}
      onClose={onClose}
      // The prompts are a small dialog; the terminal, once connected, a wide one.
      wide={stage === "terminal"}
      narrow={stage !== "terminal"}
    >
      {stage === "preparing" ? (
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
          first={ticket}
          onOutput={run ? (text) => { tail.current = (tail.current + text).slice(-400); } : undefined}
          onClosed={(code) => {
            if (code === LOCKED) {
              prepare.reset();
              setStage("unlock");
            } else if (code === ENDED && (prepared?.automatic || PROMPT.test(plain(tail.current)))) {
              // "Enter closes this", pressed. Anything else stays, saying why it closed.
              onClose();
            }
          }}
        />
      )}
    </Modal>
  );
}

const SUBMIT =
  "flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50";
