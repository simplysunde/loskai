import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Settings } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { requestUnlock } from "../../lib/unlock";
import type { ToolContext } from "../../lib/toolRows";
import { rowSettingsOf, type Tool, type ToolTarget } from "../../lib/tools";
import { InlineText, SettingRow } from "../shared/SettingRow";
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

// A tool's settings, in its card: each a value on the machine, read with Loskai's key while
// the card is open and written the same way, then read back. Git's card also holds the
// machine's projects folder — Loskai's own, on its record, where Claude Code finds its
// projects. A row's own settings open from its cog (`RowSettingsButton`).
export function ToolSettings({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const qc = useQueryClient();
  const { key, url, values } = useToolSettings(tool, ctx.machineId);
  const settings = (tool.settings ?? []).filter((s) => !s.target);
  const locked = values.error instanceof ApiError && values.error.status === 423;

  return (
    <div className="mt-1 divide-y divide-slate-800">
      {tool.id === "git" && (
        <SettingRow label="Projects folder" description="Where Claude Code finds its projects: ~ or one folder in it.">
          <InlineText
            label="Projects folder"
            value={ctx.folder}
            mono
            onSave={async (v) => {
              await api.put(`/api/ssh/machines/${ctx.machineId}/projects`, { folder: v });
              await qc.invalidateQueries({ queryKey: ["ssh"] });
            }}
          />
        </SettingRow>
      )}
      {settings.map((s) => (
        <SettingRow key={s.id} label={s.label} description={s.description}>
          {values.isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
          ) : locked ? (
            <LockedField label={s.label} />
          ) : (
            <InlineText
              label={s.label}
              value={values.data?.values[s.id] ?? ""}
              placeholder="not set"
              disabled={!values.data}
              validate={(v) => (v ? null : "It needs a value.")}
              onSave={async (v) => {
                const next = await api.put<Values>(`${url}/${s.id}`, { value: v });
                qc.setQueryData(key, next);
              }}
            />
          )}
        </SettingRow>
      ))}
      {values.isError && !locked && (
        <p className="py-1 text-xs text-rose-400">{apiMessage(values.error, "Couldn't read them")}</p>
      )}
    </div>
  );
}

// A setting read while Loskai's key was locked: in the field's place, a button that asks for
// your password — and, unlocked, the setting is read again.
function LockedField({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={`${label} — unlock to read it`}
      title="Read with Loskai's key, which is locked — click to unlock it"
      onClick={() => void requestUnlock()}
      className="flex w-56 items-center gap-2 rounded-lg border border-dashed border-slate-700 px-2.5 py-1 text-sm text-slate-500 hover:border-slate-500 hover:text-slate-300"
    >
      <Lock className="h-3.5 w-3.5" /> Locked
    </button>
  );
}

// A row's cog: opens its own settings in a dialog, and is teal while any of them is set.
export function RowSettingsButton({
  tool,
  ctx,
  kind,
  name,
  onOpen,
}: {
  tool: Tool;
  ctx: ToolContext;
  kind: ToolTarget;
  name: string;
  onOpen: () => void;
}) {
  const { values } = useToolSettings(tool, ctx.machineId);
  const own = values.data?.targets?.[kind]?.[name] ?? {};
  const set = rowSettingsOf(tool, kind).filter((s) => own[s.id]);
  const locked = values.error instanceof ApiError && values.error.status === 423;
  return (
    <button
      type="button"
      aria-label={`Settings for ${name}`}
      aria-haspopup="dialog"
      title={set.length ? `Its own: ${set.map((s) => `${s.label} ${own[s.id]}`).join(", ")}` : "Its own settings, in place of the card's"}
      // Read with the key: while it is locked, your password first.
      onClick={async () => {
        if (!locked || (await requestUnlock())) onOpen();
      }}
      className={`flex items-center rounded-md border px-1.5 py-1 hover:bg-slate-800 ${
        set.length ? "border-teal-700 text-teal-300" : "border-slate-700 text-slate-400"
      }`}
    >
      <Settings className="h-3 w-3" />
    </button>
  );
}

const FIELD =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-teal-500 disabled:text-slate-500";

// A row's own settings, in a dialog: each field empty while the card's applies — its value
// shown greyed — and emptied to take it off again. Save writes the ones changed, each read
// back; Cancel leaves them as they were.
export function RowSettingsDialog({
  tool,
  ctx,
  kind,
  name,
  onClose,
}: {
  tool: Tool;
  ctx: ToolContext;
  kind: ToolTarget;
  name: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { key, url, values } = useToolSettings(tool, ctx.machineId);
  const settings = rowSettingsOf(tool, kind);
  const own = values.data?.targets?.[kind]?.[name] ?? {};
  // What is typed; until then, what the machine has.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const shown = draft ?? Object.fromEntries(settings.map((s) => [s.id, own[s.id] ?? ""]));
  const changed = settings.filter((s) => shown[s.id].trim() !== (own[s.id] ?? ""));
  // Only what you changed: one never set and left alone stays as it is.
  const empty = changed.find((s) => !s.unset && !shown[s.id].trim());
  const save = useMutation({
    mutationFn: async () => {
      for (const s of changed) {
        qc.setQueryData(key, await api.put<Values>(`${url}/${s.id}`, { value: shown[s.id].trim(), target: name }));
      }
    },
    onSuccess: onClose,
  });

  return (
    <Overlay onClose={onClose} label={`Settings for ${name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed.length && !empty) save.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-slate-100">
          Settings for <span className="font-mono">{name}</span>
        </h2>
        <p className="mt-1 text-sm text-slate-400">In place of the card's, for this {kind} only — empty, the card's applies.</p>
        <div className="mt-4 space-y-3">
          {settings.map((s, i) => (
            <label key={s.id} className="block">
              <span className="text-sm text-slate-200">{s.label}</span>
              <span className="mb-1.5 block text-xs text-slate-500">{s.description}</span>
              <input
                aria-label={s.label}
                autoFocus={i === 0}
                value={shown[s.id]}
                onChange={(e) => setDraft({ ...shown, [s.id]: e.target.value })}
                placeholder={(s.overrides ? values.data?.values[s.overrides] : null) ?? "not set"}
                disabled={!values.data || save.isPending}
                className={FIELD}
              />
            </label>
          ))}
        </div>
        {values.isLoading && <Loader2 className="mt-3 h-4 w-4 animate-spin text-slate-500" />}
        {(save.error || values.error) && (
          <p className="mt-3 text-sm text-rose-400">
            {save.error ? apiMessage(save.error, "Couldn't save it") : apiMessage(values.error, "Couldn't read them")}
          </p>
        )}
        {empty && <p className="mt-3 text-sm text-rose-400">{empty.label} needs a value.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!changed.length || Boolean(empty) || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </Overlay>
  );
}
