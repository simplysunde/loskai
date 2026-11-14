import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { requestUnlock } from "../../lib/unlock";
import { projectsIn, type ToolContext, type ToolStart } from "../../lib/toolRows";
import { cardSettingsOf, hasCardSettings, hasKeys, rowSettingsOf, settingsActionsOf, type Tool, type ToolTarget } from "../../lib/tools";
import { TOOL_BUTTON } from "../../lib/ui";
import { Ask } from "./ToolAsk";
import { ActionIcon } from "./ToolIcon";
import { Overlay } from "../shared/Modal";

// The machine's settings by id, and each row's by kind and row: `targets.project.site`.
type Values = {
  values: Record<string, string | null>;
  targets?: Record<string, Record<string, Record<string, string | null>>>;
};

// A tool's settings as the machine has them — the machine's and every row's, in one read
// with Loskai's key — and where they are set. The card and its rows share the one read.
function useToolSettings(tool: Tool, machineId: string) {
  const key = ["tool-settings", machineId, tool.id];
  const url = `/api/ssh/machines/${machineId}/tools/${tool.id}/settings`;
  const values = useQuery({
    queryKey: key,
    queryFn: () => api.get<Values>(url),
    enabled: (tool.settings?.length ?? 0) > 0,
  });
  return { key, url, values };
}

// Where a dialog's settings are: the card's — the machine's own values — or a row's.
type Row = { kind: ToolTarget; name: string };

