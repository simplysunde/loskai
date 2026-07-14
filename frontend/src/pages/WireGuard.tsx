import { useHealth } from "../lib/useHealth";
import { WireGuardCard } from "../components/wireguard/WireGuardCard";

// The "VPN" sidebar tab — a standalone reachability card, not part of the instance model.
export function WireGuard() {
  const health = useHealth();
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">VPN</h1>
        <p className="mt-1 text-sm text-slate-500">
          WireGuard status and remote-access reminders. Peer management lives in
          wg-dashboard.
        </p>
      </header>
      <WireGuardCard health={health.data?.wireguard} />
    </div>
  );
}
