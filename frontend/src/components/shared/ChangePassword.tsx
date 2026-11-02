import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { Modal } from "./Modal";

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";

// Your own password, from your name in the sidebar — every account has one, so it isn't in
// Settings, which is an admin's. Your other sessions end; this one stays signed in.
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useMutation({
    mutationFn: () => api.post("/api/auth/password", { current, new: next }),
  });
  const mismatch = confirm !== "" && next !== confirm;

  return (
    <Modal title="Change your password" onClose={onClose} narrow>
      {change.isSuccess ? (
        <p className="flex items-center gap-2 text-sm text-emerald-300">
          <Check className="h-4 w-4" /> Changed. Your other devices are signed out.
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <input type="password" aria-label="Current password" placeholder="Current password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)} className={INPUT} autoFocus />
          <input type="password" aria-label="New password" placeholder="New password — at least 8 characters" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)} className={INPUT} />
          <input type="password" aria-label="New password again" placeholder="New password again" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT} />
          {mismatch && <p className="text-xs text-rose-400">The new passwords don't match.</p>}
          {change.isError && (
            <p className="text-xs text-rose-400">{change.error instanceof ApiError ? change.error.message : "Couldn't change it"}</p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!current || !next || next !== confirm || change.isPending}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {change.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Change password
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
