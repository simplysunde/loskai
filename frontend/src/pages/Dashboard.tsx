import { Loader2 } from "lucide-react";

import { useDashboard } from "../lib/useDashboard";
import { ServiceCard } from "../components/shared/ServiceCard";

// The public launcher — the one unauthenticated view. Shows non-private routed
// services only; no container detail or module state.
export function Dashboard() {
  const { data, isLoading } = useDashboard();

  const services = data?.services ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your homelab services, one click away.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">
          No services published yet. Add a route or a link on the Routing tab to see it here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((card) => (
            <ServiceCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
