import { Loader2, Plus, X } from "lucide-react";

import { pathWhere, paths, type Recipe } from "../../lib/recipes";
import { pathProblem } from "../../lib/validation";
import { OptionList } from "./RecipeOptions";
import { INPUT } from "../../lib/ui";

// The install wizard's Configure step: the recipe's questions, the folders to mount and the
// options, each checked as it is typed, as the server checks it again on Deploy.

export function FillStep({
  recipe,
  answers,
  setAnswers,
  folders,
  setFolders,
  chosen,
  setChosen,
  pending,
  error,
  onBack,
  onInstall,
}: {
  recipe: Recipe;
  answers: Record<string, string>;
  setAnswers: (a: Record<string, string>) => void;
  folders: string[];
  setFolders: (f: string[]) => void;
  chosen: Record<string, boolean>;
  setChosen: (c: Record<string, boolean>) => void;
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onInstall: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Creates a stack, writes a generated <code className="text-slate-300">.env</code>, and runs{" "}
        <code className="text-slate-300">{recipe.type}</code>.
      </p>
      {recipe.env.map((e) => (
        <label key={e.key} className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">{e.label}</span>
          <input
            type={e.secret ? "password" : "text"}
            value={answers[e.key] ?? ""}
            onChange={(ev) => setAnswers({ ...answers, [e.key]: ev.target.value })}
            placeholder={e.type === "path" ? "./data or /srv/media" : undefined}
            className={INPUT}
          />
          {e.type === "path" && <PathNote value={answers[e.key] ?? ""} recipeId={recipe.id} />}
        </label>
      ))}
      {recipe.mounts && (
        <FolderRows spec={recipe.mounts} folders={folders} setFolders={setFolders} />
      )}
      {recipe.options && recipe.options.length > 0 && (
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-400">Options</span>
          <OptionList
            options={recipe.options}
            on={chosen}
            onChange={(id, value) => setChosen({ ...chosen, [id]: value })}
          />
        </div>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Back
        </button>
        <button
          onClick={onInstall}
          disabled={
            pending ||
            paths(recipe).some((e) => !pathOk(answers[e.key] ?? "")) ||
            (recipe.mounts != null && folderProblems(folders).some(Boolean))
          }
          className="flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Deploy
        </button>
      </div>
    </div>
  );
}

const pathOk = (value: string) => value.trim() !== "" && pathProblem(value) === null;

function PathNote({ value, recipeId }: { value: string; recipeId: string }) {
  const problem = value.trim() ? pathProblem(value) : "Required — the folder to mount.";
  return (
    <span className={`mt-1 block text-xs ${problem ? "text-rose-400" : "text-slate-500"}`}>
      {problem ?? pathWhere(value, recipeId).long}
    </span>
  );
}

// Where each added folder lands, or why it can't: the same checks as a path field, plus
// the two a folder list adds — a folder with no name of its own (`/`), and two folders
// that would land at one place. A blank row is skipped, not an error.
function folderProblems(folders: string[]): (string | null)[] {
  const names = folders.map((f) => f.trim().replace(/\/+$/, "").split("/").pop() ?? "");
  return folders.map((f, i) => {
    if (!f.trim()) return null;
    const problem = pathProblem(f);
    if (problem) return problem;
    if (["", ".", ".."].includes(names[i])) return `'${f.trim()}' has no folder name to mount it under.`;
    const other = names.findIndex((n, j) => j !== i && n === names[i] && folders[j].trim());
    if (other !== -1) return `Lands at the same place as '${folders[other].trim()}' — rename one, or mount their parent.`;
    return null;
  });
}

function FolderRows({
  spec,
  folders,
  setFolders,
}: {
  spec: NonNullable<Recipe["mounts"]>;
  folders: string[];
  setFolders: (f: string[]) => void;
}) {
  const problems = folderProblems(folders);
  const base = spec.target.replace(/\/+$/, "");
  const set = (i: number, value: string) => setFolders(folders.map((f, j) => (j === i ? value : f)));
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-slate-400">{spec.label}</span>
      <div className="space-y-2">
        {folders.map((f, i) => (
          <div key={i}>
            <div className="flex gap-2">
              <input
                aria-label={`${spec.label} ${i + 1}`}
                value={f}
                onChange={(ev) => set(i, ev.target.value)}
                placeholder="/srv/media/movies"
                className={INPUT}
              />
              <button
                onClick={() => setFolders(folders.filter((_, j) => j !== i))}
                aria-label="Remove folder"
                className="rounded-lg px-2 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {f.trim() && (
              <span className={`mt-1 block text-xs ${problems[i] ? "text-rose-400" : "text-slate-500"}`}>
                {problems[i] ??
                  `→ ${base}/${f.trim().replace(/\/+$/, "").split("/").pop()}${spec.read_only ? ", read-only" : ""}`}
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() => setFolders([...folders, ""])}
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
      >
        <Plus className="h-3.5 w-3.5" /> Add folder
      </button>
      <span className="mt-1 block text-xs text-slate-500">
        A folder that doesn't exist on the Docker host fails the deploy — it is never created empty.
      </span>
    </div>
  );
}
