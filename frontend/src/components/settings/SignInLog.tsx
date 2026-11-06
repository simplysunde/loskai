import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "../../lib/api";

interface SignIn {
  at: string;
  user: string; // the username tried — it may be no account's
  from: string | null;
  ok: boolean;
}

// Every sign-in and wrong password, newest first. Never the password; a login turned away
// during a wait isn't one.
export function SignInLog() {
  const log = useQuery({
    queryKey: ["sign-in-log"],
    queryFn: () => api.get<SignIn[]>("/api/auth/logins"),
  });

  return (
    <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800 px-3 py-2">
      {log.isLoading ? (
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
      ) : !log.data?.length ? (
        <p className="text-sm text-slate-500">Nothing yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">Who</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 font-medium">What</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {log.data.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-t border-slate-800/70">
                <td className="whitespace-nowrap py-1 pr-3 text-slate-400">
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="py-1 pr-3 text-slate-400">{e.user}</td>
                <td className="py-1 pr-3 font-mono text-slate-400">{e.from ?? "—"}</td>
                <td className={`py-1 ${e.ok ? "" : "text-amber-300"}`}>{e.ok ? "Signed in" : "Wrong password"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
