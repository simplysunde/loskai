import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Loader2,
  ShieldCheck,
} from "lucide-react";

import { api, ApiError } from "../lib/api";
import { CopyButton } from "../components/shared/CopyButton";
import { saveFile } from "../lib/download";

interface RootCert {
  pem: string;
  common_name: string;
  filename: string;
}

type Platform = "windows" | "macos" | "linux" | "android";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "android", label: "Android" },
];

// Preselect a tab from the user agent. Only a guess — every tab stays one click away,
// which is the whole reason this is a tab strip rather than a detect-only display: a phone
// browsing to a desktop's instructions had no way back.
function detectPlatform(): Platform {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android"; // before Linux: Android's user agent names both
  if (/Mac OS X|Macintosh|iPhone|iPad/i.test(ua)) return "macos";
  return "linux";
}

// The public certificate page: hand out Caddy's internal root and walk one device
// through trusting it. Caddy's :80 page (caddy/setup/index.html) mirrors this one, steps and
// wording alike — change one, change the other. Public like the Dashboard, and reachable over plain HTTP by IP —
// a device that doesn't trust the internal CA yet can't be asked to use the HTTPS route
// to fix exactly that.
export function Certificate() {
  const [platform, setPlatform] = useState<Platform>(detectPlatform);

  const cert = useQuery({
    queryKey: ["root-certificate"],
    queryFn: () => api.get<RootCert>("/api/caddy/root-certificate"),
    retry: false, // 409 (no internal CA) is an answer, not a blip — don't hammer Caddy
  });

  // The API hands back the PEM as JSON and the browser saves it (`saveFile`): a direct link
  // to Caddy's own :80 file would be a plain-HTTP download from an HTTPS page.
  const download = () => {
    if (cert.data) saveFile(cert.data.filename, cert.data.pem, "application/x-x509-ca-cert");
  };

  const status = cert.error instanceof ApiError ? cert.error.status : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Certificate</h1>
        <p className="mt-1 text-sm text-slate-500">
          Install this once per device and every internal site is trusted — including
          ones added later.
        </p>
      </header>

      <Step n={1} title="Download the certificate">
        {cert.isLoading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Asking Caddy for its root…
          </div>
        )}

        {status === 409 && (
          <Notice tone="ok" icon={<ShieldCheck className="h-4 w-4" />}>
            Nothing to install. This deployment doesn't use an internal certificate
            authority, so its certificates are already trusted by every browser.
          </Notice>
        )}

        {cert.isError && status !== 409 && (
          <Notice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
            Couldn't reach Caddy to fetch the root certificate
            {cert.error instanceof ApiError ? ` — ${cert.error.message}` : ""}.
          </Notice>
        )}

        {cert.data && (
          <>
            <p className="mb-3 text-sm text-slate-400">
              Your browser will warn you that you're installing something. That's
              expected — this file is a certificate, not a program, and it can't run.
            </p>
            <button
              onClick={download}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500"
            >
              <Download className="h-4 w-4" /> {cert.data.filename}
            </button>
            {cert.data.common_name && (
              <p className="mt-2 font-mono text-xs text-slate-500">
                {cert.data.common_name}
              </p>
            )}
          </>
        )}
      </Step>

      {cert.data && (
        <>
          <Step n={2} title="Add it to your trust store">
            <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 p-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                    platform === p.id
                      ? "bg-teal-500/10 text-teal-200"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {platform === "windows" && <Windows file={cert.data.filename} />}
            {platform === "macos" && <MacOS file={cert.data.filename} />}
            {platform === "linux" && <Linux file={cert.data.filename} />}
            {platform === "android" && <Android file={cert.data.filename} />}

            {/* Desktop Firefox's menus; the Android tab has its own line. */}
            {platform !== "android" && (
              <Notice tone="info">
                <strong className="font-medium text-slate-200">Firefox</strong> keeps its
                own trust store and ignores the system one on every platform. Open{" "}
                <span className="text-slate-300">
                  Settings → Privacy &amp; Security → Certificates → View Certificates →
                  Authorities → Import
                </span>
                , pick the file, and tick “Trust this CA to identify websites”.
              </Notice>
            )}
          </Step>

          <Step n={3} title="Check it worked">
            <p className="text-sm text-slate-400">
              Open any internal site over <span className="font-mono">https://</span> and
              look for the padlock. Already had a tab open? Reload it — browsers cache the
              old failure. You won't have to do this again on this device.
            </p>
          </Step>
        </>
      )}
    </div>
  );
}

