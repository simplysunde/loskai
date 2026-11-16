import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { api, apiMessage } from "../lib/api";
import { HOME, useAuthStatus } from "../lib/useAuth";
import { AuthField, AuthShell } from "../components/shared/AuthShell";

const TITLE = "Loskai";
const LEAD = "Safe passage for your Docker deployments.";

// The security screen: log in with a username and password. Before any account exists the
// app shows first-run setup instead (`Setup`, from `App`), so this never has to make one.
export function Login() {
  const { data, isLoading } = useAuthStatus();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const from = (location.state as { from?: string } | null)?.from;

  if (isLoading) {
    return (
      <AuthShell title={TITLE} lead={LEAD}>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500" />
      </AuthShell>
    );
  }
  if (data?.authed) return <Navigate to={from ?? HOME} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/login", { username, password });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
      // Where they came from, else Routing, which every level has.
      navigate(from ?? HOME, { replace: true });
    } catch (err) {
      setError(apiMessage(err, "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title={TITLE} lead={LEAD}>
      <form onSubmit={submit} className="space-y-3">
        <AuthField label="Username" value={username} onChange={setUsername} autoFocus autoComplete="username" />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Log in
        </button>
      </form>
    </AuthShell>
  );
}
