import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

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
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

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

  return (
    <div className="space-y-5">
      {form.settings.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-slate-400">Settings</h3>
          {form.settings.map((s) => (
            <label key={s.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm text-slate-300">
                {s.label ?? <span className="font-mono text-xs">{s.key}</span>}
                {s.label && <span className="block font-mono text-[11px] text-slate-600">{s.key}</span>}
              </span>
              <input
                value={values[s.key] ?? ""}
                onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                placeholder={s.default ?? undefined}
                aria-label={s.label ?? s.key}
                className={INPUT}
              />
            </label>
          ))}
          <p className="text-xs text-slate-500">Empty uses the default shown.</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-slate-400">Folders</h3>
        {folders.map((f, i) => (
          <div key={i}>
            <div className="flex items-center gap-2">
              {form.services.length > 1 && (
                <select
                  value={f.service}
                  onChange={(e) => setFolder(i, { service: e.target.value })}
                  aria-label={`Folder ${i + 1} service`}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100"
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
                className={`${INPUT} min-w-0 flex-[3]`}
              />
              <span className="text-slate-500">→</span>
              <input
                value={f.target}
                onChange={(e) => setFolder(i, { target: e.target.value })}
                placeholder="/media/films"
                aria-label={`Folder ${i + 1} in the container`}
                className={`${INPUT} min-w-0 flex-[2]`}
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={f.writable}
                  onChange={(e) => setFolder(i, { writable: e.target.checked })}
                  className="h-4 w-4 accent-teal-500"
                />
                Writable
              </label>
              <button
                onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                aria-label="Remove folder"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {problems[i] && <span className="mt-1 block text-xs text-rose-400">{problems[i]}</span>}
          </div>
        ))}
        <button
          onClick={() =>
            setFolders([...folders, { service: form.services[0] ?? "", source: "", target: "", writable: true }])
          }
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add folder
        </button>
        {form.override_other && (
          <p className="text-xs text-slate-500">compose.override.yml also sets other things — kept as they are.</p>
        )}
        {foldersChanged && form.override_comments && (
          <p className="text-xs text-amber-300">Saving rewrites compose.override.yml without its comments.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium text-slate-400">
          App{" "}
          <span className="font-normal text-slate-500">
            {form.from_recipe ? `— from the ${form.from_recipe} recipe, updated by Check for updates` : "— compose.yml"}
          </span>
        </h3>
        {form.app.map((a) => (
          <div key={a.service} className="rounded-lg border border-slate-800 px-3 py-2 text-xs">
            <p className="text-sm text-slate-200">
              {a.service} <span className="ml-2 font-mono text-xs text-slate-400">{a.image ?? "no image"}</span>
            </p>
            <dl className="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 font-mono text-slate-400">
              {a.network && <Row term="Network" items={[a.network]} />}
              {a.ports.length > 0 && <Row term="Ports" items={a.ports} />}
              {a.volumes.length > 0 && <Row term="Data" items={a.volumes} />}
            </dl>
          </div>
        ))}
      </section>

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

function Row({ term, items }: { term: string; items: string[] }) {
  return (
    <>
      <dt className="font-sans text-slate-500">{term}</dt>
      <dd>{items.join(" · ")}</dd>
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
