import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Anchor,
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
import { RowMenu } from "../shared/RowMenu";
import { StatusBadge } from "../shared/StatusBadge";
import {
  groupByStack,
  groupStatus,
  type Container,
  type Group,
  type Stack,
} from "./groupByStack";

// Every container on the host, nested under the stack that started it — in two sections:
// the stacks Loskai manages (their header row is where their links, status and actions
// live), then everything else, listed but not managed. Loskai's own container sits apart
// above both. One table, so a container and its stack are never two tabs apart.
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

  const self = (containers.data ?? []).find((c) => c.self);
  const groups = groupByStack(containers.data ?? [], stacks.data ?? []);
  const managed = groups.filter((g) => g.kind === "stack");
  const others = groups.filter((g) => g.kind !== "stack");

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderGroup = (group: Group) => {
    const open = !collapsed.has(group.key);
    // A stack's links sit on its header with its status; a standalone container is
    // unrelated to its neighbours, so its link stays on its own row.
    const linksOnHeader = group.kind !== "standalone";
    return (
      <Fragment key={group.key}>
        <GroupHeader
          group={group}
          baseDomain={linksOnHeader ? baseDomain : undefined}
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
              baseDomain={linksOnHeader ? undefined : baseDomain}
              busy={containerAction.isPending && containerAction.variables?.id === c.id}
              onAction={(verb) => containerAction.mutate({ id: c.id, verb })}
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
      {self && <SelfStrip c={self} baseDomain={baseDomain} onLogs={() => onLogs(self)} />}
      <Section title="Stacks">
        {managed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
            No stacks yet. Install a recipe, or create a stack.
          </div>
        ) : (
          <GroupTable>{managed.map(renderGroup)}</GroupTable>
        )}
      </Section>
      {/* Its own table, and none at all when there is nothing Loskai doesn't manage. */}
      {others.length > 0 && (
        <Section title="Other containers" note="not managed by Loskai — started outside the stacks folder">
          <GroupTable>{others.map(renderGroup)}</GroupTable>
        </Section>
      )}
    </div>
  );
}

const COLS = 5;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-2">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
        {title}
        {note && <span className="ml-2 normal-case tracking-normal text-slate-600">· {note}</span>}
      </h2>
      {children}
    </section>
  );
}

// Both sections' tables share fixed column widths, so their columns line up across the gap.
function GroupTable({ children }: { children: React.ReactNode }) {
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
            <th className="px-4 py-2.5 font-medium">Container</th>
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
  // Set when the group's route links belong on its header; undefined leaves them on rows.
  baseDomain: string | null | undefined;
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
  const links = baseDomain ? group.containers.filter((c) => c.subdomain) : [];
  return (
    <tr className={`border-t border-slate-800 bg-slate-900/50 ${muted ? "opacity-80" : ""}`}>
      <td colSpan={COLS - 1} className="px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
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
                <Layers className={`h-3.5 w-3.5 ${muted ? "text-slate-500" : "text-teal-300/70"}`} />
                <span className="font-medium">
                  {group.kind === "stack" ? group.stack.name : group.name}
                </span>
              </>
            )}
          </button>
          {group.containers.length > 0 || group.kind === "stack" ? (
            <StatusBadge status={status.tone} label={status.label} />
          ) : null}
          {links.map((c) => (
            <RouteLink key={c.id} host={`${c.subdomain}.${baseDomain}`} scheme={c.scheme} />
          ))}
        </div>
      </td>
      <td className="px-4 py-2">
        {group.kind === "stack" && (
          <div className="flex items-center justify-end gap-1">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            {/* One toggle: Stop only once everything is up, so a half-started stack
                still offers to bring the rest up. */}
            {status.label === "up" ? (
              <Act
                title="Stop — compose down; the containers go, the data stays"
                onClick={() => onAction("down")}
              >
                <Square className="h-3.5 w-3.5" />
              </Act>
            ) : (
              <Act title="Start — compose up" onClick={() => onAction("up")}>
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
  baseDomain,
  busy,
  onAction,
  onLogs,
  onTerminal,
  onRemove,
}: {
  c: Container;
  // Set when the link belongs on this row rather than on its group's header.
  baseDomain: string | null | undefined;
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
          {c.subdomain && baseDomain !== undefined &&
            (baseDomain ? (
              <RouteLink host={`${c.subdomain}.${baseDomain}`} scheme={c.scheme} />
            ) : (
              <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] text-teal-300">
                {c.subdomain}
              </span>
            ))}
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
