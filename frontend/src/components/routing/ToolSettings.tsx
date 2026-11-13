import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings } from "lucide-react";

import { api, ApiError, apiMessage } from "../../lib/api";
import { useUnlockFor } from "../../lib/settings";
import type { ToolContext } from "../../lib/toolRows";
import { rowSettingsOf, type Tool, type ToolTarget } from "../../lib/tools";
import { InlineText, SettingRow } from "../shared/SettingRow";
import { YourPassword } from "../shared/YourPassword";

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
// projects. A row's own settings are under its cog (`RowSettingsButton`).
export function ToolSettings({ tool, ctx }: { tool: Tool; ctx: ToolContext }) {
  const qc = useQueryClient();
  const { key, url, values } = useToolSettings(tool, ctx.machineId);
  const settings = (tool.settings ?? []).filter((s) => !s.target);
  const locked = values.error instanceof ApiError && values.error.status === 423;

  return (
    <div className="mt-1">
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
          ) : (
            <InlineText
              label={s.label}
              value={values.data?.values[s.id] ?? ""}
              placeholder={locked ? "locked" : "not set"}
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
      {locked ? (
        <Unlock onDone={() => qc.invalidateQueries({ queryKey: key })} />
      ) : (
        values.isError && (
          <p className="py-1 text-xs text-rose-400">
            {apiMessage(values.error, "Couldn't read them")}
          </p>
        )
      )}
    </div>
  );
}

// A row's cog: opens its own settings beneath it, and is teal while any of them is set.
export function RowSettingsButton({
  tool,
  ctx,
  kind,
  name,
  open,
  onToggle,
}: {
  tool: Tool;
  ctx: ToolContext;
  kind: ToolTarget;
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { values } = useToolSettings(tool, ctx.machineId);
  const own = values.data?.targets?.[kind]?.[name] ?? {};
  const set = rowSettingsOf(tool, kind).filter((s) => own[s.id]);
  return (
    <button
      type="button"
      aria-label={`${name}'s own settings`}
      aria-expanded={open}
      title={set.length ? `Its own: ${set.map((s) => `${s.label} ${own[s.id]}`).join(", ")}` : "Its own settings, in place of the card's"}
      onClick={onToggle}
      className={`flex items-center rounded-md border px-1.5 py-1 hover:bg-slate-800 ${
        set.length ? "border-teal-700 text-teal-300" : "border-slate-700 text-slate-400"
      }`}
    >
      <Settings className="h-3 w-3" />
    </button>
  );
}

// A row's own settings, beneath it: each empty while the card's applies — shown greyed —
// and emptied to take it off again.
export function RowSettings({ tool, ctx, kind, name }: { tool: Tool; ctx: ToolContext; kind: ToolTarget; name: string }) {
  const qc = useQueryClient();
  const { key, url, values } = useToolSettings(tool, ctx.machineId);
  const own = values.data?.targets?.[kind]?.[name] ?? {};
  return (
    <div className="mt-1 rounded-md border border-slate-800 px-2.5">
      {rowSettingsOf(tool, kind).map((s) => {
        const fallback = s.overrides ? values.data?.values[s.overrides] : null;
        return (
          <SettingRow key={s.id} label={s.label} description={s.description}>
            {values.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
            ) : (
              <InlineText
                label={`${s.label} for ${name}`}
                value={own[s.id] ?? ""}
                placeholder={fallback ?? "not set"}
                disabled={!values.data}
                validate={(v) => (v || s.unset ? null : "It needs a value.")}
                onSave={async (v) => {
                  const next = await api.put<Values>(`${url}/${s.id}`, { value: v, target: name });
                  qc.setQueryData(key, next);
                }}
              />
            )}
          </SettingRow>
        );
      })}
    </div>
  );
}

// The settings are read with Loskai's key: while it is locked, your password unlocks it here.
function Unlock({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const unlockFor = useUnlockFor();
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => api.post("/api/ssh/unlock", { password }),
    onSuccess: () => {
      setPassword("");
      qc.invalidateQueries({ queryKey: ["ssh"] });
      onDone();
    },
  });
  return (
    <form
      className="flex flex-wrap items-center justify-end gap-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        unlock.mutate();
      }}
    >
      <span className="mr-auto text-xs text-slate-500">Loskai's key is locked — your password unlocks it for {unlockFor}.</span>
      <YourPassword value={password} onChange={setPassword} className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-sm text-slate-100 outline-none focus:border-teal-500" />
      <button
        type="submit"
        disabled={!password || unlock.isPending}
        className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
      >
        {unlock.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Unlock
      </button>
      {unlock.isError && (
        <span className="w-full text-right text-xs text-rose-400">
          {apiMessage(unlock.error, "Couldn't unlock it")}
        </span>
      )}
    </form>
  );
}
