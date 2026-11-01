import { KeyRound } from "lucide-react";

import { SshKeySection } from "../../components/settings/SshKeySection";

// Reserved category. The admin password is set once — from LOSKAI_PASSWORD or at first run —
// and stored only as a hash; there is no change-password endpoint yet (auth.py has setup +
// login only), so there is nothing to edit here until POST /api/auth/change-password lands.
export function Security() {
  return (
    <div className="max-w-xl space-y-6">
      <section>
        <h2 className="text-sm font-medium text-slate-200">Admin password</h2>
        <p className="mt-1 text-xs text-slate-500">
          Loskai uses a single admin password — no accounts. It is stored hashed and never
          returned by the API.
        </p>

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Changing it isn't supported yet
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            <span className="font-mono text-slate-300">LOSKAI_PASSWORD</span> only seeds the
            password on a first run — setting it later has no effect. To rotate it today,
            remove the{" "}
            <span className="font-mono text-slate-300">admin_password_hash</span> key from{" "}
            <span className="font-mono text-slate-300">settings.json</span> in the Loskai
            volume and restart; the next start re-seeds from the environment, or prompts you to
            set a new one. An in-app change form arrives with a dedicated endpoint.
          </p>
        </div>
      </section>

      <SshKeySection />
    </div>
  );
}
