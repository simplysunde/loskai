import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { Modal } from "../shared/Modal";
import { TabButton } from "../shared/TabButton";
import { EditorFooter, SwitchView } from "./EditorFooter";
import { useSaveAndUp } from "./useSaveAndUp";
import { StackForm } from "./StackForm";

type FileKey = "compose" | "env" | "override";

// The names the API takes; the server maps them to whatever the stack's files are called.
const FILE_NAMES: Record<FileKey, string> = {
  compose: "compose.yml",
  env: ".env",
  override: "compose.override.yml",
};

const HINTS: Record<FileKey, string | null> = {
  compose: null,
  env: "Values compose.yml reads as ${KEY}.",
  override: "Merged over compose.yml — your own folders and changes. Updates never touch it.",
};

// Edit an existing stack — as a form by default, or its files as text — then re-up; or the
// raw create path (paste a finished compose + .env and `up`), which is text only, as there
// is no compose file yet for a form to read.
export function StackEditor({
  name,
  onClose,
}: {
  name: string | null; // null = create a new stack
  onClose: () => void;
}) {
  const [view, setView] = useState<"form" | "text">("form");
  const [carried, setCarried] = useState<Carried | null>(null);
  return (
    <Modal title={name === null ? "New stack" : `Edit ${name}`} onClose={onClose} wide>
      {name !== null && view === "form" ? (
        <StackForm
          name={name}
          base={carried}
          onClose={onClose}
          onTextView={(c) => {
            setCarried(c);
            setView("text");
          }}
        />
      ) : (
        <TextFiles
          name={name}
          carried={carried}
          onClose={onClose}
          onFormView={
            name === null
              ? undefined
              : (c) => {
                  setCarried(c);
                  setView("form");
                }
          }
        />
      )}
    </Modal>
  );
}

// The form's unsaved changes, as the files they would make — opened as unsaved edits.
export type Carried = { env: string; override: string };

// The stack's files, one tab each.
function TextFiles({
  name,
  carried,
  onClose,
  onFormView,
}: {
  name: string | null;
  carried: Carried | null;
  onClose: () => void;
  onFormView?: (carried: Carried | null) => void;
}) {
  const creating = name === null;
  const [stackName, setStackName] = useState("");
  const initial = { compose: creating ? "services:\n  app:\n    image: \n" : "", env: "", override: "" };
  const [files, setFiles] = useState<Record<FileKey, string>>(initial);
  const [saved, setSaved] = useState<Record<FileKey, string>>(initial);
  const [labels, setLabels] = useState<Record<FileKey, string>>(FILE_NAMES);
  const [service, setService] = useState("app");
  const [tab, setTab] = useState<FileKey>("compose");
  const [loading, setLoading] = useState(!creating);
  const [loadError, setLoadError] = useState<string | null>(null);
  const saving = useSaveAndUp(name, onClose);

  useEffect(() => {
    if (creating) return;
    api
      .get<{
        compose: string;
        compose_file: string;
        env: string;
        override: string | null;
        override_file: string | null;
        services: string[];
      }>(`/api/docker/stacks/${name}`)
      .then((s) => {
        const loaded = { compose: s.compose, env: s.env, override: s.override ?? "" };
        setFiles(carried ? { ...loaded, ...carried } : loaded);
        setSaved(loaded);
        setLabels({ ...FILE_NAMES, compose: s.compose_file, override: s.override_file ?? FILE_NAMES.override });
        if (s.services[0]) setService(s.services[0]);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [name, creating, carried]);

  const keys: FileKey[] = creating ? ["compose", "env"] : ["compose", "env", "override"];
  const dirty = (k: FileKey) => files[k] !== saved[k];
  const changed = keys.some(dirty);

  async function save() {
    let current: FileKey = "compose";
    const ok = await saving.run(
      async () => {
        if (creating) {
          await api.post("/api/docker/stacks", { name: stackName, compose: files.compose, env: files.env });
          return;
        }
        for (const k of keys.filter(dirty)) {
          current = k;
          await api.put(`/api/docker/stacks/${name}/file`, { file: FILE_NAMES[k], content: files[k] });
          setSaved((s) => ({ ...s, [k]: files[k] }));
        }
      },
      { action: creating ? null : changed ? "up" : "restart" },
    );
    if (!ok) setTab(current);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {creating && (
        <input
          value={stackName}
          onChange={(e) => setStackName(e.target.value)}
          placeholder="stack name"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
        />
      )}
      <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-slate-800 p-1">
        {keys.map((k) => (
          <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
            <span className="font-mono text-xs">{labels[k]}</span>
            {dirty(k) && <span className="ml-1.5 text-teal-400" title="Unsaved">•</span>}
          </TabButton>
        ))}
      </div>
      {HINTS[tab] && <p className="text-xs text-slate-500">{HINTS[tab]}</p>}
      <Editor
        key={tab}
        label={labels[tab]}
        value={files[tab]}
        onChange={(v) => setFiles((f) => ({ ...f, [tab]: v }))}
        placeholder={
          tab === "override" ? `services:\n  ${service}:\n    volumes:\n      - /host/folder:/folder/in/container\n` : undefined
        }
      />
      {loadError && <p className="text-sm text-rose-400">{loadError}</p>}
      <EditorFooter
        left={
          onFormView && (
            <SwitchView
              to="Edit as form"
              // The form doesn't edit compose.yml, so an unsaved change to it would be lost.
              blocked={dirty("compose") ? `${labels.compose} isn't in the form — save it first` : null}
              onClick={() =>
                onFormView(dirty("env") || dirty("override") ? { env: files.env, override: files.override } : null)
              }
            />
          )
        }
        error={saving.error}
        output={saving.output}
        busy={saving.busy}
        disabled={creating && !stackName}
        label={creating ? "Create + up" : changed ? "Save" : "Restart"}
        title={creating ? undefined : changed ? "Save, then re-up the stack" : "Nothing to save — restart the stack"}
        onCancel={onClose}
        onSave={save}
      />
    </div>
  );
}

// A plain textarea with what YAML needs from an editor: line numbers (errors name a line),
// Tab inserting spaces (YAML refuses tabs), and Enter keeping the line's indent, one level
// deeper after a `key:`. Shift+Tab still moves focus out, so the keyboard isn't trapped.
function Editor({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const lines = (value || placeholder || "").split("\n").length;

  useLayoutEffect(() => {
    if (caret.current !== null && area.current) {
      area.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    let insert: string;
    if (e.key === "Tab" && !e.shiftKey) {
      insert = "  ";
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const line = value.slice(value.lastIndexOf("\n", start - 1) + 1, start);
      const indent = /^ */.exec(line)![0] + (line.trimEnd().endsWith(":") ? "  " : "");
      if (!indent) return;
      insert = "\n" + indent;
    } else {
      return;
    }
    e.preventDefault();
    caret.current = start + insert.length;
    onChange(value.slice(0, start) + insert + value.slice(end));
  }

  return (
    <div className="flex h-80 overflow-hidden rounded-lg border border-slate-700 bg-slate-950 focus-within:border-teal-500">
      <div
        ref={gutter}
        aria-hidden
        className="select-none overflow-hidden border-r border-slate-800 py-2 pb-6 pl-3 pr-2 text-right font-mono text-xs leading-5 text-slate-600"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={area}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        placeholder={placeholder}
        wrap="off"
        spellCheck={false}
        className="flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none placeholder:text-slate-600"
      />
    </div>
  );
}
