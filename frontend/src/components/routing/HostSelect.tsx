import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { HostOption } from "./hostOptions";

// The host half of an upstream: a text field you can type any address into, with a list of
// known hosts that typing filters by name or address. Picking reports the option — a named
// machine links the route to it; typing reports null, so a typed address links nothing.
export function HostSelect({
  value,
  options,
  onType,
  onPick,
  placeholder,
  readOnly = false,
  className,
}: {
  value: string;
  options: HostOption[];
  onType: (value: string) => void;
  onPick: (option: HostOption) => void;
  placeholder?: string;
  readOnly?: boolean;
  className: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // Opened from the chevron: the whole list. Opened by typing: what matches.
  const [showAll, setShowAll] = useState(false);
  // Nothing is highlighted until an arrow key says so: Enter must never swap a typed
  // address for whichever option it happens to prefix (192.168.10.5 → .50).
  const [active, setActive] = useState(-1);

  const query = value.trim().toLowerCase();
  const shown = showAll || !query
    ? options
    : options.filter(
        (o) => o.label.toLowerCase().includes(query) || o.address.toLowerCase().includes(query),
      );
  const expanded = open && !readOnly && shown.length > 0;

  const pick = (option: HostOption) => {
    onPick(option);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label="Host or machine"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => {
          onType(e.target.value);
          setShowAll(false);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setShowAll(true);
              setOpen(true);
            }
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (shown.length ? (i + step + shown.length) % shown.length : -1));
          } else if (e.key === "Enter" && expanded && active >= 0) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={`${className} pr-8`}
      />
      {!readOnly && options.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show hosts"
          // mousedown, not click: the input keeps focus, so its blur doesn't close the list
          onMouseDown={(e) => {
            e.preventDefault();
            setShowAll(true);
            setOpen((o) => !o);
          }}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-slate-500 hover:text-slate-300"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto overscroll-contain rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
        >
          {shown.map((o, i) => (
            <li
              key={`${o.label}|${o.address}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              <span className="truncate">{o.label}</span>
              <span className="shrink-0 font-mono text-xs text-slate-500">{o.address}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
