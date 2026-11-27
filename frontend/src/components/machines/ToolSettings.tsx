import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { requestUnlock } from "../../lib/unlock";
import { remoteSshHost } from "../../lib/ssh";
import { projectsIn, type ToolContext, type ToolStart } from "../../lib/toolRows";
import { cardSettingsOf, hasCardSettings, hasKeys, rowSettingsOf, settingsActionsOf, type Tool, type TargetKind } from "../../lib/tools";
import { TOOL_BUTTON } from "../../lib/ui";
import { ToolAsk } from "./ToolAsk";
import { ActionIcon } from "./ToolIcon";
import { Overlay } from "../shared/Modal";
import { ReasonButton } from "../shared/Hint";

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
type Row = { kind: TargetKind; name: string };

// A row's own settings — some in place of the card's (`overrides`), some only its own (Git's
// Remote): "Project settings".
function settingsNameOf(row: Row): string {
  return `${row.kind[0].toUpperCase()}${row.kind.slice(1)} settings`;
}

// Opens the card's settings — a Settings button in its header — or, given a `row`, that
// row's own, from a cog on it, in a dialog. Read with Loskai's key: while it is locked, your
// password first. A row's cog is teal while it overrides the card: one of its own set in place
// of the card's, or its own SSH key. One that replaces nothing (a remote) is in its title only.
export function ToolSettingsButton({
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
    const set = rowSettingsOf(tool, row.kind).filter((s) => mine[s.id]);
    const said = set.map((s) => `${s.label} ${mine[s.id]}`);
    // Its own SSH key overrides too: one in place of the machine's.
    const key = row.kind === "project" && hasKeys(tool) ? projectKeyOf(ctx, row.name) : null;
    if (key != null) said.push(`SSH key ${key || "its own command"}`);
    own = set.some((s) => s.overrides) || key != null;
    title = said.length ? `${settingsNameOf(row)} — ${said.join(", ")}` : `${settingsNameOf(row)}: none of its own yet`;
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
      aria-label={row ? `${settingsNameOf(row)} for ${row.name}` : `${tool.name} settings`}
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
      <ToolSettingsButton tool={tool} ctx={ctx} onOpen={() => setOpen(true)} />
      {open && <ToolSettingsDialog tool={tool} ctx={ctx} onClose={() => setOpen(false)} />}
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
export function ToolSettingsDialog({
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
  const hasFolderField = !row && tool.id === "git";
  const fields = [
    ...(hasFolderField
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
  const emptyField = changed.find((s) => !s.unset && !shown[s.id].trim());
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
  const label = row ? `${settingsNameOf(row)} for ${row.name}` : `${tool.name} settings`;
  const formId = useId();
  // A project's own key and back are its key section's buttons, not the list's.
  const keyed = row?.kind === "project" && hasKeys(tool);
  const actions = settingsActionsOf(tool, row?.kind ?? null).filter((a) => !(keyed && KEY_ACTIONS.includes(a.id)));
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
          if (changed.length && !emptyField) save.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-slate-100">
          {row ? (
            <>
              {settingsNameOf(row)} for <span className="font-mono">{row.name}</span>
            </>
          ) : (
            label
          )}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {row
            ? `For this ${row.kind} only — one that replaces the card's, left empty, leaves the card's.`
            : (tool.settings ?? []).some((s) => s.target)
              ? "On this machine — Project settings, a project's cog, can set its own."
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
        {keyed && row && <ProjectKey tool={tool} ctx={ctx} name={row.name} onRun={run} />}
        {values.isLoading && <Loader2 className="mt-3 h-4 w-4 animate-spin text-slate-500" />}
        {(save.error || values.error) && (
          <p className="mt-3 text-sm text-rose-400">
            {save.error ? apiMessage(save.error, "Couldn't save it") : apiMessage(values.error, "Couldn't read them")}
          </p>
        )}
        {emptyField && <p className="mt-3 text-sm text-rose-400">{emptyField.label} needs a value.</p>}
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
                <ToolAsk key={a.id} tool={tool} action={a} onRun={run} />
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
          disabled={!changed.length || Boolean(emptyField) || save.isPending}
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

// A project's key buttons — Own key, Machine's key — kept in its key section.
const KEY_ACTIONS = ["own-key", "machine-key"];

// Which key a project's git uses, in its overrides, in a line — and the one button that
// changes it: its own key while it uses the machine's, back to the machine's while it has
// its own. Over HTTP(S) no SSH key is used at all, which it says, the button greyed; a
// core.sshCommand set by hand is left to whoever set it.
function ProjectKey({ tool, ctx, name, onRun }: { tool: Tool; ctx: ToolContext; name: string; onRun: ToolStart }) {
  const project = projectsIn(ctx.facts, ctx.folder).find((p) => p.name === name);
  const key = projectKeyOf(ctx, name);
  const info = key ? ctx.facts.ssh_keys?.find((k) => k.name === key) : null;
  // Its own remotes (not a submodule's): none over SSH, and no key is used.
  const remotes = ctx.facts.remotes?.filter((r) => r.path === project?.path && r.module === "");
  const noSsh = remotes != null && !remotes.some((r) => remoteSshHost(r.url));
  const action = tool.actions.find((a) => a.id === (key == null ? "own-key" : "machine-key"));
  const line =
    ctx.facts.ssh_keys == null
      ? "The machine's status line is older — install it again to see."
      : key == null
        ? "Uses the machine's key."
        : key === ""
          ? "Uses an ssh command of its own (core.sshCommand), set by hand."
          : `Uses its own key, ${key}${info ? ` · ${info.fingerprint.slice(0, 19)}…` : ""}`;
  const why = noSsh
    ? remotes.length === 0
      ? "It has no remote yet: a key is used once one goes over SSH."
      : "Its remote is over HTTP(S), which uses no SSH key — switch it to its SSH address first."
    : null;
  return (
    <div className="mt-3">
      <span className="text-sm text-slate-200">SSH key</span>
      <span className="mb-1 block text-xs text-slate-500">Its own is a deploy key: it reaches this repository alone.</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span aria-label="SSH key" className={`text-xs ${key != null ? "text-slate-200" : "text-slate-400"}`}>
          {line}
        </span>
        {action && key !== "" && (
          <ReasonButton
            reason={key == null ? why : null}
            title={action.description}
            onClick={() => onRun({ tool: tool.id, action: action.id, title: action.label }, action)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          >
            <ActionIcon tool={tool.id} action={action.id} className="h-3.5 w-3.5" />
            {key == null ? "Give it its own key" : "Back to the machine's key"}
          </ReasonButton>
        )}
      </div>
      {why && <p className="mt-1 text-xs text-slate-500">{why}</p>}
    </div>
  );
}
