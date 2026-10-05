import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
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

import { api } from "../../lib/api";
import { formatPercent, formatUptime } from "../../lib/format";
import { RouteLink } from "../shared/RouteLink";
import { StatusBadge } from "../shared/StatusBadge";
import { groupByStack, type Container, type Group, type Stack } from "./groupByStack";

const STACK_STATUS: Record<string, string> = {
  up: "healthy",
  partial: "degraded",
  down: "unconfigured",
  unknown: "unknown",
};

// Every container on the host, nested under the stack that started it. A stack's header row
// carries the stack's own actions (up, down, edit its compose file…); a compose project from
// outside the stacks directory is listed but not managed; a plain `docker run` container sits
// under Standalone. One table, so a container and its stack are never two tabs apart.
export function StackGroups({
  baseDomain,
  onLogs,
  onTerminal,
  onRemove,
  onEditStack,
  onDeleteStack,
}: {
  baseDomain: string | null;
  onLogs: (c: Container) => void;
  onTerminal: (c: Container) => void;
  onRemove: (c: Container) => void;
  onEditStack: (name: string) => void;
  onDeleteStack: (stack: Stack) => void;
}) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const containers = useQuery({
    queryKey: ["docker-containers"],
    queryFn: () => api.get<Container[]>("/api/docker/containers"),
    refetchInterval: 5_000,
    retry: false,
  });
  const stacks = useQuery({
    queryKey: ["docker-stacks"],
    queryFn: () => api.get<Stack[]>("/api/docker/stacks"),
    refetchInterval: 8_000,
    retry: false,
  });

  const containerAction = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: string }) =>
      api.post(`/api/docker/containers/${id}/${verb}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["docker-containers"] }),
  });
  const stackAction = useMutation({
    mutationFn: ({ name, verb }: { name: string; verb: string }) =>
      api.post(`/api/docker/stacks/${name}/action`, { action: verb }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["docker-stacks"] });
      qc.invalidateQueries({ queryKey: ["docker-containers"] });
    },
  });

  if (containers.isLoading || stacks.isLoading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const groups = groupByStack(containers.data ?? [], stacks.data ?? []);
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
        No containers or stacks yet. Install a recipe, or create a stack.
      </div>
    );
  }

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-medium">Container</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Uptime</th>
            <th className="px-4 py-2.5 font-medium">CPU</th>
            <th className="px-4 py-2.5 font-medium">Mem</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const open = !collapsed.has(group.key);
            return (
              <Fragment key={group.key}>
                <GroupHeader
                  group={group}
                  open={open}
                  onToggle={() => toggle(group.key)}
                  busy={
                    stackAction.isPending &&
                    group.kind === "stack" &&
                    stackAction.variables?.name === group.stack.name
                  }
                  onAction={(verb) =>
                    group.kind === "stack" && stackAction.mutate({ name: group.stack.name, verb })
                  }
                  onEdit={() => group.kind === "stack" && onEditStack(group.stack.name)}
                  onDelete={() => group.kind === "stack" && onDeleteStack(group.stack)}
                />
                {open && group.containers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 pb-3 pl-11 text-xs text-slate-600">
                      No containers — bring the stack up to create them.
                    </td>
                  </tr>
                )}
                {open &&
                  group.containers.map((c) => (
                    <ContainerRow
                      key={c.id}
                      c={c}
                      baseDomain={baseDomain}
                      busy={containerAction.isPending && containerAction.variables?.id === c.id}
                      onAction={(verb) => containerAction.mutate({ id: c.id, verb })}
                      onLogs={() => onLogs(c)}
                      onTerminal={() => onTerminal(c)}
                      onRemove={() => onRemove(c)}
                    />
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupHeader({
  group,
  open,
  onToggle,
  busy,
  onAction,
  onEdit,
  onDelete,
}: {
  group: Group;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onAction: (verb: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;
  const running = group.containers.filter((c) => c.status === "running").length;
  return (
    <tr className="border-t border-slate-800 bg-slate-900/50">
      <td colSpan={5} className="px-4 py-2">
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-2 text-left text-slate-200"
        >
          <Chevron className="h-4 w-4 text-slate-500" />
          {group.kind === "standalone" ? (
            <span className="font-medium text-slate-300">Standalone</span>
          ) : (
            <>
              <Layers className="h-3.5 w-3.5 text-teal-300/70" />
              <span className="font-medium">
                {group.kind === "stack" ? group.stack.name : group.name}
              </span>
            </>
          )}
          {group.kind === "stack" && (
            <StatusBadge status={STACK_STATUS[group.stack.status]} label={group.stack.status} />
          )}
          <span className="text-xs text-slate-500">
            {group.containers.length > 0
              ? `${running} of ${group.containers.length} running`
              : "no containers"}
          </span>
          {group.kind === "project" && (
            <span
              title="Started by a compose file outside the stacks directory — Loskai lists it but doesn't manage it"
              className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
            >
              not in stacks folder
            </span>
          )}
        </button>
      </td>
      <td className="px-4 py-2">
        {group.kind === "stack" && (
          <div className="flex items-center justify-end gap-1">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            <Act title="Up" onClick={() => onAction("up")}>
              <Play className="h-3.5 w-3.5" />
            </Act>
            <Act title="Down" onClick={() => onAction("down")}>
              <Square className="h-3.5 w-3.5" />
            </Act>
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

function ContainerRow({
  c,
  baseDomain,
  busy,
  onAction,
  onLogs,
  onTerminal,
  onRemove,
}: {
  c: Container;
  baseDomain: string | null;
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
          {c.name}
          {c.subdomain &&
            (baseDomain ? (
              <RouteLink host={`${c.subdomain}.${baseDomain}`} scheme={c.scheme} />
            ) : (
              <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300">
                {c.subdomain}
              </span>
            ))}
        </div>
        <div className="font-mono text-xs text-slate-500">{c.image}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={running ? "healthy" : "unconfigured"} label={c.status} />
      </td>
      <td className="px-4 py-3 text-slate-400">{formatUptime(c.uptime)}</td>
      <td className="px-4 py-3 text-slate-400">{formatPercent(c.cpu)}</td>
      <td className="px-4 py-3 text-slate-400">{formatPercent(c.mem?.percent)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
          {running ? (
            <>
              <Act title="Stop" onClick={() => onAction("stop")}>
                <Square className="h-3.5 w-3.5" />
              </Act>
              <Act title="Restart" onClick={() => onAction("restart")}>
                <RotateCw className="h-3.5 w-3.5" />
              </Act>
            </>
          ) : (
            <Act title="Start" onClick={() => onAction("start")}>
              <Play className="h-3.5 w-3.5" />
            </Act>
          )}
          <Act title="Logs" onClick={onLogs}>
            <ScrollText className="h-3.5 w-3.5" />
          </Act>
          <Act title="Terminal" onClick={onTerminal} disabled={!running}>
            <TerminalSquare className="h-3.5 w-3.5" />
          </Act>
          <Act title="Remove" danger onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Act>
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
