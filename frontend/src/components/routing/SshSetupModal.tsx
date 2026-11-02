import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, ShieldAlert, ShieldCheck, Terminal } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { useUnlockFor } from "../../lib/settings";
import { useMe } from "../../lib/useAuth";
import { runningCount, type Running, type SshHost, type SshKey } from "../../lib/ssh";
import { TabButton } from "../shared/TabButton";
import { Modal } from "../shared/Modal";

interface Scan {
  fingerprint: string;
  type: string;
  state: "new" | "trusted" | "changed";
  // This machine's two lines — its from= can differ from other machines'. Null before
  // Loskai has a key.
  lines: string[] | null;
}
interface Tested {
  key: boolean;
  running: Running;
}

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";
const PRIMARY =
  "flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50";

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

// Setting a machine up for SSH, in the order that keeps a password safe: its host key is
// shown and trusted first, so a password only ever goes to the machine whose fingerprint
// was accepted. Then Loskai's lines go on it — with the machine's password, used once, or
// pasted by hand — and a test with the keys proves it.
export function SshSetupModal({
  machine,
  host,
  sshKey,
  onClose,
}: {
  machine: { id: string; name: string };
  host: SshHost;
  sshKey: SshKey | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const unlockFor = useUnlockFor();
  const { admin } = useMe();
  const target = `${host.user}@${host.hostname}${host.port === 22 ? "" : `:${host.port}`}`;
  const [trusted, setTrusted] = useState(false);
  const [mode, setMode] = useState<"install" | "manual">("install");
  const [adminPassword, setAdminPassword] = useState("");
  const [machinePassword, setMachinePassword] = useState("");
  // The key can lock between opening this and submitting; a 423 brings the field back.
  const [askAdmin, setAskAdmin] = useState(false);
  const [copied, setCopied] = useState(false);

  const scan = useQuery({
    queryKey: ["ssh-scan", machine.id],
    queryFn: () => api.post<Scan>(`/api/ssh/machines/${machine.id}/scan`),
    retry: false,
    gcTime: 0,
  });
  const isTrusted = trusted || scan.data?.state === "trusted";

  const trust = useMutation({
    mutationFn: (fingerprint: string) =>
      api.post(`/api/ssh/machines/${machine.id}/trust`, { fingerprint }),
    onSuccess: () => {
      setTrusted(true);
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
  });

  const createKey = useMutation({
    mutationFn: () => api.post<SshKey>("/api/ssh/key", { password: adminPassword }),
    onSuccess: () => {
      setAdminPassword("");
      qc.invalidateQueries({ queryKey: ["ssh"] });
      // The scan answers with this machine's lines once there is a key to put in them.
      void scan.refetch();
    },
  });

  const locked = !sshKey?.unlocked_until || Date.parse(sshKey.unlocked_until) <= Date.now();
  const needAdmin = askAdmin || locked;

  const connect = useMutation({
    mutationFn: async () => {
      if (needAdmin) await api.post("/api/ssh/unlock", { password: adminPassword });
      return mode === "install"
        ? api.post<Tested>(`/api/ssh/machines/${machine.id}/install`, { password: machinePassword })
        : api.post<Tested>(`/api/ssh/machines/${machine.id}/test`);
    },
    onSuccess: () => {
      setAdminPassword("");
      setMachinePassword("");
      setAskAdmin(false);
      qc.invalidateQueries({ queryKey: ["ssh"] });
      qc.invalidateQueries({ queryKey: ["ssh-running"] });
      qc.invalidateQueries({ queryKey: ["ssh-facts"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 423) setAskAdmin(true);
    },
  });

  const machineLines = scan.data?.lines ?? sshKey?.lines ?? [];
  const canConnect =
    (!needAdmin || adminPassword) && (mode === "manual" || machinePassword) && !connect.isPending;

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-teal-300" /> SSH — {machine.name}
        </span>
      }
      onClose={onClose}
    >
      <p className="text-xs text-slate-500">
        Loskai logs in as <span className="font-mono text-slate-300">{target}</span>.
      </p>

      {/* 1 — the host key */}
      <section className="mt-4">
        {scan.isLoading && (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Asking the machine for its host key…
          </p>
        )}
        {scan.isError && (
          <p className="text-sm text-rose-400">
            {message(scan.error, "Couldn't reach the machine")}{" "}
            <button onClick={() => scan.refetch()} className="text-teal-400 underline underline-offset-2">
              Try again
            </button>
          </p>
        )}
        {scan.data && isTrusted && (
          <p
            title={`${scan.data.type} ${scan.data.fingerprint}`}
            className="flex items-center gap-2 text-sm text-emerald-300"
          >
            <ShieldCheck className="h-4 w-4" /> Host key trusted
          </p>
        )}
        {scan.data && !isTrusted && (
          <div
            className={`rounded-lg border px-3 py-2 ${
              scan.data.state === "changed"
                ? "border-rose-600/50 bg-rose-500/10"
                : "border-slate-700 bg-slate-950"
            }`}
          >
            {scan.data.state === "changed" ? (
              <p className="flex items-center gap-2 text-sm text-rose-300">
                <ShieldAlert className="h-4 w-4 shrink-0" /> This machine's host key has changed.
                Trust the new one only if you reinstalled it or know why.
              </p>
            ) : (
              <p className="text-sm text-slate-300">Is this the machine's host key?</p>
            )}
            <p className="mt-1 break-all font-mono text-xs text-slate-200">{scan.data.fingerprint}</p>
            <p className="mt-1 text-xs text-slate-500">
              On the machine:{" "}
              <code className="text-slate-400">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>
            </p>
            {trust.isError && (
              <p className="mt-1 text-sm text-rose-400">{message(trust.error, "Couldn't trust it")}</p>
            )}
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => trust.mutate(scan.data.fingerprint)}
                disabled={trust.isPending}
                className={PRIMARY}
              >
                {trust.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {scan.data.state === "changed" ? "Trust the new key" : "Trust"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 2 — Loskai's own key, if there is none yet: an admin's to make */}
      {isTrusted && !sshKey && !admin && (
        <p className="mt-5 text-sm text-slate-400">
          Loskai has no SSH key yet — an admin makes it, here or in Settings › SSH.
        </p>
      )}
      {isTrusted && !sshKey && admin && (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            createKey.mutate();
          }}
        >
          <p className="text-sm text-slate-300">Loskai has no SSH key yet.</p>
          <p className="mt-1 text-xs text-slate-500">Your password creates it, and encrypts it.</p>
          <AdminPassword value={adminPassword} onChange={setAdminPassword} />
          {createKey.isError && (
            <p className="mt-2 text-sm text-rose-400">{message(createKey.error, "Couldn't make the key")}</p>
          )}
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!adminPassword || createKey.isPending} className={PRIMARY}>
              {createKey.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create key
            </button>
          </div>
        </form>
      )}

      {/* 3 — Loskai's lines onto the machine, then a test */}
      {isTrusted && sshKey && !connect.isSuccess && (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-slate-800 p-1">
            <TabButton active={mode === "install"} onClick={() => setMode("install")}>
              Install it for me
            </TabButton>
            <TabButton active={mode === "manual"} onClick={() => setMode("manual")}>
              I'll add it myself
            </TabButton>
          </div>

          {mode === "install" ? (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Used once to add Loskai's keys to <code className="text-slate-400">~/.ssh/authorized_keys</code>,
                then forgotten.
              </p>
              <input
                type="password"
                autoComplete="off"
                aria-label="Machine password"
                placeholder={`Password for ${host.user}`}
                value={machinePassword}
                onChange={(e) => setMachinePassword(e.target.value)}
                className={`mt-2 ${INPUT}`}
              />
            </>
          ) : (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Add both lines to <code className="text-slate-400">~/.ssh/authorized_keys</code> for{" "}
                {host.user} on the machine. The second only lists what runs.
              </p>
              <div className="mt-2 flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-400">
                  {machineLines.join("\n")}
                </pre>
                <button
                  type="button"
                  title="Copy both lines"
                  onClick={async () => {
                    if (!(await copyText(machineLines.join("\n") + "\n"))) return;
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex shrink-0 items-center rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </>
          )}

          {needAdmin && (
            <>
              <p className="mt-3 text-xs text-slate-500">
                Your password unlocks Loskai's key for {unlockFor}.
              </p>
              <AdminPassword value={adminPassword} onChange={setAdminPassword} />
            </>
          )}

          {connect.isError && (
            <p className="mt-2 text-sm text-rose-400">{message(connect.error, "Couldn't connect")}</p>
          )}
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={!canConnect} className={PRIMARY}>
              {connect.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "install" ? "Install" : "Test connection"}
            </button>
          </div>
        </form>
      )}

      {/* 4 — what the test found */}
      {connect.data && (
        <section className="mt-5">
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <Check className="h-4 w-4" /> Loskai logs in with its key.
          </p>
          <p className={`mt-1 text-sm ${connect.data.running.ok ? "text-slate-300" : "text-amber-300"}`}>
            {connect.data.running.ok
              ? `${runningCount(connect.data.running)} running.`
              : connect.data.running.error}
          </p>
          <div className="mt-4 flex justify-end">
            <button onClick={onClose} className={PRIMARY}>
              Done
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}

function AdminPassword({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="password"
      autoComplete="current-password"
      aria-label="Your password"
      placeholder="Your password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`mt-2 ${INPUT}`}
    />
  );
}
