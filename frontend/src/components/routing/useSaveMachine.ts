import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "../../lib/api";
import type { NewMachine } from "./AddMachineModal";
import { refreshRecords } from "../../lib/routes";

export interface SaveResult {
  // "skipped" for a machine — it has no route — and for a link.
  caddy: string;
  adguard?: string;
  instance_id: string;
  url: string;
  warning: string | null;
  moved?: string[];
  // A link (Phase 45): saved, with no route and no rewrite.
  link?: boolean;
}

// Naming a machine (the Machines tab) and editing one (its page) are the same post.
export function useSaveMachine({
  onSaved,
  onError,
}: {
  onSaved: (result: SaveResult, machine: NewMachine) => void;
  onError: (message: string) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: NewMachine) => api.post<SaveResult>("/api/machines", m),
    onSuccess: (data, m) => {
      refreshRecords(qc);
      qc.invalidateQueries({ queryKey: ["ssh"] });
      qc.invalidateQueries({ queryKey: ["ssh-running"] });
      onSaved(data, m);
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : "Save failed"),
  });
}
