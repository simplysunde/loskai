import { useHintBox } from "../../lib/useHintBox";

// A word with more to say: underlined with dots, its text in a hint's box.
// Never inside a <label>: a label names the first button in it, so the field beside it would
// lose its name — and the hint its own. `className` adds to the word's own classes —
// `min-w-0 truncate` for an address that may be cut off.
export function Hint({
  text,
  children,
  className = "",
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { trigger, box } = useHintBox(text);
  return (
    <>
      <button
        {...trigger}
        type="button"
        data-hint
        // A button resets text-transform; the word keeps its heading's (uppercase).
        className={`cursor-help underline decoration-slate-500 decoration-dotted underline-offset-4 [text-transform:inherit] hover:decoration-slate-300 ${className}`}
      >
        {children}
      </button>
      {box}
    </>
  );
}

// A button that is off for a reason nobody can see: `aria-disabled` rather than `disabled`,
// which would swallow the hover and the tap too, and its reason in a hint's box instead of
// its action. Without a reason it is a plain button. Style it with `aria-disabled:` beside
// `disabled:`.
export function ReasonButton({
  reason,
  onClick,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { reason?: string | null }) {
  const { trigger, box } = useHintBox(reason ?? "");
  if (!reason) {
    return (
      <button type="button" onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <>
      <button type="button" {...rest} {...trigger} title={undefined} aria-disabled="true">
        {children}
      </button>
      {box}
    </>
  );
}
