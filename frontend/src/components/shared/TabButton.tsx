import type { ReactNode } from "react";

// One of a row of tabs, in a `role="tablist"` strip styled
// `flex w-fit gap-1 rounded-lg border border-slate-800 p-1`.
export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm ${
        active ? "bg-teal-500/15 text-teal-200" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
