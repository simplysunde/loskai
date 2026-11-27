import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Search } from "lucide-react";

// A dialog's sections, one after another in a single scroll, and a side menu: a search that
// narrows both, a mark that follows the scroll, and opening at a section once they are drawn.
export interface PaneSection {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  // The menu draws a line where the group changes.
  group: number;
  // What the search finds it by besides its label.
  words: string;
  // On the right of its heading.
  action?: ReactNode;
  // Or, given what is searched for — "" for nothing, or for a section found by its label —
  // its content narrowed to what matches (Projects: the projects found).
  content: ReactNode | ((query: string) => ReactNode);
}

export function SectionPane({
  sections,
  start,
  ready,
  top,
  pinned,
  across = false,
}: {
  sections: PaneSection[];
  // The section to open at (from the URL), once `ready` — or the first, when there is no such one.
  start?: string;
  ready: boolean;
  // Above the sections, in the scroll.
  top?: ReactNode;
  // Under `top`, kept in view as the sections scroll under it — one heading for them all.
  pinned?: ReactNode;
  // The menu a strip across the top at every width, as on a phone — for content that
  // wants the room (Projects' rows of buttons).
  across?: boolean;
}) {
  const [query, setQuery] = useState("");
  // The section the menu marks: the one scrolled to, or the one just picked.
  const [active, setActive] = useState<string>(() =>
    start && sections.some((s) => s.id === start) ? start : (sections[0]?.id ?? ""),
  );
  const pane = useRef<HTMLDivElement>(null);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  // While a pick scrolls the pane, the scroll doesn't move the mark.
  const picking = useRef(0);
  const opened = useRef(false);

  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    const first = sections[0]?.id;
    if (start && anchors.current[start] && start !== first) pick(start, "auto");
    else if (start && first) pick(first, "auto");
  });

  function pick(id: string, behavior: ScrollBehavior = "smooth") {
    setActive(id);
    picking.current = Date.now() + 800;
    anchors.current[id]?.scrollIntoView?.({ behavior, block: "start" });
  }

  // The mark follows the scroll: the last section whose top has passed the pane's top, or
  // the last one once the pane is scrolled to its end.
  function onScroll() {
    const el = pane.current;
    if (!el || Date.now() < picking.current) return;
    const ids = Object.keys(anchors.current).filter((k) => anchors.current[k]);
    const top = el.getBoundingClientRect().top + 24;
    let at = ids[0];
    for (const k of ids) if (anchors.current[k]!.getBoundingClientRect().top <= top) at = k;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) at = ids[ids.length - 1];
    if (at) setActive(at);
  }

  const q = query.trim().toLowerCase();
  const shown = sections.filter((s) => !q || `${s.label} ${s.words}`.toLowerCase().includes(q));

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${across ? "" : "sm:flex-row"}`}>
      {/* A strip across the top on a phone, a column with the search beside the content wider
          up — or, `across`, the strip everywhere, its search first in it from a wider screen. */}
      <nav
        aria-label="Categories"
        className={`flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 p-2 ${
          across ? "items-center" : "sm:block sm:w-52 sm:space-y-0.5 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3"
        }`}
      >
        <label
          className={`hidden items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 sm:flex ${
            across ? "mr-1 w-40 shrink-0" : "mb-2"
          }`}
        >
          <Search className="h-3.5 w-3.5 text-slate-500" />
          <input
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
          />
        </label>
        {shown.map((s, i) => (
          <div key={s.id} className="shrink-0">
            {!across && i > 0 && shown[i - 1].group !== s.group && (
              <div className="mx-2 my-2 hidden border-t border-slate-800 sm:block" />
            )}
            <button
              onClick={() => pick(s.id)}
              aria-current={s.id === active ? "location" : undefined}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition sm:gap-3 ${
                s.id === active
                  ? "bg-teal-500/10 text-teal-200"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              <s.icon className="h-4 w-4" />
              {s.label}
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="px-3 py-2 text-xs text-slate-500">Nothing matches.</p>}
      </nav>
      <div ref={pane} onScroll={onScroll} className={`min-w-0 flex-1 overflow-auto ${across ? "px-4 pb-4" : "px-5 pb-5"}`}>
        {top}
        {pinned && <div className="sticky top-0 z-10 bg-slate-900 pt-3">{pinned}</div>}
        {/* The last section is at least the pane's height, so a pick can scroll any
            section to the top — even while the ones below are still loading. */}
        {shown.map((s) => (
          <section
            key={s.id}
            aria-label={s.label}
            ref={(el) => {
              anchors.current[s.id] = el;
            }}
            className={`border-b border-slate-800 last-of-type:min-h-full last-of-type:border-b-0 ${across ? "py-3" : "py-4"}`}
          >
            <div className={`flex items-center justify-between gap-4 ${across ? "mb-1.5" : "mb-2"}`}>
              <h2 className="text-sm font-semibold text-slate-100">{s.label}</h2>
              {s.action}
            </div>
            {typeof s.content === "function" ? s.content(s.label.toLowerCase().includes(q) ? "" : q) : s.content}
          </section>
        ))}
      </div>
    </div>
  );
}
