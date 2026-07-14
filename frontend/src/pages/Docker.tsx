import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, PackagePlus } from "lucide-react";

import { api } from "../lib/api";
import { useHealth } from "../lib/useHealth";
import { AssignModal } from "../components/routing/AssignModal";
import {
  ContainerList,
  type Container,
} from "../components/docker/ContainerList";
import { InstallWizard } from "../components/docker/InstallWizard";
import { LogViewer } from "../components/docker/LogViewer";
import { StackEditor } from "../components/docker/StackEditor";
import { StackList } from "../components/docker/StackList";
import { StatsBar } from "../components/docker/StatsBar";
import { Terminal } from "../components/docker/Terminal";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { ModuleStatus } from "../components/shared/ModuleStatus";

type Tab = "containers" | "stacks";

export function Docker() {
  const qc = useQueryClient();
  const health = useHealth();
  const [tab, setTab] = useState<Tab>("containers");

  // Modal state.
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [terminalFor, setTerminalFor] = useState<Container | null>(null);
  const [assignFor, setAssignFor] = useState<Container | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [removeContainer, setRemoveContainer] = useState<Container | null>(null);
  const [stackEditor, setStackEditor] = useState<{ name: string | null } | null>(null);
  const [deleteStack, setDeleteStack] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<{ base_domain?: { value: string | null } }>("/api/settings"),
  });
  const baseDomain = settings.data?.base_domain?.value ?? null;
  const mode = health.data?.caddy?.mode ?? null;

  const assign = useMutation({
    mutationFn: (p: { prefix: string; upstream: string }) =>
      api.post("/api/assign", { ...p, container: assignFor?.name, name: assignFor?.name }),
    onSuccess: () => {
      setAssignFor(null);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
      qc.invalidateQueries({ queryKey: ["caddy-routes"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => setAssignError(e instanceof Error ? e.message : "Assign failed"),
  });

  const removeMut = useMutation({
    mutationFn: (c: Container) => api.del(`/api/docker/containers/${c.id}`),
    onSuccess: () => {
      setRemoveContainer(null);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
  });

  const deleteStackMut = useMutation({
    mutationFn: (name: string) => api.del(`/api/docker/stacks/${name}`),
    onSuccess: () => {
      setDeleteStack(null);
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Docker</h1>
        <p className="mt-1 text-sm text-slate-500">Containers and compose stacks on this host.</p>
      </header>

      <div className="mb-4 space-y-3">
        <ModuleStatus name="Docker" health={health.data?.docker} />
        <StatsBar />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-slate-800 p-1">
          <TabButton active={tab === "containers"} onClick={() => setTab("containers")}>
            Containers
          </TabButton>
          <TabButton active={tab === "stacks"} onClick={() => setTab("stacks")}>
            Stacks
          </TabButton>
        </div>
        {tab === "stacks" && (
          <div className="flex gap-2">
            <button
              onClick={() => setStackEditor({ name: null })}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            >
              <FilePlus2 className="h-4 w-4" /> New stack
            </button>
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500"
            >
              <PackagePlus className="h-4 w-4" /> Install recipe
            </button>
          </div>
        )}
      </div>

      {tab === "containers" ? (
        <ContainerList
          onLogs={setLogsFor}
          onTerminal={setTerminalFor}
          onAssign={(c) => {
            setAssignError(null);
            setAssignFor(c);
          }}
          onRemove={setRemoveContainer}
        />
      ) : (
        <StackList onEdit={(name) => setStackEditor({ name })} onDelete={setDeleteStack} />
      )}

      {logsFor && <LogViewer container={logsFor} onClose={() => setLogsFor(null)} />}
      {terminalFor && <Terminal container={terminalFor} onClose={() => setTerminalFor(null)} />}
      {stackEditor && (
        <StackEditor name={stackEditor.name} onClose={() => setStackEditor(null)} />
      )}
      {wizardOpen && <InstallWizard onClose={() => setWizardOpen(false)} />}

      <AssignModal
        open={assignFor !== null}
        baseDomain={baseDomain}
        mode={mode}
        pending={assign.isPending}
        error={assignError}
        onSubmit={(p) => assign.mutate(p)}
        onClose={() => setAssignFor(null)}
      />

      <ConfirmDialog
        open={removeContainer !== null}
        title="Remove container"
        destructive
        confirmLabel="Remove"
        onCancel={() => setRemoveContainer(null)}
        onConfirm={() => removeContainer && removeMut.mutate(removeContainer)}
      >
        Remove <span className="font-medium text-slate-200">{removeContainer?.name}</span>? This
        force-removes the container.
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteStack !== null}
        title="Delete stack"
        destructive
        confirmLabel="Delete"
        onCancel={() => setDeleteStack(null)}
        onConfirm={() => deleteStack && deleteStackMut.mutate(deleteStack)}
      >
        Run <span className="font-mono">down</span> and delete the{" "}
        <span className="font-medium text-slate-200">{deleteStack}</span> stack directory?
      </ConfirmDialog>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm ${
        active ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
