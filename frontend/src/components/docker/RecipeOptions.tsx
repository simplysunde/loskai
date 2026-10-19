export type RecipeOption = { id: string; label: string; help: string | null };

// A recipe's options — features you switch on, like a GPU for transcoding. On adds the
// option's lines to the stack's compose.override.yml, off removes them. Off by default:
// a device the host doesn't have stops the container from starting.
export function OptionList({
  options,
  on,
  onChange,
}: {
  options: RecipeOption[];
  on: Record<string, boolean>;
  onChange: (id: string, value: boolean) => void;
}) {
  return (
    <div className="space-y-2.5">
      {options.map((o) => (
        <label key={o.id} className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={on[o.id] ?? false}
            onChange={(e) => onChange(o.id, e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-teal-500"
          />
          <span className="min-w-0">
            <span className="block text-sm text-slate-200">{o.label}</span>
            {o.help && <span className="block text-xs text-slate-500">{o.help}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
