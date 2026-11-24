import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

// A table row's icon action. `busy` spins it and holds it until its request is done; `count`,
// when above 0, is a small number in its corner — out of its name, which stays `title`.
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
  count = 0,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  tone?: keyof typeof TONE;
  busy?: boolean;
  count?: number;
}) {
  return (
    <button title={title} onClick={onClick} disabled={busy} className={`${SHAPE} ${TONE[tone]} ${count > 0 ? "relative" : ""}`}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
      {count > 0 && (
        <span aria-hidden="true" className="absolute -right-1 -bottom-1 min-w-3 rounded-full bg-slate-700 px-0.5 text-center text-[9px] leading-3 text-slate-200">
          {count}
        </span>
      )}
    </button>
  );
}
