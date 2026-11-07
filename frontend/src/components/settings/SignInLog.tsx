import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "../../lib/api";
import { CARD_TABLE } from "../../lib/ui";

interface SignIn {
  at: string;
  user: string; // the username tried — it may be no account's
  from: string | null;
  ok: boolean;
  for?: string; // a password asked again for an action (the SSH unlock), not at login
}

// Every sign-in and wrong password — at login, or asked again for an action — newest first.
// Never the password; a login turned away during a wait isn't one.
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
        <table className={`w-full text-left text-xs ${CARD_TABLE}`}>
          <thead className="text-slate-500 max-sm:hidden">
            <tr>
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">Who</th>
              <th className="py-1 pr-3 font-medium">From</th>
              <th className="py-1 font-medium">What</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {log.data.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="border-t border-slate-800/70 max-sm:py-1.5">
                <td className="whitespace-nowrap py-1 pr-3 text-slate-400">
                  {new Date(e.at).toLocaleString()}
                </td>
                <td className="py-1 pr-3 text-slate-400">{e.user}</td>
                <td className="py-1 pr-3 font-mono text-slate-400">{e.from ?? "—"}</td>
                <td className={`py-1 max-sm:basis-full ${e.ok ? "" : "text-amber-300"}`}>{e.ok ? "Signed in" : e.for ? `Wrong password (${e.for})` : "Wrong password"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