function Windows({ file }: { file: string }) {
  return (
    <>
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-400">
        <li>
          Double-click <span className="font-mono text-slate-300">{file}</span> in your
          Downloads folder.
        </li>
        <li>
          Click <strong className="font-medium text-slate-200">Install Certificate</strong>
          , choose <strong className="font-medium text-slate-200">Local Machine</strong>,
          then Next.
        </li>
        <li>
          Choose{" "}
          <strong className="font-medium text-slate-200">
            Place all certificates in the following store
          </strong>{" "}
          — the default “Automatically select” puts it in the wrong one and the warning
          stays.
        </li>
        <li>
          Browse to{" "}
          <strong className="font-medium text-slate-200">
            Trusted Root Certification Authorities
          </strong>
          , then Next and Finish.
        </li>
      </ol>
      <Code label="Or, in PowerShell as Administrator">
        {`certutil -addstore -f "ROOT" "$env:USERPROFILE\\Downloads\\${file}"`}
      </Code>
    </>
  );
}

function MacOS({ file }: { file: string }) {
  return (
    <>
      <Code label="Run in Terminal — you'll be asked for your password">
        {`sudo security add-trusted-cert -d -r trustRoot \\\n  -k /Library/Keychains/System.keychain ~/Downloads/${file}`}
      </Code>
      <p className="mb-3 mt-2 text-sm text-slate-400">
        That covers Safari and Chrome. On an iPhone or iPad, open the file in Safari, then
        install it under Settings → General → VPN &amp; Device Management, and switch it on
        under Settings → General → About → Certificate Trust Settings.
      </p>
    </>
  );
}

// Android installs a CA certificate from Settings only — since Android 11, opening the file
// does nothing — and asks for a screen lock first. Browsers then trust it; Firefox only once
// told to, and many apps never (Android 7 left user certificates to each app to accept).
function Android({ file }: { file: string }) {
  return (
    <>
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-400">
        <li>
          Download <span className="font-mono text-slate-300">{file}</span> above. Opening
          it doesn't install it.
        </li>
        <li>
          Open Settings ›{" "}
          <strong className="font-medium text-slate-200">Security &amp; privacy</strong> ›{" "}
          <strong className="font-medium text-slate-200">More security &amp; privacy</strong> ›{" "}
          <strong className="font-medium text-slate-200">Encryption &amp; credentials</strong> ›{" "}
          <strong className="font-medium text-slate-200">Install a certificate</strong> ›{" "}
          <strong className="font-medium text-slate-200">CA certificate</strong>. On a Samsung:
          Security and privacy › More security settings › Install from device storage › CA
          certificate.
        </li>
        <li>
          Tap <strong className="font-medium text-slate-200">Install anyway</strong>, then pick{" "}
          <span className="font-mono text-slate-300">{file}</span> from Downloads. Without a
          screen lock, Android asks you to set one first.
        </li>
      </ol>
      <p className="mb-3 text-sm text-slate-400">
        A notice then says the network may be monitored: that is any certificate you install
        yourself. Chrome and Samsung Internet trust it now. Firefox does once you turn on{" "}
        <span className="text-slate-300">Use third party CA certificates</span> under Settings ›
        Secret Settings (tap the logo in About Firefox five times to show them). Many apps
        never trust it: for those, serve the name over HTTP too.
      </p>
    </>
  );
}

// The distro split is the part that was wrong before: `update-ca-certificates` is a
// Debian tool and simply doesn't exist on Fedora, so those instructions failed on a
// machine that looked identical from the browser's side.
function Linux({ file }: { file: string }) {
  return (
    <>
      <Code label="Debian, Ubuntu, Mint, Raspberry Pi OS">
        {`sudo cp ~/Downloads/${file} /usr/local/share/ca-certificates/\nsudo update-ca-certificates`}
      </Code>
      <Code label="Fedora, RHEL, Rocky, Alma, CentOS">
        {`sudo cp ~/Downloads/${file} /etc/pki/ca-trust/source/anchors/\nsudo update-ca-trust`}
      </Code>
      <Code label="Arch, openSUSE (p11-kit)">
        {`sudo trust anchor --store ~/Downloads/${file}`}
      </Code>
      <p className="mb-3 text-sm text-slate-400">
        The Debian tool only picks up files ending in{" "}
        <span className="font-mono text-slate-300">.crt</span> — keep the name as it
        downloaded.
      </p>
      <Code label="Chrome and Chromium keep a separate store on Linux — add it there too">
        {`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," \\\n  -n "Caddy Local Authority" -i ~/Downloads/${file}`}
      </Code>
      <p className="mb-3 text-sm text-slate-400">
        <span className="font-mono text-slate-300">certutil</span> comes from{" "}
        <span className="font-mono text-slate-300">nss-tools</span> (Fedora) or{" "}
        <span className="font-mono text-slate-300">libnss3-tools</span> (Debian).
      </p>
    </>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-medium text-slate-200">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/15 text-xs text-teal-300">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Code({ label, children }: { label: string; children: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
        <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-slate-300">
          {children}
        </pre>
        <CopyButton
          text={children}
          title="Copy"
          label="Copy command"
          className="shrink-0 rounded-md border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800"
        />
      </div>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn" | "info";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const style = {
    ok: "border-emerald-600/40 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-600/40 bg-amber-500/10 text-amber-200",
    info: "border-slate-800 bg-slate-900/60 text-slate-400",
  }[tone];

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${style}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
