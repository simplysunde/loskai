import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Anchor,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  HelpCircle,
  Layers,
  Loader2,
  Pencil,
  Play,
  RotateCw,
  ScrollText,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { useContainers, type Container } from "../../lib/containers";
import { docUrl } from "../../lib/docs";
import { formatPercent, formatUptime } from "../../lib/format";
import { useExpanded } from "../../lib/useExpanded";
import { ActionError } from "../shared/ActionError";
import { RouteLink } from "../shared/RouteLink";
import { RowMenu } from "../shared/RowMenu";
import { StatusBadge } from "../shared/StatusBadge";
import {
  groupByStack,
  groupStatus,
  groupTotals,
  type Group,
  type Stack,
} from "./groupByStack";

// Every container on the host, nested under the stack that started it — in two sections:
// the stacks Loskai manages (their header row is where their links, status and actions
// live), then everything else, listed but not managed. Loskai's own container sits apart
// above both. One table, so a container and its stack are never two tabs apart.
// A compose verb as the failure says it: "Couldn't start immich".
const SAID: Record<string, string> = { up: "start", down: "stop", pull: "update" };

export function StackGroups({
  baseDomain,
  onLogs,
  onTerminal,
  onRemove,
  onEditStack,
  onDeleteStack,
  onRemoveProject,
}: {
  baseDomain: string | null;
  onLogs: (c: Container) => void;
  onTerminal: (c: Container) => void;
  onRemove: (c: Container) => void;
  onEditStack: (name: string) => void;
  onDeleteStack: (stack: Stack) => void;
  // A compose project from elsewhere: remove its containers (its files are not Loskai's).
  onRemoveProject: (project: { name: string; containers: Container[] }) => void;
}) {
  const qc = useQueryClient();
  const expanded = useExpanded("loskai.docker.expanded");

  const containers = useContainers({ poll: true });
  // The slow half (~2s, Docker samples CPU twice): its own query, so the tables render as
  // soon as the list is in and CPU/memory fill in after. Nothing waits on it.
  const stats = useQuery({
    queryKey: ["docker-container-stats"],
    queryFn: () =>
      api.get<Record<string, Pick<Container, "cpu" | "mem">>>("/api/docker/containers/stats"),
    refetchInterval: 5_000,
    retry: false,
  });
  const stacks = useQuery({
    queryKey: ["docker-stacks"],
    queryFn: () => api.get<Stack[]>("/api/docker/stacks"),
    refetchInterval: 8_000,
    retry: false,
  });

  const [failed, setFailed] = useState<{ title: string; detail: string } | null>(null);
  const reports = {
    onMutate: () => setFailed(null),
    onError: (err: unknown, v: { name: string; verb: string }) =>
      setFailed({ title: `Couldn't ${SAID[v.verb] ?? v.verb} ${v.name}`, detail: apiMessage(err) }),
  };

  const containerAction = useMutation({
    mutationFn: ({ id, verb }: { id: string; name: string; verb: string }) =>
      api.post(`/api/docker/containers/${id}/${verb}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-containers"] }),
    ...reports,
  });
  // A compose project started elsewhere has no compose file here, so its toggle is plain
  // docker start/stop on each container — it pauses and resumes, it cannot recreate one.
  const projectAction = useMutation({
    mutationFn: ({ containers, verb }: { name: string; containers: Container[]; verb: "start" | "stop" }) =>
      Promise.all(
        containers
          .filter((c) => (c.status === "running") === (verb === "stop"))
          .map((c) => api.post(`/api/docker/containers/${c.id}/${verb}`)),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-containers"] }),
    ...reports,
  });
  const stackAction = useMutation({
    mutationFn: async ({ name, verb }: { name: string; verb: string }) => {
      const r = await api.post<{ ok: boolean; output: string }>(`/api/docker/stacks/${name}/action`, { action: verb });
      // Compose ran and failed: the request succeeded, so its output is the error.
      if (!r.ok) throw new ApiError(200, r.output || `docker compose ${verb} failed`);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
    ...reports,
  });

  if (containers.isLoading || stacks.isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // Running ones only: stats lag the list by a poll, and a container just stopped should
  // not keep showing the CPU it had.
  const all = (containers.data ?? []).map((c) =>
    c.status === "running" ? { ...c, ...stats.data?.[c.id] } : c,
  );
  const self = all.find((c) => c.self);
  const groups = groupByStack(all, stacks.data ?? []);
  const managed = groups.filter((g) => g.kind === "stack");
  const others = groups.filter((g) => g.kind !== "stack");

  const keys = (table: Group[]) => table.map((g) => g.key);
  const toggleAll = (table: Group[]) => expanded.toggleAll(keys(table));
  const anyOpen = (table: Group[]) => expanded.anyOpen(keys(table));

  const renderGroup = (group: Group) => {
    const open = expanded.isOpen(group.key);
    return (
      <Fragment key={group.key}>
        <GroupHeader
          group={group}
          baseDomain={baseDomain}
          open={open}
          onToggle={() => expanded.toggle(group.key)}
          busy={
            group.kind === "stack"
              ? stackAction.isPending && stackAction.variables?.name === group.stack.name
              : projectAction.isPending && projectAction.variables?.name === group.name
          }
          onAction={(verb) => {
            if (group.kind === "stack") stackAction.mutate({ name: group.stack.name, verb });
            else if (verb === "start" || verb === "stop")
              projectAction.mutate({ name: group.name, containers: group.containers, verb });
          }}
          onEdit={() => group.kind === "stack" && onEditStack(group.stack.name)}
          onDelete={() => {
            if (group.kind === "stack") onDeleteStack(group.stack);
            else if (group.kind === "project")
              onRemoveProject({ name: group.name, containers: group.containers });
            else onRemove(group.containers[0]);
          }}
        />
        {open && group.containers.length === 0 && (
          <tr>
            <td colSpan={COLS} className="px-4 pb-3 pl-11 text-xs text-slate-600">
              No containers — start the stack to create them.
            </td>
          </tr>
        )}
        {open &&
          group.containers.map((c) => (
            <ContainerRow
              key={c.id}
              c={c}
              busy={containerAction.isPending && containerAction.variables?.id === c.id}
              onAction={(verb) => containerAction.mutate({ id: c.id, name: c.name, verb })}
              onLogs={() => onLogs(c)}
              onTerminal={() => onTerminal(c)}
              onRemove={() => onRemove(c)}
            />
          ))}
      </Fragment>
    );
  };

  return (
    <div className="space-y-3">
      {failed && <ActionError {...failed} onDismiss={() => setFailed(null)} />}
      {self && <SelfStrip c={self} baseDomain={baseDomain} onLogs={() => onLogs(self)} />}
      <GroupTable
        title="Stacks"
        anyOpen={anyOpen(managed)}
        onToggleAll={managed.length ? () => toggleAll(managed) : undefined}
      >
        {managed.length === 0 ? (
          <tr>
            <td colSpan={COLS} className="px-4 py-10 text-center text-sm text-slate-500">
              No stacks yet. Install a recipe, or create a stack.
            </td>
          </tr>
        ) : (
          managed.map(renderGroup)
        )}
      </GroupTable>
      {/* Its own table, and none at all when there is nothing Loskai doesn't manage. */}
      {others.length > 0 && (
        <GroupTable
          title="Other containers"
          note="not managed by Loskai — started outside the stacks folder"
          guide={docUrl("docs/guides/migration.md")}
          anyOpen={anyOpen(others)}
          onToggleAll={() => toggleAll(others)}
        >
          {others.map(renderGroup)}
        </GroupTable>
      )}
    </div>
  );
}

const COLS = 5;

// Each section is its own table, titled in its header row. Both share fixed column
// widths, so their columns line up across the gap.
function GroupTable({
  title,
  note,
  guide,
  anyOpen,
  onToggleAll,
  children,
}: {
  title: string;
  // Hover text for the title.
  note?: string;
  // A doc page about this section, linked beside the title.
  guide?: string;
  anyOpen: boolean;
  // Absent when there is nothing to expand.
  onToggleAll?: () => void;
  children: React.ReactNode;
}) {
  const AllIcon = anyOpen ? ChevronsDownUp : ChevronsUpDown;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[760px] table-fixed text-left text-sm">
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-20" />
          <col className="w-56" />
        </colgroup>
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium text-slate-300">
              <div className="flex items-center gap-1.5">
                <span title={note} className={note ? "cursor-help" : ""}>
                  {title}
                </span>
                {guide && (
                  <a
                    href={guide}
                    target="_blank"
                    rel="noreferrer"
                    title="How to bring these into Loskai"
                    aria-label="How to bring these into Loskai"
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </a>
                )}
                {onToggleAll && (
                  <button
                    onClick={onToggleAll}
                    title={anyOpen ? "Collapse all" : "Expand all"}
                    aria-label={`${anyOpen ? "Collapse" : "Expand"} all ${title.toLowerCase()}`}
                    className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  >
                    <AllIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </th>
            <th className="px-4 py-2.5 font-medium">Uptime</th>
            <th className="px-4 py-2.5 font-medium">CPU</th>
            <th className="px-4 py-2.5 font-medium">Mem</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// Loskai's own container, out of the list: stopping or removing it from here would take
// down the page doing it, so all it offers is its logs.
function SelfStrip({
  c,
  baseDomain,
  onLogs,
}: {
  c: Container;
  baseDomain: string | null;
  onLogs: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-teal-500/20 bg-teal-500/5 px-4 py-2.5 text-sm">
      <Anchor className="h-4 w-4 text-teal-300" />
      <span className="font-medium text-slate-100">Loskai</span>
      <span className="text-xs text-slate-500">this app</span>
      {c.subdomain && baseDomain && (
        <RouteLink host={`${c.subdomain}.${baseDomain}`} scheme={c.scheme} />
      )}
      <span className="ml-auto text-xs text-slate-500">
        {formatUptime(c.uptime)} · {formatPercent(c.cpu)} CPU · {formatPercent(c.mem?.percent)} mem ·{" "}
        <span className="font-mono">{c.image}</span>
      </span>
      <Act title="Logs" onClick={onLogs}>
        <ScrollText className="h-3.5 w-3.5" />
      </Act>
    </div>
  );
}

function GroupHeader({
  group,
  baseDomain,
  open,
  onToggle,
  busy,
  onAction,
  onEdit,
  onDelete,
}: {
  group: Group;
  baseDomain: string | null;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onAction: (verb: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const status = groupStatus(group);
  const muted = group.kind !== "stack";
  const Icon = group.kind === "standalone" ? Box : Layers;
  const single = group.kind === "standalone";
  const links = baseDomain ? group.containers.filter((c) => c.subdomain) : [];
  // Collapsed, the header stands in for its rows, so it carries their stats in their columns.
  const totals = open ? null : groupTotals(group);
  // Every container of a project carries the same label; the first that has it will do.
  const composeDir = group.containers.find((c) => c.compose_dir)?.compose_dir;
  return (
    <tr className={`border-t border-slate-800 bg-slate-900/50 ${muted ? "opacity-80" : ""}`}>
      <td className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-2 text-left text-slate-200"
          >
            <Chevron className="h-4 w-4 text-slate-500" />
            {/* A box for a lone container, layers for a project of them. */}
            <Icon className={`h-3.5 w-3.5 ${muted ? "text-slate-500" : "text-teal-300/70"}`} />
            <span className="font-medium">
              {group.kind === "stack" ? group.stack.name : group.name}
            </span>
          </button>
          {group.containers.length > 0 || group.kind === "stack" ? (
            <StatusBadge status={status.tone} label={status.label} />
          ) : null}
          {links.map((c) => (
            <RouteLink key={c.id} host={`${c.subdomain}.${baseDomain}`} scheme={c.scheme} />
          ))}
        </div>
      </td>
      <td className="px-4 py-2 text-slate-400">{totals && formatUptime(totals.uptime)}</td>
      <td className="px-4 py-2 text-slate-400">{totals && formatPercent(totals.cpu)}</td>
      <td className="px-4 py-2 text-slate-400">{totals && formatPercent(totals.mem)}</td>
      <td className="px-4 py-2">
        {/* The same toggle, in the same place, for a project started elsewhere or a lone
            container — plain docker start/stop, as there is no compose file here to run. */}
        {group.kind !== "stack" && (
          <div className="flex items-center justify-end gap-1">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            {status.label === "up" ? (
              <Act title={single ? "Stop" : "Stop all"} onClick={() => onAction("stop")}>
                <Square className="h-3.5 w-3.5" />
              </Act>
            ) : (
              <Act title={single ? "Start" : "Start all"} onClick={() => onAction("start")}>
                <Play className="h-3.5 w-3.5" />
              </Act>
            )}
            {composeDir && (
              <span
                role="img"
                title={`Started from ${composeDir}`}
                aria-label={`Started from ${composeDir}`}
                className="cursor-help rounded-lg border border-slate-700 p-1.5 text-slate-300"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            )}
            <Act title={single ? "Remove" : "Remove containers"} danger onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Act>
          </div>
        )}
        {group.kind === "stack" && (
          <div className="flex items-center justify-end gap-1">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            {/* One toggle: Stop only once everything is up, so a half-started stack
                still offers to bring the rest up. */}
            {status.label === "up" ? (
              <Act title="Compose down" onClick={() => onAction("down")}>
                <Square className="h-3.5 w-3.5" />
              </Act>
            ) : (
              <Act title="Compose up" onClick={() => onAction("up")}>
                <Play className="h-3.5 w-3.5" />
              </Act>
            )}
            <Act title="Restart" onClick={() => onAction("restart")}>
              <RotateCw className="h-3.5 w-3.5" />
            </Act>
            <Act title="Pull + update" onClick={() => onAction("pull")}>
              <UploadCloud className="h-3.5 w-3.5" />
            </Act>
            <Act title="Edit" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
            </Act>
            <Act title="Delete stack" danger onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Act>
          </div>
        )}
      </td>
    </tr>
  );
}

const DOT: Record<string, string> = {
  running: "bg-emerald-400",
  restarting: "bg-amber-400",
  paused: "bg-amber-400",
  dead: "bg-rose-400",
};

function ContainerRow({
  c,
  busy,
  onAction,
  onLogs,
  onTerminal,
  onRemove,
}: {
  c: Container;
  busy: boolean;
  onAction: (verb: string) => void;
  onLogs: () => void;
  onTerminal: () => void;
  onRemove: () => void;
}) {
  const running = c.status === "running";
  return (
    <tr className="border-t border-slate-800/50 hover:bg-slate-900/40">
      <td className="py-3 pl-11 pr-4">
        <div className="flex items-center gap-2 font-medium text-slate-100">
          <span
            title={c.status}
            aria-label={c.status}
            className={`h-2 w-2 shrink-0 rounded-full ${DOT[c.status] ?? "bg-slate-600"}`}
          />
          {c.name}
        </div>
        <div className="pl-4 font-mono text-xs text-slate-500">{c.image}</div>
      </td>
      <td className="px-4 py-3 text-slate-400">{formatUptime(c.uptime)}</td>
      <td className="px-4 py-3 text-slate-400">{formatPercent(c.cpu)}</td>
      <td className="px-4 py-3 text-slate-400">{formatPercent(c.mem?.percent)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
          <Act title="Logs" onClick={onLogs}>
            <ScrollText className="h-3.5 w-3.5" />
          </Act>
          <Act title="Terminal" onClick={onTerminal} disabled={!running}>
            <TerminalSquare className="h-3.5 w-3.5" />
          </Act>
          <RowMenu
            label={`More for ${c.name}`}
            items={[
              ...(running
                ? [
                    { label: "Stop", icon: <Square className="h-3.5 w-3.5" />, onClick: () => onAction("stop") },
                    { label: "Restart", icon: <RotateCw className="h-3.5 w-3.5" />, onClick: () => onAction("restart") },
                  ]
                : [{ label: "Start", icon: <Play className="h-3.5 w-3.5" />, onClick: () => onAction("start") }]),
              { label: "Remove", icon: <Trash2 className="h-3.5 w-3.5" />, onClick: onRemove, danger: true },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}

function Act({
  title,
  onClick,
  children,
  danger = false,
  disabled = false,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border border-slate-700 p-1.5 disabled:opacity-30 ${
        danger ? "text-rose-300 hover:bg-rose-500/10" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}
