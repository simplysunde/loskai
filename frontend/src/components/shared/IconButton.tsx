import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

// A table row's icon action. `busy` spins it and holds it until its request is done.
const SHAPE = "inline-flex items-center rounded-lg border border-slate-700 px-2 py-1 text-xs disabled:opacity-40";
export const ICON_BUTTON = `${SHAPE} text-slate-300 hover:bg-slate-800`;
const TONE = {
  plain: "text-slate-300 hover:bg-slate-800",
  danger: "text-rose-300 hover:bg-rose-500/10",
  warn: "text-amber-300 hover:bg-amber-500/10",
};

export function IconButton({
  title,
  onClick,
  children,
  tone = "plain",
  busy = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  tone?: keyof typeof TONE;
  busy?: boolean;
}) {
  return (
    <button title={title} onClick={onClick} disabled={busy} className={`${SHAPE} ${TONE[tone]}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}
