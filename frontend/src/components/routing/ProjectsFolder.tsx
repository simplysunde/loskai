import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";

import { api, ApiError } from "../../lib/api";

const BUTTON = "rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800";

// Where a machine's projects are — the ones Claude Code lists: `~/projects` unless changed
// here, to `~` or one folder in it. A row of the machine page's Connection section.
export function ProjectsFolder({ machineId, folder }: { machineId: string; folder: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string) => api.put(`/api/ssh/machines/${machineId}/projects`, { folder: next }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["ssh"] });
    },
  });
  if (editing === null) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-slate-300">{folder}</span>
        <button
          title="Change the projects folder: ~ or one folder in it"
          onClick={() => setEditing(folder)}
          className="text-slate-500 hover:text-slate-200"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(editing);
      }}
    >
      <input
        aria-label="Projects folder"
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-slate-200"
      />
      <button type="submit" disabled={save.isPending} className={BUTTON}>
        Save
      </button>
      <button type="button" onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-300">
        Cancel
      </button>
      {save.isError && (
        <span className="text-rose-400">{save.error instanceof ApiError ? save.error.message : "Couldn't save it"}</span>
      )}
    </form>
  );
}
