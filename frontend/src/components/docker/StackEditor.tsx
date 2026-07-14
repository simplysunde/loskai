import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { Modal } from "../shared/Modal";

// Edit an existing stack's compose.yml + .env, or the raw create path (paste a finished
// compose + .env and `up`). Docker auto-creates bind-mount dirs, so no directory step.
export function StackEditor({
  name,
  onClose,
}: {
  name: string | null; // null = create a new stack
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const creating = name === null;
  const [stackName, setStackName] = useState("");
  const [compose, setCompose] = useState(
    creating ? "services:\n  app:\n    image: \n" : "",
  );
  const [env, setEnv] = useState("");
  const [loading, setLoading] = useState(!creating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (creating) return;
    api
      .get<{ compose: string; env: string }>(`/api/docker/stacks/${name}`)
      .then((s) => {
        setCompose(s.compose);
        setEnv(s.env);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [name, creating]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      if (creating) {
        await api.post("/api/docker/stacks", { name: stackName, compose, env });
      } else {
        await api.put(`/api/docker/stacks/${name}/file`, { file: "compose.yml", content: compose });
        await api.put(`/api/docker/stacks/${name}/file`, { file: ".env", content: env });
      }
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={creating ? "New stack" : `Edit ${name}`} onClose={onClose} wide>
      {loading ? (
        <div className="flex justify-center py-10 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {creating && (
            <input
              value={stackName}
              onChange={(e) => setStackName(e.target.value)}
              placeholder="stack name"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
            />
          )}
          <Editor label="compose.yml" value={compose} onChange={setCompose} rows={14} />
          <Editor label=".env" value={env} onChange={setEnv} rows={5} />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || (creating && !stackName)}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {creating ? "Create + up" : "Save + re-up"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Editor({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-teal-500"
      />
    </label>
  );
}
