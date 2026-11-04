import { InlineSettingsFields } from "../../components/shared/InlineSettingsFields";
import { SESSION_IDLE_CHOICES, type FieldDef } from "../../lib/settings";

const SESSION_FIELDS: FieldDef[] = [
  { key: "session_idle_minutes", label: "Sign out this long after the last page closes", options: SESSION_IDLE_CHOICES },
];

// Sessions, for everyone. Your own password is changed from the menu on your name in the sidebar;
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
          from the menu on your name at the bottom of the sidebar; an admin sets anyone's under Users.
        </p>
      </section>
    </div>
  );
}
