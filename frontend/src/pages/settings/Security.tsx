import { InlineSettingsFields } from "../../components/shared/InlineSettingsFields";
import type { FieldDef } from "../../lib/settings";

// How long a session lasts once no Loskai page is open — the same choices the backend allows
// (shared/settings.SESSION_IDLE_CHOICES); the first listed is the default.
const SESSION_FIELDS: FieldDef[] = [
  {
    key: "session_idle_minutes",
    label: "Sign out this long after the last page closes",
    options: [
      { value: "120", label: "2 hours" },
      { value: "30", label: "30 minutes" },
      { value: "60", label: "1 hour" },
      { value: "480", label: "8 hours" },
      { value: "1440", label: "24 hours" },
      { value: "10080", label: "7 days" },
    ],
  },
];

// Sessions, for everyone. Your own password is changed in Your account (your name in the sidebar);
// other accounts are under Users.
export function Security() {
  return (
    <div className="max-w-xl space-y-6">
      <section>
        <h2 className="text-sm font-medium text-slate-200">Sessions</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          An open Loskai page keeps you signed in, even in a background tab — like Proxmox. Logging
          out ends your sessions on every device.
        </p>
        <InlineSettingsFields fields={SESSION_FIELDS} />
      </section>

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-200">Passwords</h2>
        <p className="mt-1 text-xs text-slate-500">
          Each account's password is stored hashed (argon2) and never returned. Change your own
          in Your account — your name at the bottom of the sidebar; an admin sets anyone's under Users.
        </p>
      </section>
    </div>
  );
}
