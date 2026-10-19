import { Fragment, useEffect, useState } from "react";
import { Loader2, Lock, Plus, X } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { pathProblem } from "../../lib/validation";
import { EditorFooter, SwitchView } from "./EditorFooter";
import { useSaveAndUp } from "./useSaveAndUp";

export type Folder = { service: string; source: string; target: string; writable: boolean };

export type StackFormData = {
  settings: { key: string; label: string | null; value: string; default: string | null }[];
  folders: Folder[];
  override_other: boolean;
  override_comments: boolean;
  services: string[];
  app: { service: string; image: string | null; network: string | null; ports: string[]; volumes: string[] }[];
  from_recipe: string | null;
};

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-teal-500";

// A stack's files as fields: Settings are the .env, Folders the override's bind mounts, and
// the app is compose.yml as values — read-only, as it is the recipe's. Saving sends only
// what changed; the server keeps everything the form doesn't show.
export function StackForm({
  name,
  onClose,
  onTextView,
}: {
  name: string;
  onClose: () => void;
  onTextView: () => void;
}) {
  const [form, setForm] = useState<StackFormData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const saving = useSaveAndUp(name, onClose);

  useEffect(() => {
    api
      .get<StackFormData>(`/api/docker/stacks/${name}/form`)
      .then((f) => {
        setForm(f);
        setValues(Object.fromEntries(f.settings.map((s) => [s.key, s.value])));
        setFolders(f.folders);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [name]);

  if (!form) {
    // A file the form can't read (YAML that won't load) still opens as text.
    return error ? (
      <div className="space-y-3">
        <p className="text-sm text-rose-400">{error}</p>
        <SwitchView to="Edit as text" onClick={onTextView} dirty={false} />
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
  const foldersChanged = JSON.stringify(folders) !== JSON.stringify(form.folders);
  const dirty = Object.keys(changed).length > 0 || foldersChanged;
  const problems = folders.map((f) => folderProblem(f, folders));
  const setFolder = (i: number, patch: Partial<Folder>) =>
    setFolders(folders.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  // Phone width: the host folder gets its own line, the rest of the row beneath it.
  const grid =
    form.services.length > 1
      ? "grid-cols-[1fr_auto_auto] sm:grid-cols-[auto_3fr_auto_2fr_auto_auto]"
      : "grid-cols-[1fr_auto_auto] sm:grid-cols-[3fr_auto_2fr_auto_auto]";

  return (
    <div className="space-y-5">
      <Section
        title="App"
        aside={
          <span
            title={`${form.from_recipe ? `From the ${form.from_recipe} recipe — Check for updates replaces it.` : "compose.yml."} Change it under Edit as text.`}
            className="flex items-center gap-1 normal-case tracking-normal"
          >
            <Lock className="h-3 w-3" /> {form.from_recipe ? `${form.from_recipe} recipe` : "compose.yml"}
          </span>
        }
      >
        {form.app.map((a) => (
          <div key={a.service} className="rounded-lg border border-slate-800 px-3 py-2">
            <p className="flex items-baseline gap-2">
              <span className="text-sm text-slate-200">{a.service}</span>
              <span className="truncate font-mono text-xs text-slate-400">{a.image ?? "no image"}</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs">
              {a.network && <Fact term="Network" items={[a.network]} />}
              {a.ports.length > 0 && <Fact term="Ports" items={a.ports} />}
              {a.volumes.length > 0 && <Fact term="Data" items={a.volumes} />}
            </div>
          </div>
        ))}
      </Section>

      {form.settings.length > 0 && (
        <Section title="Settings">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {form.settings.map((s) => (
              <label key={s.key} className="block min-w-0">
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
          </div>
        </Section>
      )}

      <Section title="Folders">
        {folders.length > 0 && (
          <div className={`grid ${grid} items-center gap-x-2 gap-y-2`}>
            {form.services.length > 1 && <span className="text-xs text-slate-500 max-sm:hidden">Service</span>}
            <span className="text-xs text-slate-500 max-sm:hidden">On the Docker host</span>
            <span className="max-sm:hidden" />
            <span className="text-xs text-slate-500 max-sm:hidden">In the container</span>
            <span className="text-xs text-slate-500 max-sm:hidden" title="Off mounts it read-only">
              Writable
            </span>
            <span className="max-sm:hidden" />
            {folders.map((f, i) => (
              <Fragment key={i}>
                {form.services.length > 1 && (
                  <select
                    value={f.service}
                    onChange={(e) => setFolder(i, { service: e.target.value })}
                    aria-label={`Folder ${i + 1} service`}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 max-sm:col-span-full"
                  >
                    {form.services.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                )}
                <input
                  value={f.source}
                  onChange={(e) => setFolder(i, { source: e.target.value })}
                  placeholder="/srv/media/films"
                  aria-label={`Folder ${i + 1} on the host`}
                  title={f.source}
                  className={`${INPUT} min-w-0 font-mono text-xs max-sm:col-span-full max-sm:mt-2`}
                />
                <span className="text-slate-500 max-sm:hidden">→</span>
                <input
                  value={f.target}
                  onChange={(e) => setFolder(i, { target: e.target.value })}
                  placeholder="/media/films"
                  aria-label={`Folder ${i + 1} in the container`}
                  className={`${INPUT} min-w-0 font-mono text-xs`}
                />
                <input
                  type="checkbox"
                  checked={f.writable}
                  onChange={(e) => setFolder(i, { writable: e.target.checked })}
                  aria-label={`Folder ${i + 1} writable`}
                  title="Writable"
                  className="h-4 w-4 justify-self-center accent-teal-500"
                />
                <button
                  onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                  aria-label="Remove folder"
                  title="Remove"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                >
                  <X className="h-4 w-4" />
                </button>
                {problems[i] && <span className="col-span-full -mt-1 text-xs text-rose-400">{problems[i]}</span>}
              </Fragment>
            ))}
          </div>
        )}
        <button
          onClick={() =>
            setFolders([...folders, { service: form.services[0] ?? "", source: "", target: "", writable: true }])
          }
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add folder
        </button>
        {form.override_other && (
          <p className="text-xs text-slate-500">The override's other settings are kept — see Edit as text.</p>
        )}
        {foldersChanged && form.override_comments && (
          <p className="text-xs text-amber-300">Saving rewrites compose.override.yml without its comments.</p>
        )}
      </Section>

      <EditorFooter
        left={<SwitchView to="Edit as text" onClick={onTextView} dirty={dirty} />}
        error={saving.error}
        output={saving.output}
        busy={saving.busy}
        disabled={!dirty || problems.some(Boolean)}
        label="Save + re-up"
        onCancel={onClose}
        onSave={() =>
          saving.run(async () => {
            await api.put(`/api/docker/stacks/${name}/form`, {
              settings: changed,
              folders: foldersChanged ? folders : undefined,
            });
          })
        }
      />
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

function Fact({ term, items }: { term: string; items: string[] }) {
  return (
    <span className="flex gap-2">
      <span className="text-slate-500">{term}</span>
      <span className="font-mono text-slate-400">{items.join(" · ")}</span>
    </span>
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
