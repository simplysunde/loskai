import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, PackagePlus } from "lucide-react";

import { api } from "../lib/api";
import type { SettingsView } from "../lib/settings";
import { useHealth } from "../lib/useHealth";
import type { Container, Stack } from "../components/docker/groupByStack";
import { InstallWizard } from "../components/docker/InstallWizard";
import { LogViewer } from "../components/docker/LogViewer";
import { StackEditor } from "../components/docker/StackEditor";
import { StackGroups } from "../components/docker/StackGroups";
import { StatsBar } from "../components/docker/StatsBar";
import { Terminal } from "../components/docker/Terminal";
import { VolumeList } from "../components/docker/VolumeList";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { DeleteStackOptions } from "../components/docker/DeleteStackOptions";
import { ModuleStatus } from "../components/shared/ModuleStatus";

type Tab = "containers" | "volumes";

export function Docker() {
  const qc = useQueryClient();
  const health = useHealth();
  const [tab, setTab] = useState<Tab>("containers");

  // Modal state.
  const [logsFor, setLogsFor] = useState<Container | null>(null);
  const [terminalFor, setTerminalFor] = useState<Container | null>(null);
  const [removeContainer, setRemoveContainer] = useState<Container | null>(null);
  const [removeProject, setRemoveProject] = useState<{ name: string; containers: Container[] } | null>(
    null,
  );
  const [stackEditor, setStackEditor] = useState<{ name: string | null } | null>(null);
  const [deleteStack, setDeleteStack] = useState<Stack | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsView>("/api/settings"),
  });
  const baseDomain = settings.data?.base_domain?.value ?? null;

  const removeMut = useMutation({
    mutationFn: (c: Container) => api.del(`/api/docker/containers/${c.id}`),
    onSuccess: () => {
      setRemoveContainer(null);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
  });

  const removeProjectMut = useMutation({
    mutationFn: (p: { containers: Container[] }) =>
      Promise.all(p.containers.map((c) => api.del(`/api/docker/containers/${c.id}`))),
    onSuccess: () => {
      setRemoveProject(null);
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
  });

  const deleteStackMut = useMutation({
    mutationFn: ({ name, data }: { name: string; data: boolean }) =>
      api.del(`/api/docker/stacks/${name}${data ? "?delete_data=true" : ""}`),
    onSuccess: () => {
      setDeleteStack(null);
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Docker</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your containers, grouped by stack — start, stop, update and install apps.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
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
      </header>

      <div className="mb-4 space-y-3">
        <ModuleStatus name="Docker" health={health.data?.docker} />
        <StatsBar />
      </div>

      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 p-1">
        <TabButton active={tab === "containers"} onClick={() => setTab("containers")}>
          Containers
        </TabButton>
        <TabButton active={tab === "volumes"} onClick={() => setTab("volumes")}>
          Volumes
        </TabButton>
      </div>

      {tab === "containers" ? (
        <StackGroups
          baseDomain={baseDomain}
          onLogs={setLogsFor}
          onTerminal={setTerminalFor}
          onRemove={setRemoveContainer}
          onRemoveProject={setRemoveProject}
          onEditStack={(name) => setStackEditor({ name })}
          onDeleteStack={(stack) => {
            setDeleteData(false); // never carried over from a previous dialog
            setDeleteStack(stack);
          }}
        />
      ) : (
        <VolumeList />
      )}

      {logsFor && <LogViewer container={logsFor} onClose={() => setLogsFor(null)} />}
      {terminalFor && <Terminal container={terminalFor} onClose={() => setTerminalFor(null)} />}
      {stackEditor && (
        <StackEditor name={stackEditor.name} onClose={() => setStackEditor(null)} />
      )}
      {wizardOpen && <InstallWizard onClose={() => setWizardOpen(false)} />}

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
        open={removeProject !== null}
        title="Remove containers"
        destructive
        confirmLabel="Remove"
        onCancel={() => setRemoveProject(null)}
        onConfirm={() => removeProject && removeProjectMut.mutate(removeProject)}
      >
        Remove the {removeProject?.containers.length} containers of{" "}
        <span className="font-medium text-slate-200">{removeProject?.name}</span>? They are
        force-removed; its compose files are not Loskai's and stay where they are
        {removeProject?.containers[0]?.compose_dir && (
          <>
            {" "}
            (<span className="font-mono">{removeProject.containers[0].compose_dir}</span>)
          </>
        )}
        .
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteStack !== null}
        title="Delete stack"
        destructive
        confirmLabel={deleteData ? "Delete with data" : "Delete"}
        onCancel={() => setDeleteStack(null)}
        onConfirm={() =>
          deleteStack && deleteStackMut.mutate({ name: deleteStack.name, data: deleteData })
        }
      >
        {deleteStack && (
          <DeleteStackOptions stack={deleteStack} deleteData={deleteData} onDeleteData={setDeleteData} />
        )}
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
