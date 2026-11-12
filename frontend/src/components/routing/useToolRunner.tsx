import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { SshKey } from "../../lib/ssh";
import type { ToolAction, ToolRun } from "../../lib/tools";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { MachineTerminal } from "./MachineTerminal";

// Runs a machine's shell or a tool's action in its terminal, asking first for an action
// with `confirm` — for the machine's page and each tool's page. `ui` is what to render.
export function useToolRunner(machine: { id: string; name: string } | undefined, sshKey: SshKey | null) {
  const [run, setRun] = useState<ToolRun | "shell" | null>(null);
  // An automatic run — the action says so; the sudo rule and adding a tool always are —
  // drops down rather than opening a dialog.
  const [quick, setQuick] = useState(false);
  const [confirming, setConfirming] = useState<{ run: ToolRun; action: ToolAction } | null>(null);
  const qc = useQueryClient();

  const begin = (r: ToolRun, action?: ToolAction) => {
    setQuick(Boolean(action?.automatic || r.sudo || r.install));
    setRun(r);
  };
  const start = (r: ToolRun, action?: ToolAction) => {
    if (action?.confirm) setConfirming({ run: r, action });
    else begin(r, action);
  };

  const ui = machine && (
    <>
      {run && (
        <MachineTerminal
          machine={machine}
          sshKey={sshKey}
          run={run === "shell" ? undefined : run}
          quick={run !== "shell" && quick}
          onClose={() => {
            setRun(null);
            // What it ran may have changed what runs there, and what the machine has.
            qc.invalidateQueries({ queryKey: ["ssh-facts"] });
            qc.invalidateQueries({ queryKey: ["ssh-running"] });
          }}
        />
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={`${confirming?.run.title ?? ""} — ${machine.name}`}
        destructive
        confirmLabel={confirming?.action.label}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) begin(confirming.run, confirming.action);
          setConfirming(null);
        }}
      >
        {confirming?.action.confirm}
      </ConfirmDialog>
    </>
  );

  return { start, openShell: () => setRun("shell"), ui };
}
