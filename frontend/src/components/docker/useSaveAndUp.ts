import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "../../lib/api";

// Both stack editor views save the same way: write the files, then `up` — and a failed `up`
// keeps the dialog open on what Compose said, since the files are already saved. Resolves
// "closed", "kept" (saved, `up` failed or couldn't run) or false (not saved).
export function useSaveAndUp(name: string | null, onClose: () => void) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  async function run(save: () => Promise<void>, { up = true } = {}): Promise<"closed" | "kept" | false> {
    setError(null);
    setOutput(null);
    setBusy(true);
    let saved = false;
    try {
      await save();
      saved = true;
      if (up && name) {
        const r = await api.post<{ ok: boolean; output: string }>(`/api/docker/stacks/${name}/action`, {
          action: "up",
        });
        if (!r.ok) {
          setOutput(r.output || "docker compose up failed");
          return "kept";
        }
      }
      onClose();
      return "closed";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
      return saved ? "kept" : false;
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    }
  }

  return { busy, error, output, run };
}
