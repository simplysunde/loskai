import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { apiMessage } from "../../lib/api";
import { isValidSshLogin } from "../../lib/validation";
import { Modal } from "../shared/Modal";

// Turning SSH on: the login, and what comes next. Saving puts it in the SSH config, and the
// setup — trust its host key, then Loskai's key onto it — opens straight after, as when a
// user is typed in.
export function EnableSshModal({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (login: { user: string; port: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const save = useMutation({ mutationFn: () => onSave({ user, port: Number(port) }) });
  const ok = isValidSshLogin(user, port);
  return (
    <Modal title={`Turn on SSH for ${name}`} onClose={onClose} narrow>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-xs text-slate-500">
          Loskai logs in with its own key, as the user you give it — a <span className="font-mono">loskai</span>{" "}
          user with sudo is a good choice. Next you trust the machine's host key, then either type
          the machine's password once and Loskai puts its key there, or add the key yourself.
        </p>
        <div className="flex gap-2">
          <input aria-label="SSH user" placeholder="User" value={user} autoFocus
            onChange={(e) => setUser(e.target.value.trim())} className={`${FIELD} flex-1`} />
          <input aria-label="SSH port" inputMode="numeric" value={port}
            onChange={(e) => setPort(e.target.value.trim())} className={`${FIELD} w-20`} />
        </div>
        {user && !ok && (
          <p className="text-xs text-rose-400">A login name (letters, digits, _ . -) and a port from 1 to 65535.</p>
        )}
        {save.isError && (
          <p className="text-xs text-rose-400">{apiMessage(save.error, "Couldn't turn it on")}</p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={!ok || save.isPending}
            className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Turn on
          </button>
        </div>
      </form>
    </Modal>
  );
}

const FIELD =
  "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-500";
