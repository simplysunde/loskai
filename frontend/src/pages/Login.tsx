import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, Loader2 } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useAuthStatus } from "../lib/useAuth";

// The security screen: single-password login, or first-run "set admin password" when
// no password is configured yet (GET /api/auth/status -> password_set: false).
export function Login() {
  const { data, isLoading } = useAuthStatus();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/routing";

  if (isLoading) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
      </Shell>
    );
  }
  if (data?.authed) return <Navigate to={redirectTo} replace />;

  const firstRun = !data?.password_set;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (firstRun && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(firstRun ? "/api/auth/setup" : "/api/login", { password });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
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
          {firstRun ? "Set your admin password" : "Loskai"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {firstRun
            ? "First run — create the password that guards the admin tier."
            : "Safe passage for your Docker deployments."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        {firstRun && (
          <Field
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
          />
        )}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {firstRun ? "Create password" : "Log in"}
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
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500"
      />
    </label>
  );
}
