import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { apiMessage } from "./api";

// A text field that saves itself: on blur or Enter, only when it changed. Escape puts it
// back and saves nothing — remembered in a ref, because blur() fires onBlur before the
// draft put back has rendered. A value changed elsewhere (a refetch after another field's
// save) shows, unless you are typing. The layout is the caller's.
export function useAutoSave(
  value: string,
  save: (next: string) => Promise<unknown>,
  { trim = false, validate, failed = "Couldn't save it" }: {
    trim?: boolean;
    validate?: (next: string) => string | null;
    failed?: string;
  } = {},
) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const escaped = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  // Also for a select, whose pick is the edit.
  const run = async (next: string) => {
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setState("saving");
    try {
      await save(next);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setState("idle");
      setError(apiMessage(err, failed));
    }
  };

  const commit = () => {
    focused.current = false;
    const next = trim ? draft.trim() : draft;
    if (escaped.current || next === value) {
      escaped.current = false;
      setDraft(value);
      setError(null);
      return;
    }
    void run(next);
  };

  const inputProps = {
    value: draft,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        if (draft !== value) e.preventDefault(); // puts it back, and the dialog stays
        escaped.current = true;
        e.currentTarget.blur();
      }
    },
  };

  return { state, error, inputProps, run, setDraft };
}
