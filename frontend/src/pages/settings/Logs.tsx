import { SignInLog } from "../../components/settings/SignInLog";
import { SshLog } from "../../components/settings/SshLog";

// Every log, in one place — an admin's, as the API says (shared/access.py).
export function Logs() {
  return (
    <div className="max-w-3xl space-y-6">
      <section>
        <h2 className="text-sm font-medium text-slate-200">Sign-ins</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          Each sign-in and wrong password, by the username typed — never the password.
        </p>
        <SignInLog />
      </section>

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-200">SSH</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          Terminals opened, closed or refused, runs, and keys installed — not what was typed.
        </p>
        <SshLog />
      </section>
    </div>
  );
}
