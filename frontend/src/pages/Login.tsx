import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, Loader2 } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { api, apiMessage } from "../lib/api";
import { homeFor, useAuthStatus, type Me } from "../lib/useAuth";
import { INPUT } from "../lib/ui";

// The security screen: log in with a username and password, or — on first run, before any
// account exists (GET /api/auth/status -> needs_setup) — create the admin account.
export function Login() {
  const { data, isLoading } = useAuthStatus();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const from = (location.state as { from?: string } | null)?.from;
  const redirectTo = from ?? homeFor(data?.user ?? null);

  if (isLoading) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
      </Shell>
    );
  }
  if (data?.authed) return <Navigate to={redirectTo} replace />;

  const firstRun = Boolean(data?.needs_setup);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (firstRun && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const done = await api.post<{ user: Me }>(firstRun ? "/api/auth/setup" : "/api/login", { username, password });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
      // Where they came from, else the first tab this account has.
      navigate(from ?? homeFor(done.user), { replace: true });
    } catch (err) {
      setError(apiMessage(err, "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/15 text-teal-300">
          <Anchor className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold text-slate-100">
          {firstRun ? "Create the admin account" : "Loskai"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {firstRun
            ? "First run — the account that runs Loskai. More can be added in Settings › Users."
            : "Safe passage for your Docker deployments."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Field label="Username" value={username} onChange={setUsername} autoFocus autoComplete="username" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={firstRun ? "new-password" : "current-password"}
        />
        {firstRun && (
          <Field
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        )}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {firstRun ? "Create account" : "Log in"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  autoFocus,
  autoComplete,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </label>
  );
}
