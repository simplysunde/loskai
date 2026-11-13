import { ExternalLink, Boxes } from "lucide-react";

export interface DashboardCard {
  id: string;
  name: string;
  url: string | null;
  // Path to the uploaded image, or null for the generic glyph. A desktop launcher reading
  // /api/launcher uses the same field to fetch a shortcut icon.
  icon: string | null;
}

// One launcher card on the public Dashboard. Links out to the routed service; disabled
// when no FQDN can be assembled yet (base_domain unset).
export function ServiceCard({ card }: { card: DashboardCard }) {
  const body = (
    <>
      {card.icon ? (
        <img
          src={card.icon}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
          // A missing or broken file must not leave a torn card — fall back to the glyph.
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.nextElementSibling?.classList.remove("hidden");
          }}
        />
      ) : null}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300 ${
          card.icon ? "hidden" : ""
        }`}
      >
        <Boxes className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-100">{card.name}</div>
        {card.url && (
          <div className="truncate text-xs text-slate-500">
            {card.url.replace(/^https?:\/\//, "")}
          </div>
        )}
      </div>
      {card.url && <ExternalLink className="h-4 w-4 text-slate-500" />}
    </>
  );

  const base =
    "flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition";

  return card.url ? (
    <a
      href={card.url}
      target="_blank"
      rel="noreferrer"
      className={`${base} hover:border-teal-600/50 hover:bg-slate-900`}
    >
      {body}
    </a>
  ) : (
    <div className={`${base} opacity-60`} title="Set base_domain to enable the link">
      {body}
    </div>
  );
}
