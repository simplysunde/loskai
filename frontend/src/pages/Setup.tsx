import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api, apiMessage } from "../lib/api";
import { docUrl } from "../lib/docs";
import { HOME, type SetupFields, type SetupKey } from "../lib/useAuth";
import { hostFromAddress } from "../lib/setup";
import { INPUT } from "../lib/ui";
import { AuthField, AuthShell } from "../components/shared/AuthShell";
import { Hint } from "../components/shared/Hint";

interface FieldDef {
  key: SetupKey;
  label: string;
  hint: string;
  placeholder?: string;
}

// The two things Loskai can't find from inside its container.
const NETWORK: FieldDef[] = [
  {
    key: "base_domain",
    label: "Base Domain",
    hint: "What your machines' and services' names end in — nas.home.lan, jellyfin.home.lan. It only has to exist on your network: no need to own it.",
    placeholder: "home.lan",
  },
  {
    key: "host_ip",
    label: "Docker Host LAN IP",
    hint: "The address of the machine Loskai runs on, which it can't see from inside its container. Filled in from the address you opened this page on.",
    placeholder: "192.168.10.50",
  },
];

const NAMES: FieldDef[] = [
  {
    key: "caddy_admin_url",
    label: "Caddy admin URL",
    hint: "Where Caddy's admin API answers. Loskai adds each name's route there.",
    placeholder: "http://…:2019",
  },
  {
    key: "adguard_url",
    label: "AdGuard URL",
    hint: "Where AdGuard Home answers. Loskai adds each name's DNS entry there.",
    placeholder: "http://…:3000",
  },
  { key: "adguard_user", label: "AdGuard username", hint: "The account you log in to AdGuard Home with." },
  { key: "adguard_password", label: "AdGuard password", hint: "Kept on this machine, in Loskai's settings file." },
];

const NAME_KEYS = NAMES.map((def) => def.key);

// Set by the compose file or `.env` (or stored already): shown, not asked.
const isSet = (fields: SetupFields, key: SetupKey) => Boolean(fields[key] && fields[key].source !== "unset");

function firstAnswers(fields: SetupFields): Record<SetupKey, string> {
  return {
    base_domain: isSet(fields, "base_domain") ? "" : "home.lan",
    host_ip: isSet(fields, "host_ip") ? "" : hostFromAddress(window.location.hostname),
    caddy_admin_url: "",
    adguard_url: "",
    adguard_user: "",
    adguard_password: "",
  };
}

// First run, before any account exists: the admin account, and what Loskai needs to know
// about the network. A value the compose file or `.env` already set is shown, not asked
// (`fields`, from GET /api/auth/status). One request makes the account and stores the rest.
export function Setup({ fields }: { fields: SetupFields }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [answers, setAnswers] = useState(() => firstAnswers(fields));
  // Loskai runs without Caddy and AdGuard, a service being a link to its address: their
  // fields show for whoever asks — or whose compose file already answered.
  const namesSet = NAME_KEYS.some((key) => isSet(fields, key));
  const [wantNames, setWantNames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const asked = (key: SetupKey) => !isSet(fields, key) && (namesSet || wantNames || !NAME_KEYS.includes(key));
      const settings = Object.fromEntries(Object.entries(answers).filter(([key]) => asked(key as SetupKey)));
      await api.post("/api/auth/setup", { username, password, settings });
      await qc.invalidateQueries({ queryKey: ["auth-status"] });
      // Routing: where Caddy and AdGuard say whether they are online.
      navigate(HOME, { replace: true });
    } catch (err) {
      setError(apiMessage(err, "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  const field = (def: FieldDef) => (
    <SetupField
      key={def.key}
      def={def}
      set={isSet(fields, def.key) ? fields[def.key] : undefined}
      value={answers[def.key]}
      onChange={(v) => setAnswers((a) => ({ ...a, [def.key]: v }))}
    />
  );

  return (
    <AuthShell wide title="Welcome to Loskai" lead="An account, and your network. Then you're in.">
      <form onSubmit={submit} className="space-y-6">
        <Section title="Your account">
          <AuthField label="Username" value={username} onChange={setUsername} autoFocus autoComplete="username" />
          <AuthField label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <AuthField label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Section>

        <Section title="Your network">{NETWORK.map(field)}</Section>

        {namesSet ? (
          <Section title="Secure HTTPS connections">{NAMES.map(field)}</Section>
        ) : (
          <section className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={wantNames}
                onChange={(e) => setWantNames(e.target.checked)}
                className="accent-teal-500"
              />
              I want secure HTTPS connections
            </label>
            {wantNames && (
              <>
                <p className="text-xs text-slate-500">
                  Each service gets a name, like https://jellyfin.{answers.base_domain || "home.lan"}. That takes
                  Caddy and AdGuard Home on your network: the{" "}
                  <a
                    href={docUrl("docs/guides/install.md")}
                    target="_blank"
                    rel="noreferrer"
                    className="text-teal-400 hover:underline"
                  >
                    install guide
                  </a>{" "}
                  sets them up.
                </p>
                {NAMES.map(field)}
              </>
            )}
          </section>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !username || !password || !confirm}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Start using Loskai
        </button>
        <p className="text-center text-xs text-slate-500">Everything here can be changed later, in Settings.</p>
      </form>
    </AuthShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// One field: asked, or — set already by the compose file or `.env` — shown as Settings
// shows it, locked. A secret set there shows only that it is.
function SetupField({
  def,
  set,
  value,
  onChange,
}: {
  def: FieldDef;
  set?: { value: string | null; source: string; secret: boolean };
  value: string;
  onChange: (v: string) => void;
}) {
  const secret = def.key === "adguard_password";
  return (
    // A <div>: a label would name the hint's button instead of the field.
    <div>
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-400">
        <Hint text={def.hint}>{def.label}</Hint>
        {set && (
          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            <Lock className="h-3 w-3" /> {set.source === "env" ? "env" : "set"}
          </span>
        )}
      </span>
      <input
        aria-label={def.label}
        type={secret ? "password" : "text"}
        value={set ? (set.value ?? "") : value}
        placeholder={set ? "set" : def.placeholder}
        disabled={Boolean(set)}
        autoComplete={secret ? "new-password" : "off"}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-60`}
      />
    </div>
  );
}
