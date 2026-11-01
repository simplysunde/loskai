import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "../../lib/api";
import type { NewMachine } from "./AddMachineModal";

export interface SaveResult {
  // "skipped" for a machine — it has no route.
  caddy: string;
  instance_id: string;
  url: string;
  warning: string | null;
  moved?: string[];
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
      for (const key of ["caddy-routes", "adguard-status", "ssh", "ssh-running"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      onSaved(data, m);
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : "Save failed"),
  });
}
