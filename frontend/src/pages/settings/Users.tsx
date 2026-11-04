import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { useMe, type Tab } from "../../lib/useAuth";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog";
import { Modal } from "../../components/shared/Modal";

interface Account {
  username: string;
  role: "admin" | "operator";
  tabs: Tab[];
  created: number;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "docker", label: "Docker" },
  { id: "routing", label: "Routing" },
  { id: "machines", label: "Machines" },
];

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";
const BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800";

// The accounts (admin only — the API says so too). An admin does everything; an operator
// only the tabs it is given, and routes need Routing even from Docker or Machines.
export function Users() {
  const qc = useQueryClient();
  const { me } = useMe();
  const accounts = useQuery({ queryKey: ["users"], queryFn: () => api.get<Account[]>("/api/users") });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);
  // Your own role among them: the sidebar's, from auth-status, follows.
  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["users"] }), qc.invalidateQueries({ queryKey: ["auth-status"] })]);
  const remove = useMutation({
    mutationFn: (name: string) => api.del(`/api/users/${name}`),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-slate-500">
          An <span className="text-slate-300">admin</span> can do everything, Settings and users
          included. An <span className="text-slate-300">operator</span> sees only the tabs it is
          given, and can do everything in those. Each signs in with their own password, and types
          it again to unlock Loskai's SSH key for a while.
        </p>
        <button onClick={() => setAdding(true)} className={`${BUTTON} shrink-0 text-slate-200`}>
          <Plus className="h-3.5 w-3.5" /> Add user
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Tabs</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {(accounts.data ?? []).map((a) => (
              <tr key={a.username} className="border-t border-slate-800">
                <td className="px-4 py-2 text-slate-200">
                  {a.username}
                  {a.username === me?.username && <span className="ml-1.5 text-xs text-slate-500">(you)</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{a.role}</td>
                <td className="px-4 py-2 text-xs text-slate-400">
                  {a.role === "admin" ? "all" : a.tabs.map((t) => TABS.find((x) => x.id === t)?.label).join(", ")}
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1.5">
                    <button title="Role and tabs" aria-label={`Edit ${a.username}`} onClick={() => setEditing(a)} className={BUTTON}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button title="Set a new password" aria-label={`New password for ${a.username}`} onClick={() => setResetting(a)} className={BUTTON}>
                      <KeyRound className="h-3.5 w-3.5" />
                    </button>
                    <button title="Remove" aria-label={`Remove ${a.username}`} onClick={() => setRemoving(a)} className={`${BUTTON} text-rose-300`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AccountForm onClose={() => setAdding(false)} onSaved={refresh} />}
      {editing && <AccountForm account={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {resetting && <NewPassword account={resetting} onClose={() => setResetting(null)} />}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.username}?`}
        destructive
        confirmLabel="Remove"
        onCancel={() => {
          setRemoving(null);
          remove.reset();
        }}
        onConfirm={() => removing && remove.mutate(removing.username)}
      >
        Their sessions end now, and they can no longer sign in.
        {remove.isError && (
          <span className="mt-2 block text-rose-400">
            {remove.error instanceof ApiError ? remove.error.message : "Couldn't remove it"}
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}

// Adding an account (no `account`), or changing one's role and tabs.
function AccountForm({ account, onClose, onSaved }: { account?: Account; onClose: () => void; onSaved: () => void }) {
  const [username, setUsername] = useState(account?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Account["role"]>(account?.role ?? "operator");
  const [tabs, setTabs] = useState<Tab[]>(account?.role === "operator" ? account.tabs : []);
  const save = useMutation({
    mutationFn: () =>
      account
        ? api.patch(`/api/users/${account.username}`, { role, tabs })
        : api.post("/api/users", { username, password, role, tabs }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const ready = (account || (username && password)) && (role === "admin" || tabs.length > 0);

  return (
    <Modal title={account ? `${account.username} — role and tabs` : "Add user"} onClose={onClose} narrow>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!account && (
          <>
            <input aria-label="Username" placeholder="Username — lowercase" value={username} autoFocus
              onChange={(e) => setUsername(e.target.value.toLowerCase())} className={INPUT} />
            <input aria-label="Password" type="password" autoComplete="new-password" placeholder="Password — at least 8 characters"
              value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
          </>
        )}
        <div className="flex gap-2">
          {(["operator", "admin"] as const).map((r) => (
            <label key={r} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              role === r ? "border-teal-500/60 bg-teal-500/10 text-teal-200" : "border-slate-700 text-slate-300"}`}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="accent-teal-500" />
              {r === "admin" ? "Admin" : "Operator"}
            </label>
          ))}
        </div>
        {role === "operator" ? (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs text-slate-500">The tabs it may use — and everything in them</legend>
            {TABS.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={tabs.includes(t.id)}
                  onChange={(e) => setTabs(e.target.checked ? [...tabs, t.id] : tabs.filter((x) => x !== t.id))}
                  className="accent-teal-500"
                />
                {t.label}
              </label>
            ))}
            <p className="text-xs text-slate-500">Routes need Routing, even from Docker's installer or a machine's row.</p>
          </fieldset>
        ) : (
          <p className="text-xs text-slate-500">Everything, Settings and users included.</p>
        )}
        {save.isError && (
          <p className="text-xs text-rose-400">{save.error instanceof ApiError ? save.error.message : "Couldn't save it"}</p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={!ready || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {account ? "Save" : "Add user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// An admin setting someone's password: their sessions end.
function NewPassword({ account, onClose }: { account: Account; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch(`/api/users/${account.username}`, { password }),
    onSuccess: onClose,
  });
  return (
    <Modal title={`New password for ${account.username}`} onClose={onClose} narrow>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <input aria-label="New password" type="password" autoComplete="new-password" autoFocus
          placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        <p className="text-xs text-slate-500">Their sessions end.</p>
        {save.isError && (
          <p className="text-xs text-rose-400">{save.error instanceof ApiError ? save.error.message : "Couldn't set it"}</p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={password.length < 8 || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Set password
          </button>
        </div>
      </form>
    </Modal>
  );
}
