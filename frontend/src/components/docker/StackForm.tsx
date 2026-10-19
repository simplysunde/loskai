import { useEffect, useState } from "react";
import { CornerDownRight, Database, Folder as FolderIcon, Loader2, Lock, Plus, X } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { pathProblem } from "../../lib/validation";
import { EditorFooter, SwitchView } from "./EditorFooter";
import type { Carried } from "./StackEditor";
import { useSaveAndUp } from "./useSaveAndUp";

export type Folder = { service: string; source: string; target: string; writable: boolean };

export type StackFormData = {
  settings: { key: string; label: string | null; value: string; default: string | null }[];
  folders: Folder[];
  override_other: boolean;
  override_comments: boolean;
  services: string[];
  app: { service: string; image: string | null; network: string | null; ports: string[]; volumes: string[] }[];
  recipe: { id: string; name: string; icon: boolean } | null;
};

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-teal-500";

// A stack's files as fields: Settings are the .env, Folders the override's bind mounts, and
// the app is compose.yml as values — read-only, as it is the recipe's. Saving sends only
// what changed; the server keeps everything the form doesn't show.
export function StackForm({
  name,
  base,
  onClose,
  onTextView,
}: {
  name: string;
  base: Carried | null; // the text view's unsaved .env and override, read as the form
  onClose: () => void;
  onTextView: (carried: Carried | null) => void;
}) {
  const [form, setForm] = useState<StackFormData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const saving = useSaveAndUp(name, onClose);

  useEffect(() => {
    const path = `/api/docker/stacks/${name}/form`;
    (base ? api.post<StackFormData>(path, base) : api.get<StackFormData>(path))
      .then((f) => {
        setForm(f);
        setValues(Object.fromEntries(f.settings.map((s) => [s.key, s.value])));
        setFolders(f.folders);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [name, base]);

  if (!form) {
    // A file the form can't read (YAML that won't load) still opens as text — with what was
    // typed there, when that is what didn't load.
    return error ? (
      <div className="space-y-3">
        <p className="text-sm text-rose-400">{error}</p>
        <SwitchView to="Edit as text" onClick={() => onTextView(base)} />
      </div>
    ) : (
      <div className="flex justify-center py-10 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const changed = Object.fromEntries(
    form.settings.filter((s) => values[s.key] !== s.value).map((s) => [s.key, values[s.key]]),
  );
  // A row with nothing typed in it is not a change — the server skips it too.
  const filled = folders.filter((f) => f.source.trim() || f.target.trim());
  const foldersChanged = JSON.stringify(filled) !== JSON.stringify(form.folders);
  // Text carried over from the text view is unsaved too: the form saves on top of it.
  const dirty = base !== null || Object.keys(changed).length > 0 || foldersChanged;
  const payload = { settings: changed, folders: foldersChanged ? filled : undefined, base: base ?? undefined };
  const problems = folders.map((f) => folderProblem(f, folders));
  const setFolder = (i: number, patch: Partial<Folder>) =>
    setFolders(folders.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="space-y-4">
      <AppHeader form={form} stack={name} />

      <div className={`grid gap-4 ${form.settings.length > 0 ? "md:grid-cols-[2fr_3fr]" : ""}`}>
        {form.settings.length > 0 && (
          <Panel title="Settings">
            {form.settings.map((s) => (
              <label key={s.key} className="block">
                <span className="mb-1 block text-xs text-slate-400" title={s.key}>
                  {s.label ?? <span className="font-mono">{s.key}</span>}
                </span>
                <input
                  value={values[s.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                  placeholder={s.default ?? undefined}
                  title={s.default ? `Empty uses the default, ${s.default}` : undefined}
                  aria-label={s.label ?? s.key}
                  className={INPUT}
                />
              </label>
            ))}
          </Panel>
        )}

        <Panel
          title="Folders"
          aside={
            <button
              onClick={() =>
                setFolders([...folders, { service: form.services[0] ?? "", source: "", target: "", writable: true }])
              }
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 normal-case tracking-normal text-teal-300 hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add folder
            </button>
          }
        >
          {folders.length === 0 && <p className="text-xs text-slate-500">No folders mounted.</p>}
          {folders.map((f, i) => (
            <div key={i} className="space-y-1.5 border-t border-slate-800/70 pt-3 first:border-t-0 first:pt-0">
              {form.services.length > 1 && (
                <select
                  value={f.service}
                  onChange={(e) => setFolder(i, { service: e.target.value })}
                  aria-label={`Folder ${i + 1} service`}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                >
                  {form.services.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
              <input
                value={f.source}
                onChange={(e) => setFolder(i, { source: e.target.value })}
                placeholder="/srv/media/films — on the Docker host"
                aria-label={`Folder ${i + 1} on the host`}
                title={f.source}
                className={`${INPUT} font-mono text-xs`}
              />
              <div className="flex items-center gap-2">
                <CornerDownRight className="ml-2 h-4 w-4 shrink-0 text-slate-600" />
                <input
                  value={f.target}
                  onChange={(e) => setFolder(i, { target: e.target.value })}
                  placeholder="/media/films — in the container"
                  aria-label={`Folder ${i + 1} in the container`}
                  className={`${INPUT} min-w-0 font-mono text-xs`}
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400" title="Off mounts it read-only">
                  <input
                    type="checkbox"
                    checked={f.writable}
                    onChange={(e) => setFolder(i, { writable: e.target.checked })}
                    aria-label={`Folder ${i + 1} writable`}
                    className="h-4 w-4 accent-teal-500"
                  />
                  Writable
                </label>
                <button
                  onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                  aria-label="Remove folder"
                  title="Remove"
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {problems[i] && <p className="text-xs text-rose-400">{problems[i]}</p>}
            </div>
          ))}
          {form.override_other && (
            <p className="text-xs text-slate-500">The override's other settings are kept — see Edit as text.</p>
          )}
          {foldersChanged && form.override_comments && (
            <p className="text-xs text-amber-300">Saving rewrites compose.override.yml without its comments.</p>
          )}
        </Panel>
      </div>

      <EditorFooter
        left={
          <SwitchView
            to="Edit as text"
            blocked={problems.some(Boolean) ? "Fix the folder first" : null}
            onClick={async () => {
              if (!dirty) return onTextView(null);
              try {
                onTextView(await api.put<Carried>(`/api/docker/stacks/${name}/form`, { ...payload, preview: true }));
              } catch (e) {
                setSwitchError(e instanceof ApiError ? e.message : "Couldn't carry the changes over");
              }
            }}
          />
        }
        error={switchError ?? saving.error}
        output={saving.output}
        busy={saving.busy}
        disabled={problems.some(Boolean)}
        label={dirty ? "Save" : "Restart"}
        title={dirty ? "Save, then re-up the stack" : "Nothing to save — restart the stack"}
        onCancel={onClose}
        onSave={() =>
          dirty
            ? saving.run(async () => {
                await api.put(`/api/docker/stacks/${name}/form`, payload);
              })
            : saving.run(async () => {}, { action: "restart" })
        }
      />
    </div>
  );
}

// What the stack runs, from compose.yml — shown, not edited: it is the recipe's, and Check
// for updates replaces it.
function AppHeader({ form, stack }: { form: StackFormData; stack: string }) {
  const name = form.recipe?.name ?? stack;
  return (
    <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      {form.recipe?.icon ? (
        <img
          src={`/api/docker/recipes/${encodeURIComponent(form.recipe.id)}/icon`}
          alt=""
          className="h-11 w-11 shrink-0 rounded-lg bg-slate-800/60 object-contain p-1.5"
        />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-base font-semibold text-teal-300">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-semibold text-slate-100">{name}</p>
          <span
            title={`${form.recipe ? `From the ${form.recipe.name} recipe — Check for updates replaces it.` : "From compose.yml."} Change it under Edit as text.`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400"
          >
            <Lock className="h-3 w-3" /> {form.recipe ? "Recipe" : "compose.yml"}
          </span>
        </div>
        {form.app.map((a) => (
          <div key={a.service} className="min-w-0">
            <p className="truncate font-mono text-xs text-slate-300">
              {form.app.length > 1 && <span className="mr-2 font-sans text-slate-400">{a.service}</span>}
              {a.image ?? "no image"}
            </p>
            {(a.network || a.ports.length > 0 || a.volumes.length > 0) && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1.5 text-xs">
                {a.network && <Fact term="Network" items={[a.network]} />}
                {a.ports.length > 0 && <Fact term="Ports" items={a.ports} />}
                {a.volumes.length > 0 && <Fact term="Data" items={a.volumes} data />}
              </dl>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40">
      <h3 className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {title}
        {aside}
      </h3>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

// One line of what the app runs: each mapping a chip — host side first, then where it lands
// inside — and for data, whether it is a folder or a Docker volume.
function Fact({ term, items, data = false }: { term: string; items: string[]; data?: boolean }) {
  return (
    <>
      <dt className="pt-0.5 text-slate-500">{term}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1.5">
        {items.map((item) => {
          const [host, inside] = item.split(" → ");
          const readOnly = inside?.endsWith(" (read-only)");
          const folder = /^[./~]/.test(host);
          const Icon = folder ? FolderIcon : Database;
          return (
            <span
              key={item}
              title={data ? (folder ? "A folder beside the stack or on the host" : "A Docker volume") : undefined}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-800/70 px-2 py-0.5 font-mono"
            >
              {data && <Icon className="h-3 w-3 shrink-0 text-slate-500" />}
              <span className="truncate text-slate-200">{host}</span>
              {inside !== undefined && (
                <>
                  <span className="text-slate-600">→</span>
                  <span className="truncate text-slate-400">{inside.replace(" (read-only)", "")}</span>
                </>
              )}
              {readOnly && <span className="font-sans text-[10px] uppercase text-amber-300/80">ro</span>}
            </span>
          );
        })}
      </dd>
    </>
  );
}

// The checks the server makes, shown as you type. A row with nothing in it yet is fine
// until saved; the server refuses it then.
function folderProblem(f: Folder, all: Folder[]): string | null {
  if (!f.source.trim() && !f.target.trim()) return null;
  if (!f.source.trim()) return "Which folder on the Docker host?";
  const problem = pathProblem(f.source);
  if (problem) return problem;
  if (!f.target.trim().startsWith("/")) return "The path inside the container starts with /, like /media/films.";
  if (all.some((o) => o !== f && o.service === f.service && o.target.trim() === f.target.trim()))
    return `Two folders land at ${f.target.trim()}.`;
  return null;
}
