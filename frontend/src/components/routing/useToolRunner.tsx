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
  const [confirming, setConfirming] = useState<{ run: ToolRun; action: ToolAction } | null>(null);
  const qc = useQueryClient();

  const start = (r: ToolRun, action?: ToolAction) => {
    if (action?.confirm) setConfirming({ run: r, action });
    else setRun(r);
  };

  const ui = machine && (
    <>
      {run && (
        <MachineTerminal
          machine={machine}
          sshKey={sshKey}
          run={run === "shell" ? undefined : run}
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
          if (confirming) setRun(confirming.run);
          setConfirming(null);
        }}
      >
        {confirming?.action.confirm}
      </ConfirmDialog>
    </>
  );

  return { start, openShell: () => setRun("shell"), ui };
}
