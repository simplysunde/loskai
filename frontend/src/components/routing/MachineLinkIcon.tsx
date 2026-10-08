import { Link2, WandSparkles } from "lucide-react";

// How a route belongs to a machine. A link (set in the form) follows the machine when it
// moves; a match is only worked out from a shared address, so the route keeps its old
// address and the match simply ends.
export function MachineLinkIcon({ auto }: { auto: boolean }) {
  const label = auto
    ? "Matched by IP — not linked"
    : "Linked — follows the machine when its address changes";
  const Icon = auto ? WandSparkles : Link2;
  return (
    <span role="img" title={label} aria-label={label} className="inline-flex cursor-help">
      <Icon className={`h-3 w-3 ${auto ? "text-slate-500" : "text-teal-400"}`} />
    </span>
  );
}
