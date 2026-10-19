import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "../../lib/api";

// Both stack editor views save the same way: write the files, then `up` — and a failed `up`
// keeps the dialog open on what Compose said, since the files are already saved.
export function useSaveAndUp(name: string | null, onClose: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  async function run(save: () => Promise<void>, { up = true } = {}): Promise<boolean> {
    setError(null);
    setOutput(null);
    setBusy(true);
    try {
      await save();
      if (up && name) {
        const r = await api.post<{ ok: boolean; output: string }>(`/api/docker/stacks/${name}/action`, {
          action: "up",
        });
        if (!r.ok) {
          setOutput(r.output || "docker compose up failed");
          return true;
        }
      }
      onClose();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    }
  }

  return { busy, error, output, run };
}
