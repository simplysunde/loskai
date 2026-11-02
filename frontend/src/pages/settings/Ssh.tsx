import { Download } from "lucide-react";

import { SshKeySection } from "../../components/settings/SshKeySection";
import { InlineSettingsFields } from "../../components/shared/InlineSettingsFields";
import { SSH_UNLOCK_CHOICES, type FieldDef } from "../../lib/settings";
import { SshLog } from "../../components/settings/SshLog";

const UNLOCK_FIELDS: FieldDef[] = [
  { key: "ssh_unlock_minutes", label: "Keep the key unlocked for", options: SSH_UNLOCK_CHOICES },
];

// SSH as a whole — what is the same for every machine. One machine's own SSH is behind the
// cog on its row on the Machines tab.
export function Ssh() {
  return (
    <div className="max-w-xl space-y-6">
      <SshKeySection />

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-200">Unlock</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          How long typing the admin password lets Loskai reach your machines — terminals, tools,
          installs. Logging out locks it sooner; a change applies from the next unlock.
        </p>
        <InlineSettingsFields fields={UNLOCK_FIELDS} />
      </section>

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-200">SSH config</h2>
        <p className="mt-1 text-xs text-slate-500">
          Your machines as Loskai reaches them, for your own computer: use it with{" "}
          <span className="font-mono text-slate-300">ssh -F</span>, or add an Include to{" "}
          <span className="font-mono text-slate-300">~/.ssh/config</span>.
        </p>
        {/* A plain download: the file names no key, so your own ssh uses your own keys. */}
        <a
          href="/api/ssh/config"
          download="loskai-ssh-config"
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Download
        </a>
      </section>

      <section className="border-t border-slate-800 pt-6">
        <h2 className="text-sm font-medium text-slate-200">Log</h2>
        <p className="mt-1 mb-3 text-xs text-slate-500">
          Terminals opened, closed or refused, and keys installed — not what was typed.
        </p>
        <SshLog />
      </section>
    </div>
  );
}