// Opens the card's settings — a Settings button in its header — or, given a `row`, that
// row's own, from a cog on it, in a dialog. Read with Loskai's key: while it is locked, your
// password first. A row's cog is teal while any of its own is set.
export function SettingsButton({
  tool,
  ctx,
  row,
  onOpen,
}: {
  tool: Tool;
  ctx: ToolContext;
  row?: Row;
  onOpen: () => void;
}) {
  const { values } = useToolSettings(tool, ctx.machineId);
  const locked = values.error instanceof ApiError && values.error.status === 423;
  let title: string;
  let own = false;
  if (row) {
    const mine = values.data?.targets?.[row.kind]?.[row.name] ?? {};
    const set = rowSettingsOf(tool, row.kind).filter((s) => mine[s.id]).map((s) => `${s.label} ${mine[s.id]}`);
    // Its own SSH key counts as its own setting: one in place of the machine's.
    const key = row.kind === "project" && hasKeys(tool) ? projectKeyOf(ctx, row.name) : null;
    if (key != null) set.push(`SSH key ${key || "its own command"}`);
    own = set.length > 0;
    title = own ? `Its own: ${set.join(", ")}` : "Its own settings, in place of the card's";
  } else {
    const shown = [
      ...(tool.id === "git" ? [`Projects folder ${ctx.folder}`] : []),
      ...cardSettingsOf(tool).map((s) => `${s.label} ${values.data?.values[s.id] ?? (locked ? "(locked)" : "not set")}`),
    ];
    title = `${tool.name} settings — ${shown.join(" · ")}`;
  }
  return (
    <button
      type="button"
      aria-label={row ? `Settings for ${row.name}` : `${tool.name} settings`}
      aria-haspopup="dialog"
      title={title}
      onClick={async () => {
        if (!locked || (await requestUnlock())) onOpen();
      }}
      className={
        row
          ? `flex items-center rounded-md border px-1.5 py-1 hover:bg-slate-800 ${
              own ? "border-teal-700 text-teal-300" : "border-slate-700 text-slate-400"
            }`
          : "flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
      }
    >
      <Settings className={row ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {!row && "Settings"}
    </button>
  );
}

// The card's cog with its dialog — in the card's header, or a tool's own dialog's.
export function CardSettings({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const [open, setOpen] = useState(false);
  if (!hasCardSettings(tool)) return null;
  return (
    <>
      <SettingsButton tool={tool} ctx={ctx} onOpen={() => setOpen(true)} />
      {open && <SettingsDialog tool={tool} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

// Who a Git card's commits are by, beside its summary — once the settings are read.
export function GitIdentity({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const { values } = useToolSettings(tool, ctx.machineId);
  const name = values.data?.values.name;
  if (tool.id !== "git" || !name) return null;
  return <span title={values.data?.values.email ?? undefined}> · as {name}</span>;
}

// The projects folder's field, among the tool's settings in Git's card dialog.
const FOLDER = "projects-folder";

const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-teal-500 disabled:text-slate-500";

// Settings in a dialog: the card's — the machine's own values — or, given a `row`, that
// row's, each empty while the card's applies (its value shown greyed) and emptied to take it
// off again. Save writes the ones changed, each read back; Cancel leaves them as they were.
export function SettingsDialog({
  tool,
  ctx,
  row,
  onClose,
}: {
  tool: Tool;
  ctx: ToolContext;
  row?: Row;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { key, url, values } = useToolSettings(tool, ctx.machineId);
  const settings = row ? rowSettingsOf(tool, row.kind) : cardSettingsOf(tool);
  const have: Record<string, string | null> = (row ? values.data?.targets?.[row.kind]?.[row.name] : values.data?.values) ?? {};
  // Git's card: the projects folder first — Loskai's, not the machine's, saved on its own.
  const folder = !row && tool.id === "git";
  const fields = [
    ...(folder
      ? [{ id: FOLDER, label: "Projects folder", description: "Where Claude Code finds its projects: ~ or one folder in it — empty, ~/projects.", unset: "default" }]
      : []),
    ...settings,
  ];
  const had = (id: string) => (id === FOLDER ? ctx.folder : (have[id] ?? ""));
  // What is typed; until then, what the machine has.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const shown = draft ?? Object.fromEntries(fields.map((s) => [s.id, had(s.id)]));
  const changed = fields.filter((s) => shown[s.id].trim() !== had(s.id));
  // Only what you changed: one never set and left alone stays as it is.
  const empty = changed.find((s) => !s.unset && !shown[s.id].trim());
  const save = useMutation({
    mutationFn: async () => {
      for (const s of changed) {
        const value = shown[s.id].trim();
        if (s.id === FOLDER) {
          await api.put(`/api/ssh/machines/${ctx.machineId}/projects`, { folder: value });
          await qc.invalidateQueries({ queryKey: ["ssh"] });
        } else {
          qc.setQueryData(key, await api.put<Values>(`${url}/${s.id}`, row ? { value, target: row.name } : { value }));
        }
      }
    },
    onSuccess: onClose,
  });
  const label = row ? `Settings for ${row.name}` : `${tool.name} settings`;
  const formId = useId();
  const actions = settingsActionsOf(tool, row?.kind ?? null);
  // Each in the machine's terminal, this dialog closing first; a row's on that row.
  const run: ToolStart = (r, a) => {
    onClose();
    ctx.onRun(row ? { ...r, target: row.name, title: `${r.title}: ${row.name}` } : r, a);
  };

  return (
    <Overlay onClose={onClose} label={label}>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length && !empty) save.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-slate-100">
          {row ? (
            <>
              Settings for <span className="font-mono">{row.name}</span>
            </>
          ) : (
            label
          )}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {row
            ? `In place of the card's, for this ${row.kind} only — empty, the card's applies.`
            : (tool.settings ?? []).some((s) => s.target)
              ? "On this machine — a project's cog can set its own in place of these."
              : "On this machine."}
        </p>
        <div className="mt-4 space-y-3">
          {fields.map((s, i) => (
            <label key={s.id} className="block">
              <span className="text-sm text-slate-200">{s.label}</span>
              <span className="mb-1.5 block text-xs text-slate-500">{s.description}</span>
              <input
                aria-label={s.label}
                autoFocus={i === 0}
                value={shown[s.id]}
                onChange={(e) => setDraft({ ...shown, [s.id]: e.target.value })}
                placeholder={(row && "overrides" in s && s.overrides ? values.data?.values[s.overrides] : null) ?? "not set"}
                disabled={(s.id !== FOLDER && !values.data) || save.isPending}
                className={`${FIELD} ${s.id === FOLDER ? "font-mono" : ""}`}
              />
            </label>
          ))}
        </div>
        {/* A project's key: the machine's, or its own — Own key and Machine's key, below. */}
        {row?.kind === "project" && hasKeys(tool) && <ProjectKey ctx={ctx} name={row.name} />}
        {values.isLoading && <Loader2 className="mt-3 h-4 w-4 animate-spin text-slate-500" />}
        {(save.error || values.error) && (
          <p className="mt-3 text-sm text-rose-400">
            {save.error ? apiMessage(save.error, "Couldn't save it") : apiMessage(values.error, "Couldn't read them")}
          </p>
        )}
        {empty && <p className="mt-3 text-sm text-rose-400">{empty.label} needs a value.</p>}
      </form>
      {/* Beside the values, what is set up once and rarely run (Git's SSH key): each runs in
          the machine's terminal, this dialog closing first. A form of its own, so outside
          the one above. */}
      {actions.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <span className="text-sm text-slate-200">Actions</span>
          <span className="mb-2 block text-xs text-slate-500">Run in the machine's terminal.</span>
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((a) =>
              a.ask ? (
                <Ask key={a.id} tool={tool} action={a} onRun={run} />
              ) : (
                <button
                  key={a.id}
                  type="button"
                  title={a.description}
                  onClick={() => run({ tool: tool.id, action: a.id, title: a.label }, a)}
                  className={TOOL_BUTTON}
                >
                  <ActionIcon tool={tool.id} action={a.id} className="h-3.5 w-3.5" /> {a.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Cancel
        </button>
        <button
          type="submit"
          form={formId}
          disabled={!changed.length || Boolean(empty) || save.isPending}
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>
    </Overlay>
  );
}

// The SSH key git uses for a project: null the machine's, a key's name its own, "" a
// core.sshCommand of its own naming no key — as the overview read it.
function projectKeyOf(ctx: ToolContext, name: string): string | null {
  return projectsIn(ctx.facts, ctx.folder).find((p) => p.name === name)?.key ?? null;
}

// Which key a project's git uses, in its dialog: the machine's, greyed, or its own.
function ProjectKey({ ctx, name }: { ctx: ToolContext; name: string }) {
  const key = projectKeyOf(ctx, name);
  const known = ctx.facts.ssh_keys;
  const info = key ? known?.find((k) => k.name === key) : null;
  return (
    <div className="mt-3">
      <span className="text-sm text-slate-200">SSH key</span>
      <span className="mb-1 block text-xs text-slate-500">
        Its own — a deploy key, for its repository alone — in place of the machine's. Every key is in Keys.
      </span>
      <span aria-label="SSH key" className={`block break-all font-mono text-xs ${key != null ? "text-slate-200" : "text-slate-500"}`}>
        {known === undefined || known === null
          ? "the machine's status line is older — install it again to see"
          : key == null
            ? "the machine's"
            : key === ""
              ? "its own ssh command"
              : `${key}${info ? ` · ${info.fingerprint}` : ""}`}
      </span>
    </div>
  );
}
