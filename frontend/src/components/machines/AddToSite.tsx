import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus } from "lucide-react";

import { api, apiMessage } from "../../lib/api";
import { commentText, remoteSshHost, useSsh, type GitSite, type MachineKey } from "../../lib/ssh";
import type { ToolContext } from "../../lib/toolRows";
import type { Tool } from "../../lib/tools";
import { CopyButton } from "../shared/CopyButton";
import { Overlay } from "../shared/Modal";
import { ActionIcon } from "./ToolIcon";

const ADD = "add";
const FIELD = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100";
const LABEL = "mb-1 block text-xs font-medium text-slate-400";

// The machine's account key, as ssh offers it: the first of these it has — the order Git's
// Account key looks for one in.
export function accountKey(keys: MachineKey[] | null | undefined): MachineKey | undefined {
  return ["id_ed25519", "id_ecdsa", "id_rsa"].map((n) => keys?.find((k) => k.name === n)).find(Boolean);
}

// A git site's SSH address without its port: the host a remote names.
const hostOf = (ssh: string) => ssh.replace(/:\d+$/, "");

// A web address's host: where its SSH usually is too, on 22 unless the site says otherwise.
const webHost = (web: string) => web.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/:?#]/)[0];

// Add SSH key, from Git's Keys: the site, the key's name, then the key to copy, the
// site's page to paste it on, and a Test there. The key is the machine's account key, which
// ssh offers every host by itself — Account key makes it, or renames it to the name given.
export function AddToSite({ tool, ctx, onClose }: { tool: Tool; ctx: ToolContext; onClose: () => void }) {
  const ssh = useSsh();
  const sites = ssh.data?.git_sites ?? [];
  const account = accountKey(ctx.facts.ssh_keys);
  const nameAction = tool.actions.find((a) => a.ask === "key-comment");
  const testAction = tool.actions.find((a) => a.ask === "key-host");
  const user = ssh.data?.targets[ctx.machineId]?.split("@")[0];
  // The site its projects' remotes already go to, else the first.
  const remoteHosts = new Set((ctx.facts.remotes ?? []).map((r) => remoteSshHost(r.url)));
  const [picked, setPicked] = useState<string | null>(null);
  const site = sites.find((s) => s.name === picked) ?? sites.find((s) => remoteHosts.has(hostOf(s.ssh))) ?? sites[0];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(account ? commentText(account.comment) : `${user ?? "me"}@${ctx.machineId}`);
  const [tested, setTested] = useState<{ site: string; ok: boolean } | null>(null);
  const wanted = name.trim();
  const named = account && commentText(account.comment) === wanted;

  const runName = () =>
    nameAction &&
    ctx.onRun({ tool: tool.id, action: nameAction.id, target: wanted, title: `${account ? "Rename" : "Make"} the key: ${wanted}` }, nameAction);
  const runTest = () =>
    site && account && testAction &&
    ctx.onRun(
      { tool: tool.id, action: testAction.id, target: `${account.name}@${site.ssh}`, title: `Test: ${account.name} on ${site.name}` },
      testAction,
      (ok) => setTested({ site: site.name, ok }),
    );

  return (
    <Overlay onClose={onClose} label="Add SSH key">
      <h2 className="text-base font-semibold text-slate-100">Add SSH key</h2>
      <p className="mt-1 text-xs text-slate-500">
        This machine's key, on your account there: every repository you can reach, it can pull and push.
      </p>

      <label className="mt-4 block">
        <span className={LABEL}>1. Site</span>
        <select
          value={site?.name ?? ""}
          onChange={(e) => (e.target.value === ADD ? setAdding(true) : (setPicked(e.target.value), setTested(null)))}
          className={FIELD}
        >
          {sites.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.builtin ? "" : ` — ${s.ssh}`}
            </option>
          ))}
          <option value={ADD}>Add a site…</option>
        </select>
      </label>

      <label className="mt-3 block">
        <span className={LABEL}>2. Key name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} font-mono`} />
        <span className="mt-1 block text-xs text-slate-500">How the site lists it.</span>
      </label>

      <div className="mt-4">
        <span className={LABEL}>3. Copy it to {site?.name ?? "the site"}</span>
        {!account || !named ? (
          <button
            type="button"
            disabled={!wanted || !nameAction}
            onClick={runName}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            <ActionIcon tool={tool.id} action={nameAction?.id ?? ""} className="h-3.5 w-3.5" />
            {account ? `Rename the key to ${wanted || "…"}` : "Make the key"}
          </button>
        ) : (
          <div className="space-y-2">
            {account.public ? (
              <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
                <code className="min-w-0 flex-1 break-all text-[11px] text-slate-300">
                  {account.public} {account.comment}
                </code>
                <CopyButton
                  text={`${account.public} ${account.comment}`}
                  title="Copy the key"
                  shown="Copy"
                  className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                />
              </div>
            ) : (
              <p className="text-xs text-amber-300">This machine's status line is older: install it again to copy the key from here.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {site && (
                <a
                  href={site.keys}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-teal-300 hover:bg-slate-800"
                >
                  Paste it in {site.name}'s SSH keys <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {testAction && site && (
                <button
                  type="button"
                  onClick={runTest}
                  title={`Try it on ${site.ssh}`}
                  className="flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                >
                  <ActionIcon tool={tool.id} action={testAction.id} className="h-3 w-3" /> Test
                </button>
              )}
              {tested?.site === site?.name && (
                <span className={`text-xs ${tested?.ok ? "text-emerald-300" : "text-rose-300"}`}>
                  {tested?.ok ? "It gets in." : "Refused — paste it there first."}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
          Close
        </button>
      </div>
      {adding && (
        <AddSite
          sites={sites}
          onClose={() => setAdding(false)}
          onAdded={(s) => {
            setAdding(false);
            setPicked(s.name);
            setTested(null);
          }}
        />
      )}
    </Overlay>
  );
}

// A git site of your own — a Forgejo, a Gitea — kept in Loskai for every machine: from Add SSH
// key's site, or a key's host field.
export function AddSite({ sites, onClose, onAdded }: { sites: GitSite[]; onClose: () => void; onAdded: (site: GitSite) => void }) {
  const qc = useQueryClient();
  const [site, setSite] = useState({ name: "", web: "", ssh: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The SSH address follows the web address's host until it is typed in.
  const [sshTyped, setSshTyped] = useState(false);
  const set = (k: keyof typeof site) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (k === "ssh") setSshTyped(true);
    setSite({ ...site, [k]: value, ...(k === "web" && !sshTyped ? { ssh: webHost(value) } : {}) });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const added = sites.filter((s) => !s.builtin).map(({ name, web, ssh }) => ({ name, web, ssh }));
      const kept = await api.put<{ sites: GitSite[] }>("/api/ssh/git-sites", { sites: [...added, site] });
      await qc.invalidateQueries({ queryKey: ["ssh"] });
      onAdded(kept.sites[kept.sites.length - 1]);
    } catch (err) {
      setError(apiMessage(err, "Couldn't add it"));
      setSaving(false);
    }
  };
  return (
    <Overlay onClose={onClose} label="Add a site">
      <form onSubmit={save}>
        <h2 className="text-base font-semibold text-slate-100">Add a site</h2>
        <p className="mt-1 text-xs text-slate-500">A Forgejo or Gitea of your own. Every machine's Keys offers it.</p>
        <label className="mt-4 block">
          <span className={LABEL}>Name</span>
          <input autoFocus value={site.name} onChange={set("name")} placeholder="Forgejo" className={FIELD} />
        </label>
        <label className="mt-3 block">
          <span className={LABEL}>Web address</span>
          <input value={site.web} onChange={set("web")} placeholder="https://git.example.com" className={`${FIELD} font-mono`} />
          <span className="mt-1 block text-xs text-slate-500">Where you open it in a browser.</span>
        </label>
        <label className="mt-3 block">
          <span className={LABEL}>SSH address</span>
          <input value={site.ssh} onChange={set("ssh")} placeholder="git.example.com:222" className={`${FIELD} font-mono`} />
          <span className="mt-1 block text-xs text-slate-500">
            Filled in from the web address. Add :port when its SSH isn't on 22.
          </span>
        </label>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!site.name.trim() || !site.web.trim() || !site.ssh.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add site
          </button>
        </div>
      </form>
    </Overlay>
  );
}
