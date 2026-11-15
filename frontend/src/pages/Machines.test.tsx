import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";

import { Machines } from "./Machines";
import { UnlockPrompt } from "../components/shared/UnlockPrompt";
import { renderWithQuery, json } from "../test/render";
import { copyText } from "../lib/clipboard";

// xterm needs a real canvas; these tests only need to know a terminal opened, and where.
// Copying is the browser's; the tests see what was asked to be copied.
vi.mock("../lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../components/shared/XtermSession", () => ({
  // A session's end, as the machine would: what it printed last, then closed normally.
  XtermSession: ({ url, onOutput, onClosed }: { url: string; onOutput?: (t: string) => void; onClosed?: (code: number, reason: string) => void }) => (
    <div>
      shell at {url}
      <button onClick={() => onClosed?.(1000, "")}>end: done</button>
      <button onClick={() => onOutput?.("[failed, exit 1] Enter closes this.")}>end: failed</button>
    </div>
  ),
}));

const ROUTES = [
  {
    id: "nas", name: "Storage box", type: "external", kind: "machine", subdomain: "nas",
    fqdn: "nas.example.no", upstream: "192.168.10.50", route_mode: "dns_only",
    private: false, routed: true, synced: null,
  },
  {
    id: "pve", name: "pve", type: "external", kind: "machine", subdomain: "pve",
    fqdn: "pve.example.no", upstream: "192.168.10.10", route_mode: "dns_only",
    private: false, routed: true, synced: null,
  },
  {
    id: "plex", name: "plex", type: "external", kind: "service", subdomain: "plex",
    fqdn: "plex.example.no", url: "https://plex.example.no", upstream: "192.168.10.50:32400",
    private: false, routed: true, synced: true,
  },
  {
    id: "jellyfin", name: "jellyfin", type: "external", kind: "service", subdomain: "tv",
    fqdn: "tv.example.no", url: "https://tv.example.no", upstream: "192.168.10.50:8096",
    private: false, routed: true, synced: true,
  },
  {
    id: "grafana", name: "grafana", type: "docker", kind: "service", subdomain: "grafana",
    fqdn: "grafana.example.no", url: "https://grafana.example.no", upstream: "grafana:3000",
    private: false, routed: true, synced: true,
  },
];

let calls: { path: string; method: string; body: unknown }[] = [];
let sshHosts: Record<string, unknown> = {};
let toolsReply: unknown[] = [];
let sshTrusted: Record<string, boolean> = {};
const FACTS = {
  ok: true, checked: 0, os: "Debian GNU/Linux 12 (bookworm)", kernel: "Linux 6.1.0", uptime: 3 * 86400 + 7200,
  memory: { total: 8 * 1024 ** 3, available: 2 * 1024 ** 3 },
  disks: [{ mount: "/", device: "/dev/sda1", size: 100 * 1024 ** 3, used: 95 * 1024 ** 3 }],
  updates: { manager: "apt", count: 12 }, programs: ["docker", "tmux", "tailscale", "git", "claude"], tailscale: "100.64.0.7",
  tailnet: [
    { ip: "100.64.0.7", name: "nas", os: "linux", online: true, self: true, status: "-" },
    { ip: "100.64.0.9", name: "phone", os: "iOS", online: false, self: false, status: "offline" },
  ],
  // As the server sends them: whose each session is, and which rows' sessions run.
  tmux: [
    { name: "build", created: 1793212547, attached: false, windows: 2, tool: null },
    { name: "claude-site", created: 1793212547, attached: false, windows: 1, tool: "claude" },
  ],
  live: { claude: { project: ["site"] } },
  ssh_keys: [
    { name: "id_ed25519", bits: 256, fingerprint: "SHA256:mach", comment: "loskai@nas", type: "ED25519", public: "ssh-ed25519 AAAAmach" },
    { name: "deploy_blog", bits: 256, fingerprint: "SHA256:blog", comment: "loskai@nas blog", type: "ED25519", public: "ssh-ed25519 AAAAblog" },
    { name: "work", bits: 256, fingerprint: "SHA256:work", comment: "me@laptop", type: "ED25519", public: "ssh-ed25519 AAAAwork" },
    // Labelled: what it is for, written on it.
    { name: "server", bits: 256, fingerprint: "SHA256:serv", comment: "admin@nas (loskai: login)", type: "ED25519", public: "ssh-ed25519 AAAAserv" },
  ],
  // site's submodule pushes through a ~/.ssh/config alias, gh-page, which names `work`.
  remotes: [
    { path: "projects/site", module: "", kind: "url", url: "git@github.com:me/site.git" },
    { path: "projects/blog", module: "", kind: "url", url: "git@forgejo.lan:me/blog.git" },
    { path: "projects/site", module: "public/page", kind: "url", url: "https://github.com/me/page.git" },
    { path: "projects/site", module: "public/page", kind: "pushurl", url: "git@gh-page:me/page.git" },
  ],
  ssh_hosts: {
    "github.com": { hostname: "github.com", identities_only: false, keys: ["id_ed25519"] },
    "forgejo.lan": { hostname: "forgejo.lan", identities_only: false, keys: ["id_ed25519"] },
    "gh-page": { hostname: "github.com", identities_only: true, keys: ["work"] },
  },
  ssh_config_keys: ["work"],
  projects: [
    { path: "projects/site", folder: "projects", name: "site", branch: "main", dirty: true, claude: 1793212000,
      ahead: 2, committed: 1793211000, subject: "Add the header" },
    { path: "projects/blog", folder: "projects", name: "blog", branch: "main", dirty: false, claude: 0, committed: 1793210000, subject: "Start",
      key: "deploy_blog" },
    { path: "notes", folder: "", name: "notes", branch: "main", dirty: false, claude: 0, committed: 1793211000, subject: "x" },
  ],
};
let facts: unknown = FACTS;
let factsStatus = 200;
let settingsReply: unknown = {};
const RUNNING = {
  nas: { ok: true, checked: 0, containers: [{ name: "plex-1", image: "plex", status: "Up 2 days", ports: [] }], services: [], guests: [] },
};
let runningReply: unknown = RUNNING;
const ADMIN_STATUS = { authed: true, needs_setup: false, user: { username: "admin", level: 4, tabs: ["routing", "docker", "machines"] } };
let authStatus: unknown = ADMIN_STATUS;
let sshKey: unknown = null;
let deleteReply: unknown = { deleted: true, instance_id: "nas", warning: null };
let gitStatus = 200;
const TOOLS = [
  {
    id: "system", name: "System", description: "Update the system, reboot, shut down.", requires: [], installable: [],
    actions: [
      { id: "update", label: "Update", description: "Update it.", target: null, confirm: null, automatic: true,
        run: { apt: "sudo apt-get update && sudo apt-get -y dist-upgrade" } },
      { id: "reboot", label: "Reboot", description: "Restart it.", target: null, automatic: true,
        confirm: "Everything on it stops until it is back up.", run: "sudo reboot" },
    ],
  },
  {
    id: "services", name: "Services", description: "From the Running list.", requires: [], installable: [],
    actions: [{ id: "restart-container", label: "Restart", description: "Restart it.", target: "container", confirm: null,
                run: "docker restart \"$1\"" }],
  },
  {
    id: "proxmox", name: "Proxmox", description: "Guests.", requires: ["pct", "qm"], installable: [],
    actions: [{ id: "reboot-lxc", label: "Reboot", description: "Reboot it.", target: "lxc", confirm: null, run: "sudo pct reboot \"$1\"" }],
  },
  {
    id: "tmux", name: "tmux", description: "Sessions.", requires: ["tmux"], installable: ["tmux"],
    actions: [
      { id: "attach", label: "Attach", description: "Open it.", target: "session", ask: null, confirm: null, run: "tmux attach-session -t \"=$1\"" },
      { id: "new", label: "New session", description: "Start one.", target: null, ask: "session", confirm: null, run: "tmux new-session -A -s \"$1\"" },
    ],
  },
  {
    id: "claude", name: "Claude Code", description: "Claude in projects.", requires: ["claude", "tmux", "git"], installable: ["claude", "tmux", "git"],
    actions: [
      { id: "attach", label: "Attach", description: "Watch it.", target: "project", ask: null, confirm: null, session: "claude", when: "running", otherwise: "disabled", run: "true" },
      { id: "start", label: "Start", description: "Start it.", target: "project", ask: null, confirm: null, session: false, automatic: true, when: "stopped", run: "tmux new-session -d claude" },
      { id: "stop", label: "Stop", description: "Stop it.", target: "project", ask: null, confirm: "Claude stops.", session: false, automatic: true, when: "running", run: "tmux kill-session" },
      { id: "new", label: "New project", description: "Make one.", target: null, ask: "project", confirm: null, session: "claude", run: "git init" },
    ],
  },
  {
    id: "tailscale", name: "Tailscale", description: "Connect it.", requires: ["tailscale"], installable: ["tailscale"],
    actions: [
      { id: "up", label: "Connect", description: "Up.", target: null, ask: null, confirm: null, session: null, run: "sudo tailscale up" },
      { id: "share", label: "Share this network", description: "Share.", target: null, ask: null, confirm: null, session: null,
        automatic: true, run: "sudo tailscale set --advertise-routes=x" },
      { id: "unshare", label: "Stop sharing", description: "Stop.", target: null, ask: null, confirm: "Stops it.", session: null,
        automatic: true, run: "sudo tailscale set --advertise-routes=" },
      { id: "down", label: "Disconnect", description: "Down.", target: null, ask: null, confirm: "Off.", session: null,
        automatic: true, run: "sudo tailscale down" },
    ],
  },
  {
    id: "git", name: "Git", description: "Who commits are by.", requires: ["git"], installable: ["git"],
    actions: [
      { id: "pull", label: "Pull", description: "Bring it in.", target: "project", ask: null, confirm: null, run: "git pull --ff-only" },
      { id: "pull-all", label: "Pull all", description: "Pull each.", target: null, ask: null, confirm: null, run: "git pull" },
      { id: "push-all", label: "Push all", description: "Push each.", target: null, ask: null, confirm: null, run: "git push" },
      { id: "clone", label: "Clone", description: "Clone one.", target: null, ask: "repo", confirm: null, run: "git clone -- \"$1\"" },
      { id: "ssh-key", label: "New account key", description: "Make one.", target: null, ask: null, confirm: null, session: false, place: "keys", run: "ssh-keygen" },
      { id: "host-key", label: "New key for a host", description: "Make one.", target: null, ask: "host", confirm: null, session: false, place: "keys", run: "ssh-keygen" },
      { id: "test-key", label: "Test key", description: "Try it.", target: null, ask: "host", confirm: null, session: false, place: "keys", automatic: true, run: "ssh -T \"git@$1\"" },
      { id: "every-key", label: "Try every key", description: "Try each.", target: null, ask: "host", confirm: null, session: false, place: "keys", automatic: true, run: "ssh -T \"git@$1\"" },
      { id: "key-on-host", label: "Test", description: "Try it there.", target: null, ask: "key-host", confirm: null, session: false, place: "keys", automatic: true, run: "ssh -T" },
      { id: "label-key", label: "Label", description: "What it is for.", target: null, ask: "key-label", confirm: null, session: false, place: "keys", automatic: true, run: "ssh-keygen -c" },
      { id: "delete-key", label: "Delete", description: "Delete it.", target: "key", ask: null, confirm: "Its file goes for good.", session: false, run: "rm" },
      { id: "own-key", label: "Own key", description: "Its own key.", target: "project", ask: null, confirm: null, session: false, place: "settings", run: "ssh-keygen" },
      { id: "machine-key", label: "Machine's key", description: "The machine's again.", target: "project", ask: null, confirm: null, session: false, place: "settings", run: "git config --unset core.sshCommand" },
    ],
    settings: [
      { id: "name", label: "Name", description: "On every commit.", value: "git-name", read: "git config --global user.name", write: "x" },
      { id: "email", label: "Email", description: "On every commit.", value: "email", read: "git config --global user.email", write: "x" },
      // No `unset`: it needs a value once set — and one never set doesn't stop another saving.
      { id: "project-name", label: "Name", description: "This project's.", value: "git-name", read: "x", write: "x",
        target: "project", overrides: "name" },
      { id: "project-email", label: "Email", description: "This project's.", value: "email", read: "x", write: "x",
        unset: "x", target: "project", overrides: "email" },
    ],
  },
  {
    id: "versions", name: "Versions", description: "Git things.", requires: ["kubectl"], installable: ["kubectl"],
    actions: [{ id: "log", label: "Log", description: "Show it.", target: null, ask: null, confirm: null, run: "git log" }],
  },
];
// An unlocked key, so a terminal opens straight away (the mock shows its URL).
const UNLOCKED_KEY = {
  public_key: "ssh-ed25519 AAAA loskai", fingerprint: "SHA256:k", authorized_keys: "", lines: [], from: null,
  unlocked_until: new Date(Date.now() + 600_000).toISOString(),
};

beforeEach(() => {
  // Machines start collapsed; most tests look at the routes beneath, so both begin open.
  sessionStorage.setItem("loskai.machines.expanded", JSON.stringify(["nas", "pve"]));
  calls = [];
  sshHosts = {};
  toolsReply = TOOLS;
  sshTrusted = {};
  facts = FACTS;
  factsStatus = 200;
  settingsReply = {};
  runningReply = RUNNING;
  authStatus = ADMIN_STATUS;
  sshKey = null;
  deleteReply = { deleted: true, instance_id: "nas", warning: null };
  gitStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({
        path,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const data =
        path === "/api/caddy/routes"
          ? ROUTES
          : path === "/api/adguard/status"
            ? { answer_ip: null, instances: [
                { id: "nas", domain: "nas.example.no", present: true, conflict: false },
                { id: "plex", domain: "plex.example.no", present: false, conflict: false },
              ] }
            : path === "/api/docker/containers"
              ? []
            : path === "/api/machines"
              ? { url: "nas.example.no", instance_id: "nas", warning: null, moved: ["plex"] }
            : path === "/api/ssh"
              ? {
                  key: sshKey,
                  hosts: sshHosts,
                  trusted: sshTrusted,
                  // As the server reaches each: the fixtures' aliases are their machine ids.
                  targets: Object.fromEntries(
                    Object.entries(sshHosts as Record<string, { hostname: string; user?: string }>)
                      .filter(([, h]) => h.user)
                      .map(([id, h]) => [id, `${h.user}@${h.hostname}`]),
                  ),
                  projects: { nas: "~/projects", pve: "~/projects" },
                }
            : path === "/api/instances/nas" && init?.method === "DELETE"
              ? deleteReply
            : path === "/api/ssh/tools"
              ? toolsReply
            : path === "/api/auth/status"
              ? authStatus
            : path === "/api/settings"
              ? settingsReply
            : path.startsWith("/api/ssh/log")
              ? [
                  { at: "2026-11-01T11:00:00Z", event: "setting", machine: "nas", from: "192.168.10.5", user: "admin",
                    tool: "git", setting: "email", value: "ola@example.no", ok: true },
                  { at: "2026-11-01T10:00:00Z", event: "open", machine: "nas", from: "192.168.10.5", target: "loskai@192.168.10.50" },
                  { at: "2026-11-01T09:00:00Z", event: "open", machine: "pve", from: "192.168.10.5", target: "root@192.168.10.10" },
                ].filter((e) => e.machine === (new URLSearchParams(path.split("?")[1]).get("machine") ?? e.machine))
            : path === "/api/ssh/running"
              ? runningReply
            : path.endsWith("/tools/git/settings")
              ? gitStatus === 423
                ? { detail: "Loskai's key is locked — enter your password" }
                : { values: { name: "Ola Nordmann", email: null }, targets: { project: { site: { "project-name": null, "project-email": null } } } }
            : path.endsWith("/tools/git/settings/email")
              ? { values: { name: "Ola Nordmann", email: "ola@example.no" }, targets: { project: {} } }
            : path.endsWith("/tools/git/settings/project-email")
              ? { values: { name: "Ola Nordmann", email: null }, targets: { project: { site: { "project-name": null, "project-email": "ola@work.example" } } } }
            : path.endsWith("/facts")
              ? (typeof facts === "function" ? facts(path) : facts)
            // As the backend says: automatic when the action is, and the sudo rule and an
            // install always — an automatic run drops down instead of opening a dialog.
            : path.endsWith("/run")
              ? (() => {
                  const r = JSON.parse(String(init?.body ?? "{}"));
                  const action = TOOLS.find((t) => t.id === r.tool)?.actions.find((a) => a.id === r.action) as { automatic?: boolean } | undefined;
                  return { automatic: Boolean(r.sudo || r.install || action?.automatic), needs_password: false, ticket: null };
                })()
            : path.endsWith("/scan")
              ? { fingerprint: "SHA256:abc", type: "ssh-ed25519", state: "new" }
              : {};
      return json(data, path.endsWith("/facts") ? factsStatus : path.endsWith("/tools/git/settings") ? gitStatus : 200);
    }),
  );
});


const nasRow = () => screen.getByText("Storage box").closest("tr") as HTMLElement;
// The machine's dialog: its side menu, and the category shown.
const dialog = () => screen.getByRole("dialog", { name: "Storage box" });
const category = (name: string) => screen.getByRole("region", { name });
const openCategory = (name: string) =>
  fireEvent.click(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("button", { name }));

// The routes as App has them, so the cog and naming a machine go where they really do.
function renderPage(at = "/machines") {
  renderWithQuery(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/machines" element={<Machines />} />
        <Route path="/machines/:id/:section?" element={<Machines />} />
      </Routes>
      <UnlockPrompt />
    </MemoryRouter>,
  );
}

test("lists machines only, each with the routes hosted on it beneath", async () => {
  renderPage();

  expect(await screen.findByText("Storage box")).toBeInTheDocument();
  expect(screen.getByText("pve")).toBeInTheDocument();
  // plex is listed as hosted on the NAS, by port — the host half is the machine above it.
  expect(screen.getByText("plex")).toBeInTheDocument();
  expect(screen.getByText(":32400")).toBeInTheDocument();
  // A service on no machine has no business on this tab.
  expect(screen.queryByText("grafana")).not.toBeInTheDocument();
  expect(screen.getByText("No routes on this machine.")).toBeInTheDocument();
});

test("a machine starts collapsed, with its count; opening it shows its routes and is remembered", async () => {
  sessionStorage.clear();
  renderPage();

  await screen.findByText("Storage box");
  expect(screen.queryByText("plex")).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: /Storage box/ });
  expect(toggle).toHaveAttribute("title", "2 routes on this machine");
  expect(toggle).toHaveTextContent("2");

  fireEvent.click(toggle);
  expect(screen.getByText("plex")).toBeInTheDocument();
  expect(JSON.parse(sessionStorage.getItem("loskai.machines.expanded")!)).toEqual(["nas"]);

  fireEvent.click(screen.getByRole("button", { name: "Collapse all machines" }));
  expect(screen.queryByText("plex")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand all machines" }));
  expect(screen.getByText("No routes on this machine.")).toBeInTheDocument();
});

test("a hosted route links out under URL; DNS state is the machine's alone, beside its name", async () => {
  renderPage();
  const plexRow = (await screen.findByText("plex")).closest("tr") as HTMLElement;
  const [, url, address, rest] = within(plexRow).getAllByRole("cell");

  expect(within(url).getByRole("link", { name: "plex.example.no" })).toHaveAttribute(
    "href",
    "https://plex.example.no",
  );
  expect(address).toHaveTextContent(":32400");
  // plex's rewrite is missing, but that is Routing's to say.
  expect(rest).toBeEmptyDOMElement();
  expect(within(plexRow).queryByText(/DNS/)).not.toBeInTheDocument();
  // The machine's own name sits in the same URL column, on its row, with no DNS column: set,
  // nothing more is said (nas); not known to AdGuard, it says so beside the name (pve).
  expect(screen.queryByRole("columnheader", { name: "DNS" })).not.toBeInTheDocument();
  const [, nasUrl] = within(nasRow()).getAllByRole("cell");
  expect(nasUrl).toHaveTextContent(/^nas\.example\.no$/);
  fireEvent.click(within(nasUrl).getByRole("button", { name: "nas.example.no" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("AdGuard answers it with 192.168.10.50");
  const pveRow = screen.getByText("pve").closest("tr") as HTMLElement;
  const [, pveUrl] = within(pveRow).getAllByRole("cell");
  expect(pveUrl).toHaveTextContent("pve.example.no");
  expect(within(pveUrl).getByText("DNS unknown")).toBeInTheDocument();
});

test("a machine's URL and address each copy with a small button", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByRole("button", { name: "Copy 192.168.10.50" }));
  fireEvent.click(within(nasRow()).getByRole("button", { name: "Copy nas.example.no" }));
  expect(vi.mocked(copyText).mock.calls).toEqual([["192.168.10.50"], ["nas.example.no"]]);
});

test("deleting a machine names the routes on its address, which keep it", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));

  expect(screen.getByText(/2 routes are on its address/)).toHaveTextContent("(jellyfin, plex)");
});

// The server refusing the first change to `path` as locked (423), as it does while Loskai's
// key is locked; anything after goes to the usual answers.
function lockedOnce(path: string) {
  const answer = fetch;
  let refused = false;
  vi.stubGlobal("fetch", (p: string, init?: RequestInit) =>
    p === path && (init?.method ?? "GET") !== "GET" && !refused
      ? ((refused = true), Promise.resolve(json({ detail: "Loskai's key is locked — enter your password" }, 423)))
      : answer(p, init),
  );
}

async function unlockInPrompt(password = "pw") {
  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  fireEvent.change(within(prompt).getByLabelText("Your password"), { target: { value: password } });
  fireEvent.click(within(prompt).getByRole("button", { name: "Unlock" }));
}

test("deleting a set-up machine with the key locked asks for your password in the one dialog, then deletes", async () => {
  sshSetUp();
  sshKey = { ...UNLOCKED_KEY, unlocked_until: null };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
  expect(screen.getByText(/Loskai's key is taken off the machine first/)).toBeInTheDocument();
  // No password field of its own: the server says it is locked, and the one dialog asks.
  expect(screen.queryByLabelText("Your password")).toBeNull();
  lockedOnce("/api/instances/nas");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  await unlockInPrompt();

  await vi.waitFor(() =>
    expect(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/ssh/unlock"],
      ["DELETE", "/api/instances/nas"],
    ]),
  );
});

test("turning SSH off with the key locked asks for your password in the one dialog, then turns it off", async () => {
  sshSetUp();
  sshKey = { ...UNLOCKED_KEY, unlocked_until: null };
  renderPage("/machines/nas/ssh");

  fireEvent.click(await screen.findByRole("switch", { name: "SSH" }));
  expect(screen.queryByLabelText("Your password")).toBeNull();
  lockedOnce("/api/machines");
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
  await unlockInPrompt("admin-pw");

  await vi.waitFor(() =>
    expect(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/ssh/unlock"],
      ["POST", "/api/machines"],
    ]),
  );
  expect(calls.find((c) => c.path === "/api/ssh/unlock")!.body).toEqual({ password: "admin-pw" });
  expect(calls.find((c) => c.path === "/api/machines")!.body).toMatchObject({ instance_id: "nas", ssh: null });
});

test("turning SSH off when the key locked meanwhile asks for your password then", async () => {
  sshSetUp();
  renderPage("/machines/nas/ssh");
  fireEvent.click(await screen.findByRole("switch", { name: "SSH" }));
  // Unlocked when the dialog opened: no field.
  expect(screen.queryByLabelText("Your password")).not.toBeInTheDocument();

  sshKey = { ...UNLOCKED_KEY, unlocked_until: null };
  const answer = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) =>
      path === "/api/machines" ? json({ detail: "Loskai's key is locked — enter your password" }, 423) : answer(path, init),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  expect(within(prompt).getByLabelText("Your password")).toBeInTheDocument();
});

test("a machine deleted with Loskai's key still on it says so", async () => {
  sshSetUp();
  deleteReply = { deleted: true, instance_id: "nas", warning: "Loskai's key is still on the machine: No route to host" };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
  // Unlocked already: no password asked.
  expect(screen.queryByLabelText("Your password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByText("Loskai's key is still on the machine: No route to host")).toBeInTheDocument();
});

test("a delete warning is shown as said — not told to remove lines that are already off", async () => {
  sshSetUp();
  deleteReply = { deleted: true, instance_id: "nas", warning: "Loskai's key is off, but its sudo rule stayed — as root: rm -f /etc/sudoers.d/loskai" };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByText(/its sudo rule stayed/)).toBeInTheDocument();
  expect(screen.queryByText(/authorized_keys/)).not.toBeInTheDocument();
});

test("every route on a machine's address is listed under it, by port", async () => {
  // Nothing links them: the address alone puts them on the machine.
  renderPage();
  const row = (await screen.findByText("jellyfin")).closest("tr") as HTMLElement;

  expect(within(row).getByText(":8096")).toBeInTheDocument();
  expect(within(screen.getByText("plex").closest("tr") as HTMLElement).getByText(":32400"))
    .toBeInTheDocument();
});

test("a machine's cog opens its dialog, where a field saves itself — only that change — and says what moved", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", port: 22 } }; // an entry whose User comes from Host *
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle(/^Machine settings/));
  expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
  const ip = within(dialog()).getByLabelText("Address");
  fireEvent.focus(ip);
  fireEvent.change(ip, { target: { value: "192.168.10.70" } });
  fireEvent.keyDown(ip, { key: "Enter" });
  fireEvent.blur(ip);

  const post = await vi.waitFor(() => {
    const c = calls.find((x) => x.path === "/api/machines");
    if (!c) throw new Error("not posted yet");
    return c;
  });
  // Nothing about SSH: the entry keeps what it has and only moves.
  expect(post.body).toEqual({ instance_id: "nas", address: "192.168.10.70", hostname: "nas" });
  const banner = await screen.findByText(/Moved plex with it/);
  expect(within(banner).getByText("nas.example.no")).toBeInTheDocument();
});

test("a field that isn't valid says why and saves nothing; Escape puts it back", async () => {
  renderPage("/machines/nas/general");

  const ip = await within(await screen.findByRole("dialog")).findByLabelText("Address");
  fireEvent.focus(ip);
  fireEvent.change(ip, { target: { value: "192.168.10.70:22" } });
  fireEvent.blur(ip);
  expect(await screen.findByText("A bare IPv4 address — no port.")).toBeInTheDocument();

  fireEvent.focus(ip);
  fireEvent.keyDown(ip, { key: "Escape" });
  fireEvent.blur(ip);
  expect(ip).toHaveValue("192.168.10.50");
  expect(calls.some((c) => c.path === "/api/machines")).toBe(false);
});

test("SSH is turned on from its heading, in a dialog that says what comes next, and the setup starts", async () => {
  renderPage("/machines/pve/ssh");

  const toggle = await screen.findByRole("switch", { name: "SSH" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByLabelText("SSH user")).toBeNull();
  fireEvent.click(toggle);
  const dialog = screen.getByText("Turn on SSH for pve").closest("div.flex-col") as HTMLElement;
  expect(within(dialog).getByText(/trust the machine's host key/)).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("SSH user"), { target: { value: "root" } });
  sshHosts = { pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));

  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/machines")?.body).toMatchObject({
      instance_id: "pve", ssh: { user: "root", port: 22 },
    }),
  );
  expect(await screen.findByText(/SSH — /)).toBeInTheDocument();
});

test("a set-up machine's login is one row, the user and the port each saving itself", async () => {
  sshSetUp();
  renderPage("/machines/nas/ssh");

  const port = await screen.findByLabelText("SSH port");
  expect(screen.getByLabelText("SSH user")).toHaveValue("loskai");
  fireEvent.focus(port);
  fireEvent.change(port, { target: { value: "2222" } });
  fireEvent.blur(port);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/machines")?.body).toMatchObject({
      instance_id: "nas", ssh: { user: "loskai", port: 2222 },
    }),
  );
});

test("turning SSH off is confirmed first, saying what comes off the machine", async () => {
  sshSetUp();
  renderPage("/machines/nas/ssh");

  const toggle = await screen.findByRole("switch", { name: "SSH" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(screen.getByText(/Loskai's key and its sudo rule come off the machine/)).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/machines")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));

  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/machines")?.body).toMatchObject({ instance_id: "nas", ssh: null }),
  );
});

test("the search finds a section by what is in it, and shows only those", async () => {
  sshSetUp();
  renderPage("/machines/nas");

  const search = await screen.findByLabelText("Search");
  fireEvent.change(search, { target: { value: "uptime" } });
  const nav = screen.getByRole("navigation", { name: "Categories" });
  expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["General"]);
  expect(screen.queryByRole("region", { name: "Log" })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(within(nav).getByText("Nothing matches.")).toBeInTheDocument();
});

test("a machine's row adds a route on its address", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("Add a route on this machine"));

  expect(await screen.findByRole("combobox", { name: "Host" })).toHaveValue("192.168.10.50");
});

test("the Docker host is listed before it is named, with the routes on its address", async () => {
  settingsReply = { host_ip: { value: "192.168.10.220", source: "env" } };
  ROUTES.push({
    id: "whoami", name: "whoami", type: "docker", kind: "service", subdomain: "whoami",
    fqdn: "whoami.example.no", url: "https://whoami.example.no", upstream: "192.168.10.220:8081", private: false, routed: true, synced: true,
  });
  sessionStorage.setItem("loskai.machines.expanded", JSON.stringify([":docker-host"]));
  try {
    renderPage();
    const row = (await screen.findByText("Docker host")).closest("tr") as HTMLElement;

    expect(within(row).getByText("not named")).toBeInTheDocument();
    // First, as it is once named.
    expect(screen.getAllByRole("row")[1]).toBe(row);
    expect(screen.getByText(":8081")).toBeInTheDocument();
    // Nothing to set up until it has a name: no settings, no delete.
    expect(within(row).queryByTitle("Machine settings")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "More" })).not.toBeInTheDocument();

    fireEvent.click(within(row).getByTitle(/Name it/));
    expect(screen.getByPlaceholderText("192.168.10.50")).toHaveValue("192.168.10.220");
    fireEvent.change(screen.getByPlaceholderText("rack1.vm3"), { target: { value: "dockerhost" } });
    fireEvent.click(screen.getByRole("button", { name: "Name machine" }));

    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === "/api/machines")?.body).toEqual({
        hostname: "dockerhost", address: "192.168.10.220",
      }),
    );
  } finally {
    ROUTES.pop();
  }
});

test("a Docker host already named is listed once, as itself — first, and tagged", async () => {
  settingsReply = { host_ip: { value: "192.168.10.50", source: "env" } };
  renderPage();

  await screen.findByText("Storage box");
  // "pve" sorts before "Storage box"; the Docker host goes first anyway.
  const machineRows = screen.getAllByRole("row").filter((r) => within(r).queryByTitle("Machine settings"));
  expect(within(machineRows[0]).getByText("Storage box")).toBeInTheDocument();
  expect(within(machineRows[0]).getByText("Host")).toBeInTheDocument();
  expect(screen.queryByText("Docker host")).not.toBeInTheDocument();
});

test("naming a machine with an SSH user opens its page, starting its SSH setup", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(screen.getByRole("button", { name: /Name a machine/ }));
  fireEvent.change(screen.getByPlaceholderText("rack1.vm3"), { target: { value: "nas" } });
  fireEvent.change(screen.getByPlaceholderText("192.168.10.50"), { target: { value: "192.168.10.50" } });
  fireEvent.change(screen.getByPlaceholderText("none"), { target: { value: "loskai" } });
  // The save writes the SSH config, so the refetch after it has the entry.
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  fireEvent.click(screen.getByRole("button", { name: "Name machine" }));

  expect(await screen.findByText("SHA256:abc")).toBeInTheDocument();
  expect(screen.getByText(/SSH — Storage box/)).toBeInTheDocument();
  expect(screen.getByText(/Moved plex with it/)).toBeInTheDocument();
  expect(calls.some((c) => c.path === "/api/ssh/machines/nas/scan")).toBe(true);
});

test("a machine with an SSH user that isn't set up: an amber cog, no terminal", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  renderPage();
  await screen.findByText("Storage box");

  expect(await within(nasRow()).findByTitle(/SSH not set up yet/)).toBeInTheDocument();
  expect(within(nasRow()).queryByTitle(/^Terminal/)).toBeNull();
  // No SSH user: a plain cog, still the way to its page.
  const pve = screen.getByText("pve").closest("tr") as HTMLElement;
  expect(within(pve).getByTitle("Machine settings")).toBeInTheDocument();
});

test("a machine's dialog sets up its SSH from there", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  renderPage("/machines/nas/running");

  expect(await screen.findByText(/Set up SSH to see what runs here./)).toBeInTheDocument();
  openCategory("SSH");
  expect(await screen.findByText("not set up")).toBeInTheDocument();
  fireEvent.click(within(category("SSH")).getByRole("button", { name: "Set up SSH" }));
  expect(await screen.findByText("SHA256:abc")).toBeInTheDocument();
});

test("below admin, a machine's dialog has no log, the logs being an admin's — a link to it opens General", async () => {
  authStatus = { authed: true, needs_setup: false, user: { username: "ola", level: 3, tabs: ["routing", "docker", "machines"] } };
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  renderPage("/machines/nas/log");

  expect(await screen.findByRole("region", { name: "Running" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Log" })).not.toBeInTheDocument();
  await waitFor(() =>
    expect(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("button", { name: "General" }))
      .toHaveAttribute("aria-current", "location"),
  );
});

test("a set-up machine's dialog, one scroll: its overview under General, tools, what runs there, its log, a terminal", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  renderPage("/machines/nas");

  // The overview, under General: system, uptime, what's waiting, how full, its Tailscale address.
  await screen.findByRole("region", { name: "General" });
  const general = () => category("General");
  expect(await within(general()).findByText("Debian GNU/Linux 12 (bookworm)")).toBeInTheDocument();
  expect(within(general()).getByText("3d 2h")).toBeInTheDocument();
  expect(within(general()).getByText(/12 waiting/)).toBeInTheDocument();
  expect(within(general()).getByText("6.0 GB / 8.0 GB")).toBeInTheDocument();
  expect(within(general()).getByText("95.0 GB / 100.0 GB")).toBeInTheDocument();
  expect(within(general()).getByText("100.64.0.7")).toBeInTheDocument();
  // Each tool's card, an added one's with what is in it — sessions another tool claims left out.
  const tools = category("Tools");
  expect(await within(tools).findByText("build")).toBeInTheDocument();
  expect(within(tools).queryByText("claude-site")).not.toBeInTheDocument();
  expect(within(tools).getByText("1 session")).toBeInTheDocument();
  expect(within(tools).getByText("2 projects, 1 running")).toBeInTheDocument();
  expect(await within(category("Running")).findByText("plex-1")).toBeInTheDocument();
  // Only this machine's entries, asked of the server: the newest of every machine's may not hold one.
  expect(await within(category("Log")).findByText("Terminal opened (loskai@192.168.10.50)")).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/ssh/log?machine=nas")).toBe(true);
  // The side menu marks the section picked.
  openCategory("Running");
  expect(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("button", { name: "Running" }))
    .toHaveAttribute("aria-current", "location");
  expect(screen.queryByText(/root@192.168.10.10/)).not.toBeInTheDocument();

  fireEvent.click(within(dialog()).getByRole("button", { name: "Terminal" }));
  // No key in this stub, so it asks to unlock first — alone, the terminal opening after.
  expect(await screen.findByRole("dialog", { name: "Unlock Loskai's key" })).toBeInTheDocument();
  expect(screen.queryByText("Terminal — Storage box")).toBeNull();
});

test("a machine on the older status line is offered the reinstall for its overview", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  facts = { ok: false, old: true, checked: 0, error: "Its status line predates the overview — install again" };
  renderPage("/machines/nas/overview");

  fireEvent.click(await screen.findByRole("button", { name: "Install again" }));
  expect(await screen.findByText(/SSH — Storage box/)).toBeInTheDocument();
});

test("an overview from the current status line has no reinstall note", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  renderPage("/machines/nas/overview");

  expect(await screen.findByText("Debian GNU/Linux 12 (bookworm)")).toBeInTheDocument();
  expect(screen.queryByText((_, el) => el?.tagName === "P" && /^Its status line is older than this Loskai\./.test(el.textContent ?? ""))).toBeNull();
});

test("an overview read from an older status line says so, and offers the reinstall", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  facts = { ...FACTS, outdated: true };
  renderPage("/machines/nas/overview");

  expect(await screen.findByText("Debian GNU/Linux 12 (bookworm)")).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "P" && /^Its status line is older than this Loskai\./.test(el.textContent ?? ""))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Install again" }));
  expect(await screen.findByText(/SSH — Storage box/)).toBeInTheDocument();
});

function sshSetUp() {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  sshKey = UNLOCKED_KEY;
}

test("a tool's action runs in the terminal, named — never as a command", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const update = await screen.findByRole("button", { name: "Update" });
  // System's buttons are the machine's own: under General, by the overview — not a card.
  expect(within(category("General")).getByRole("button", { name: "Update" })).toBe(update);
  expect(within(category("General")).getByRole("button", { name: "Reboot" })).toBeInTheDocument();
  expect(within(category("Tools")).queryByText("System")).not.toBeInTheDocument();
  // The machine's package manager decides the command, shown on hover.
  expect(update.title).toContain("$ sudo apt-get update && sudo apt-get -y dist-upgrade");
  fireEvent.click(update);

  expect(await screen.findByText("Update — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update")).toBeInTheDocument();
});

test("an action that is hard to undo asks first", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  fireEvent.click(await screen.findByRole("button", { name: "Reboot" }));
  expect(screen.getByText("Everything on it stops until it is back up.")).toBeInTheDocument();
  expect(screen.queryByText(/shell at/)).not.toBeInTheDocument();

  // The dialog's own Reboot, after the tool's.
  fireEvent.click(screen.getAllByRole("button", { name: "Reboot" }).at(-1)!);
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=reboot")).toBeInTheDocument();
});

test("a row of the Running list gets the buttons of the tools that apply", async () => {
  sshSetUp();
  renderPage("/machines/nas/running");

  const row = (await screen.findByText("plex-1")).closest("tr") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Restart" }));

  expect(await screen.findByText("Restart plex-1 — Storage box")).toBeInTheDocument();
  expect(
    screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=services&action=restart-container&target=plex-1"),
  ).toBeInTheDocument();
});

// --- The running list's buttons (Phase 43) ---

test("a port on the running list adds a route there, already picked; a routed one shows its name", async () => {
  sshSetUp();
  runningReply = {
    nas: {
      ok: true, checked: 0, services: [], guests: [], listening: [], denied: [],
      containers: [
        { name: "plex-1", image: "plex", status: "Up", ports: [32400] },
        { name: "web", image: "nginx", status: "Up", ports: [8080] },
      ],
    },
  };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "2 running" }));
  const card = screen.getByRole("dialog", { name: "Running" });
  // plex is routed at 192.168.10.50:32400 already: its name, not a button.
  expect(within(card).getByRole("link", { name: "plex.example.no" })).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: ":8080" }));

  expect(await screen.findByRole("combobox", { name: "Host" })).toHaveValue("192.168.10.50");
  expect(screen.getByRole("textbox", { name: "Port" })).toHaveValue("8080");
  expect(screen.getByPlaceholderText("grafana")).toHaveValue("web");
});

test("a Proxmox guest on the running list is named from there, or shows the machine it is", async () => {
  sshSetUp();
  sshHosts = { ...sshHosts, pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  sshTrusted = { nas: true, pve: true };
  runningReply = {
    pve: {
      ok: true, checked: 0, containers: [], services: [], listening: [], denied: [],
      guests: [
        // Already the machine "Storage box", at 192.168.10.50.
        { id: "101", name: "NAS", kind: "vm", addresses: ["192.168.10.50"] },
        // A Docker bridge first: the address on the host's network is the one filled in.
        { id: "102", name: "Home Assistant", kind: "lxc", addresses: ["172.17.0.1", "192.168.10.60"] },
      ],
    },
  };
  renderPage();

  const pveRow = (await screen.findByText("pve")).closest("tr") as HTMLElement;
  fireEvent.click(await within(pveRow).findByRole("button", { name: "2 running" }));
  const card = screen.getByRole("dialog", { name: "Running" });
  expect(card).toHaveTextContent("nas.example.no");
  fireEvent.click(within(card).getByRole("button", { name: "Name" }));

  expect(await screen.findByPlaceholderText("rack1.vm3")).toHaveValue("home-assistant");
  expect(screen.getByPlaceholderText("192.168.10.50")).toHaveValue("192.168.10.60");
});

test("a tool the machine lacks is offered to add, when Loskai can install what it needs", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  await screen.findByRole("button", { name: "Update" });
  // Proxmox needs pct, which only comes with Proxmox: not offered, and no Reboot on rows.
  expect(screen.queryByText("Proxmox")).not.toBeInTheDocument();
  expect(within(category("Tools")).queryByRole("button", { name: "Log" })).not.toBeInTheDocument();
  // The ones Loskai can add are behind Add tool, on the Tools heading.
  fireEvent.click(within(category("Tools")).getByRole("button", { name: "Add tool" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Versions.*installs kubectl/ }));

  expect(await screen.findByText("Add Versions — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=versions&install=true")).toBeInTheDocument();
});

test("a set-up machine's row has a Tools menu: each added tool, how it stands, in a dialog", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  // The machine's overview is read once the menu is open.
  expect(await screen.findByRole("menuitem", { name: /Claude Code.*2 projects, 1 running/ })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /Versions.*not added/ })).toBeInTheDocument();
  // System is standard: on the machine's page, not in the menu.
  expect(screen.queryByRole("menuitem", { name: /System/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: /tmux/ }));

  expect(await screen.findByText("tmux — Storage box")).toBeInTheDocument();
  expect(await screen.findByText("build")).toBeInTheDocument();
  // It is added: what it needs is only shown to add it.
  expect(screen.queryByText("Needs")).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByText("build").closest("li") as HTMLElement).getByRole("button", { name: "Attach" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=attach&target=build")).toBeInTheDocument();
});

test("a tool's dialog has a Settings button to the machine's page; Claude Code's says where the projects are", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Claude Code/ }));
  expect(await screen.findByText("site")).toBeInTheDocument();
  expect(screen.getByText("~/projects/")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Machine" }));

  // The machine's dialog, where the folder is set under Git's cog — the tool's own dialog closed.
  fireEvent.click(await within(await screen.findByRole("region", { name: "Tools" })).findByRole("button", { name: "Git settings" }));
  expect(await within(await screen.findByRole("dialog", { name: "Git settings" })).findByLabelText("Projects folder")).toHaveValue("~/projects");
  expect(screen.queryByText("~/projects/")).not.toBeInTheDocument();
});

test("the Git card's cog opens its settings — the machine's commit name and email — and sets one", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  // Not on the card itself: who commits are by is beside its summary.
  expect(within(tools).queryByLabelText("Name")).toBeNull();
  expect(await within(tools).findByText(/as Ola Nordmann/)).toBeInTheDocument();
  fireEvent.click(within(tools).getByRole("button", { name: "Git settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Git settings" });
  expect(within(dialog).getByLabelText("Projects folder")).toHaveValue("~/projects");
  expect(within(dialog).getByLabelText("Name")).toHaveValue("Ola Nordmann");
  const email = within(dialog).getByLabelText("Email");
  expect(email).toHaveValue("");
  fireEvent.change(email, { target: { value: "ola@example.no" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Git settings" })).toBeNull());
  // Only what changed is written.
  expect(calls.filter((c) => c.method === "PUT")).toEqual([{
    path: "/api/ssh/machines/nas/tools/git/settings/email", method: "PUT", body: { value: "ola@example.no" },
  }]);
  expect(within(tools).getByRole("button", { name: "Git settings" }).title).toContain("Email ola@example.no");
});

test("a project's cog opens a dialog that sets its own commit email, the global one shown while it has none", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  const cog = await within(tools).findByRole("button", { name: "Project overrides for site" });
  fireEvent.click(cog);
  // Opened once the settings are read again: never the locked error it had.
  const dialog = await screen.findByRole("dialog", { name: "Project overrides for site" });
  expect(within(dialog).queryByText(/locked/)).toBeNull();
  expect(within(dialog).getByLabelText("Name")).toHaveAttribute("placeholder", "Ola Nordmann");
  expect(within(dialog).getByLabelText("Name")).toBeEnabled();
  const email = within(dialog).getByLabelText("Email");
  expect(email).toHaveAttribute("placeholder", "not set");
  const save = within(dialog).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled(); // nothing changed yet
  fireEvent.change(email, { target: { value: "ola@work.example" } });
  fireEvent.click(save);

  await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Project overrides for site" })).toBeNull());
  // Only the field changed is written.
  expect(calls.filter((c) => c.method === "PUT" && c.path.includes("/settings/"))).toEqual([{
    path: "/api/ssh/machines/nas/tools/git/settings/project-email", method: "PUT",
    body: { value: "ola@work.example", target: "site" },
  }]);
  // Set, its cog says so; the card's own Email is untouched.
  expect(cog).toHaveAttribute("title", "Project overrides — Email ola@work.example");
  expect(within(tools).getByRole("button", { name: "Git settings" }).title).toContain("Email not set");
});

test("Git's Pull all and Push all are together at its list's foot, ahead of Clone", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  const pullAll = await within(tools).findByRole("button", { name: "Pull all" });
  const pushAll = within(tools).getByRole("button", { name: "Push all" });
  expect(pushAll.parentElement).toBe(pullAll.parentElement);
  // After the projects; before Clone's field, which is first on a phone and left on a wider screen.
  const site = within(tools).getAllByText("site").at(-1)!;
  expect(site.compareDocumentPosition(pullAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const clone = within(tools).getByRole("button", { name: "Clone" });
  expect(pullAll.compareDocumentPosition(clone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(pushAll);
  await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/run") && String(JSON.stringify(c.body)).includes("push-all"))).toBe(true));
});

test("a project's settings dialog cancelled writes nothing", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  fireEvent.click(await screen.findByRole("button", { name: "Project overrides for site" }));
  const dialog = await screen.findByRole("dialog", { name: "Project overrides for site" });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Someone" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "Project overrides for site" })).toBeNull();
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
});

test("a setting changed is in the machine's log, with what it was set to", async () => {
  sshSetUp();
  renderPage("/machines/nas/log");

  expect(await within(await screen.findByRole("region", { name: "Log" })).findByText("Set git › email to ola@example.no")).toBeInTheDocument();
});

test("with Loskai's key locked, the Git card's cog asks for your password, then opens its settings", async () => {
  sshSetUp();
  gitStatus = 423;
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  const cog = await within(tools).findByRole("button", { name: "Git settings" });
  await vi.waitFor(() => expect(cog.title).toContain("Name (locked)"));
  // Opening the card asks nothing.
  expect(screen.queryByRole("dialog", { name: "Unlock Loskai's key" })).toBeNull();
  fireEvent.click(cog);
  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  fireEvent.change(within(prompt).getByLabelText("Your password"), { target: { value: "admin-pw" } });
  gitStatus = 200;
  fireEvent.click(within(prompt).getByRole("button", { name: "Unlock" }));

  // Opened once what was read while it was locked is read again.
  const dialog = await screen.findByRole("dialog", { name: "Git settings" });
  expect(within(dialog).getByLabelText("Name")).toHaveValue("Ola Nordmann");
  expect(calls.find((c) => c.path === "/api/ssh/unlock")?.body).toEqual({ password: "admin-pw" });
  expect(screen.queryByRole("dialog", { name: "Unlock Loskai's key" })).toBeNull();
});

test("with Loskai's key locked, a project's cog asks for your password, then opens its settings", async () => {
  sshSetUp();
  gitStatus = 423;
  renderPage("/machines/nas/tools");

  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Git settings" }).title).toContain("(locked)"));
  fireEvent.click(screen.getByRole("button", { name: "Project overrides for site" }));
  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  fireEvent.change(within(prompt).getByLabelText("Your password"), { target: { value: "admin-pw" } });
  gitStatus = 200;
  fireEvent.click(within(prompt).getByRole("button", { name: "Unlock" }));

  // Opened once the settings are read again: never the locked error it had.
  const dialog = await screen.findByRole("dialog", { name: "Project overrides for site" });
  expect(within(dialog).queryByText(/locked/)).toBeNull();
  expect(within(dialog).getByLabelText("Name")).toHaveAttribute("placeholder", "Ola Nordmann");
  expect(within(dialog).getByLabelText("Name")).toBeEnabled();
});

test("a change refused because the key locked meanwhile asks for your password, then is sent again", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");
  const tools = await screen.findByRole("region", { name: "Tools" });
  fireEvent.click(await within(tools).findByRole("button", { name: "Git settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Git settings" });
  const email = within(dialog).getByLabelText("Email");
  let refused = false;
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) =>
    path.endsWith("/settings/email") && !refused
      ? ((refused = true), Promise.resolve(json({ detail: "Loskai's key is locked — enter your password" }, 423)))
      : real(path, init),
  );
  fireEvent.change(email, { target: { value: "ola@example.no" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  const prompt = await screen.findByRole("dialog", { name: "Unlock Loskai's key" });
  fireEvent.change(within(prompt).getByLabelText("Your password"), { target: { value: "admin-pw" } });
  fireEvent.click(within(prompt).getByRole("button", { name: "Unlock" }));

  // The second, sent again.
  await vi.waitFor(() => expect(calls.filter((c) => c.path.endsWith("/settings/email"))).toHaveLength(1));
});

test("Tailscale is two switches — connected, and sharing — with the tailnet folded under them", async () => {
  sshSetUp();
  facts = { ...FACTS, tailscale_self: { state: "on", shared: [], approved: [] } };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Tailscale.*100\.64\.0\.7$/ }));

  expect(await screen.findByRole("switch", { name: "Connected" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Share this network" })).not.toBeChecked();
  // No row of buttons: each switch runs its action.
  expect(screen.queryByRole("button", { name: "Connect" })).not.toBeInTheDocument();
  // The rest of the tailnet, folded: this machine isn't among the others.
  expect(screen.queryByText("phone")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Tailnet · 1 other device, 0 online/ }));
  // On the name, not across the row.
  expect(screen.getByText("phone").closest<HTMLElement>("[title]")!.title).toBe("iOS · offline");
  expect(screen.getByText("phone").closest("li")!.title).toBe("");

  fireEvent.click(screen.getByRole("switch", { name: "Share this network" }));
  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/ssh/machines/nas/run")?.body).toMatchObject({ tool: "tailscale", action: "share" }),
  );
});

test("on a status line before v9, sharing has no switch, only how to see it", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Tailscale/ }));

  expect(await screen.findByRole("switch", { name: "Connected" })).toBeChecked();
  expect(screen.getByText(/Install again, under SSH, to see and change it/)).toBeInTheDocument();
  expect(screen.queryByRole("switch", { name: "Share this network" })).not.toBeInTheDocument();
});

test("Tailscale waiting for approval reads the same in the overview as on its card", async () => {
  sshSetUp();
  facts = { ...FACTS, tailscale_self: { state: "approval", shared: [], approved: [] } };
  renderPage("/machines/nas");

  await screen.findByRole("region", { name: "General" });
  expect(await within(category("General")).findByText("waiting for approval")).toBeInTheDocument();
  expect(within(category("General")).queryByText("100.64.0.7")).toBeNull();
  expect(within(category("Tools")).getByText("waiting for approval")).toBeInTheDocument();
});

test("Tailscale off, or logged out, offers only to connect", async () => {
  sshSetUp();
  facts = { ...FACTS, tailscale: null, tailscale_self: { state: "login", shared: [], approved: [] } };
  try {
    renderPage();
    await screen.findByText("Storage box");

    fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Tailscale.*logged out/ }));

    const connected = await screen.findByRole("switch", { name: "Connected" });
    expect(connected).not.toBeChecked();
    expect(screen.getByText(/Logged out — connecting shows a link/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Share this network" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tailnet/ })).not.toBeInTheDocument();

    fireEvent.click(connected);
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === "/api/ssh/machines/nas/run")?.body).toMatchObject({ tool: "tailscale", action: "up" }),
    );
  } finally {
    facts = FACTS;
  }
});

test("Tailscale says which networks it shares, and which wait for approval", async () => {
  sshSetUp();
  facts = { ...FACTS, tailscale_self: { state: "on", shared: ["192.168.10.0/24", "10.0.0.0/24"], approved: ["192.168.10.0/24"] } };
  try {
    renderPage();
    await screen.findByText("Storage box");

    fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Tailscale.*sharing 192\.168\.10\.0\/24, 10\.0\.0\.0\/24/ }));

    expect(await screen.findByRole("switch", { name: "Share this network" })).toBeChecked();
    const shared = screen.getByText("192.168.10.0/24").parentElement as HTMLElement;
    expect(within(shared).getByRole("link", { name: "Split DNS" })).toHaveAttribute("href", "https://login.tailscale.com/admin/dns");
    const waiting = screen.getByText("10.0.0.0/24").parentElement as HTMLElement;
    expect(waiting).toHaveTextContent("waiting for approval");
    expect(within(waiting).getByRole("link", { name: "Approve" })).toHaveAttribute("href", "https://login.tailscale.com/admin/machines");
  } finally {
    facts = FACTS;
  }
});

test("a tool's dialog on an older status line goes straight to installing it again", async () => {
  sshSetUp();
  facts = { ok: false, old: true, checked: 0, error: "Its status line is older than this Loskai — install again" };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /tmux/ }));
  fireEvent.click(await screen.findByRole("link", { name: "Install again" }));

  // The machine's page, its SSH setup open.
  expect(await screen.findByText(/SSH — Storage box/)).toBeInTheDocument();
});

test("a tool's dialog whose request fails says why, and links to the machine's settings", async () => {
  sshSetUp();
  factsStatus = 409;
  facts = { detail: "Storage box has no SSH user" };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /tmux/ }));

  // Not a spinner that never stops.
  expect(await screen.findByText("Storage box has no SSH user")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  expect(await screen.findByRole("dialog", { name: "Storage box" })).toBeInTheDocument();
});

test("a tool the machine lacks opens to what it needs, and adds it", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Versions/ }));

  expect(await screen.findByText("Versions — Storage box")).toBeInTheDocument();
  expect(screen.getByText("kubectl")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Add Versions — installs kubectl/ }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=versions&install=true")).toBeInTheDocument();
});

test("a tool's card lists its rows, each with its buttons — not another tool's sessions", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const row = (await screen.findByText("build")).closest("li") as HTMLElement;
  // claude-site is Claude Code's, on its project.
  expect(screen.queryByText("claude-site")).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Attach" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=attach&target=build")).toBeInTheDocument();
});

test("an action that asks for a name runs on what is typed", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const name = await screen.findByLabelText("New session — name");
  expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
  fireEvent.change(name, { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=new&target=work")).toBeInTheDocument();
});

test("Clone asks for a repository's address and runs on it; Git's card has the projects too", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const address = await screen.findByLabelText("Clone — repository");
  expect(address).toHaveAttribute("placeholder", "https://… or git@host:path");
  fireEvent.change(address, { target: { value: "git@github.com:simplysunde/loskai.git" } });
  fireEvent.click(screen.getByRole("button", { name: "Clone" }));
  expect(
    await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=clone&target=git%40github.com%3Asimplysunde%2Floskai.git"),
  ).toBeInTheDocument();
});

// Git's view of the keys, from Keys in its card's header.
async function gitKeys() {
  const tools = await screen.findByRole("region", { name: "Tools" });
  fireEvent.click(await within(tools).findByRole("button", { name: "Keys" }));
  return screen.findByRole("dialog", { name: "SSH keys" });
}

// Every key, plainly, from the machine's SSH settings — its Keys row.
async function machineKeys() {
  const ssh = await screen.findByRole("region", { name: "SSH" });
  fireEvent.click(await within(ssh).findByRole("button", { name: /^Keys( \(|$)/ }));
  return screen.findByRole("dialog", { name: "SSH keys" });
}

const names = (el: HTMLElement) => within(el).getAllByRole("listitem").map((li) => li.querySelector(".font-mono")?.textContent);

test("Git's Keys: git's keys — the remotes each is for, a Test, where to add it — Copy puts one on the clipboard", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const dialog = await gitKeys();
  expect(dialog).toHaveTextContent("SSH keys for git");
  const row = (name: string) => within(dialog).getByText(name).closest("li") as HTMLElement;
  // Account keys and deploy keys: the account key, and `work` — a key for github.com, which
  // site's submodule pushes with through ~/.ssh/config's gh-page; blog's deploy key.
  const section = (name: string) => within(dialog).getByRole("region", { name });
  expect(names(section("Account keys"))).toEqual(["id_ed25519", "work"]);
  expect(names(section("Deploy keys"))).toEqual(["deploy_blog"]);
  // A login key isn't git's: a line, no more.
  expect(within(dialog).queryByText("server")).toBeNull();
  expect(dialog).toHaveTextContent("1 more key on this machine, not git's — in its SSH settings.");
  // What each does, in a line a remote.
  expect(row("id_ed25519")).toHaveTextContent("Fetches and pushes projects/site · github.com");
  expect(row("deploy_blog")).toHaveTextContent("Fetches and pushes projects/blog · forgejo.lan");
  expect(row("deploy_blog")).toHaveTextContent("me/blog");
  expect(row("work")).toHaveTextContent("Pushes projects/site › public/page · github.com via gh-page");
  expect(within(row("work")).getByText("~/.ssh/config")).toBeInTheDocument();
  expect(row("work")).not.toHaveTextContent("Fetches");
  // The fingerprint, shortened; whole in its tooltip.
  expect(within(row("id_ed25519")).getByTitle("ED25519 256: SHA256:mach")).toBeInTheDocument();
  // Git's buttons only — Copy and Test — the same on every row; Label and Delete are the
  // machine's, in its SSH settings.
  for (const li of within(dialog).getAllByRole("listitem")) {
    const name = li.querySelector(".font-mono")?.textContent;
    // A hint is a button too; these are the row's actions.
    const buttons = within(li).getAllByRole("button").filter((b) => !b.hasAttribute("data-hint"));
    expect(buttons).toHaveLength(2);
    ["Copy", "Test"].forEach((verb, i) => expect(buttons[i]).toHaveAccessibleName(`${verb} ${name}`));
  }
  // An account key exists: no New account key.
  expect(within(dialog).queryByRole("button", { name: "New account key" })).toBeNull();

  // Copy: its public line and comment, from the overview — nothing runs on the machine.
  fireEvent.click(within(row("deploy_blog")).getByRole("button", { name: "Copy deploy_blog" }));
  await vi.waitFor(() => expect(vi.mocked(copyText)).toHaveBeenLastCalledWith("ssh-ed25519 AAAAblog loskai@nas blog"));
  expect(screen.queryByText(/shell at/)).toBeNull();
  // Add it: a deploy key's repository, from its remote; the account key's platform.
  expect(within(row("deploy_blog")).getByRole("link", { name: /Add to repository/ })).toHaveAttribute("href", "https://forgejo.lan/me/blog/settings/keys");
  expect(within(row("id_ed25519")).getByRole("link", { name: /Add to GitHub/ })).toHaveAttribute("href", "https://github.com/settings/ssh/new");
});

test("the machine's SSH settings: Keys beside SSH setup lists every key plainly — what for, Copy, Label, Delete", async () => {
  sshSetUp();
  renderPage("/machines/nas/ssh");
  const ssh = await screen.findByRole("region", { name: "SSH" });
  const keys = await within(ssh).findByRole("button", { name: /Keys \(4\)/ });
  expect(keys).toHaveAttribute("title", "Its own SSH keys: 4 keys: 2 account, 1 deploy, 1 login");
  expect(within(ssh).getByRole("button", { name: "SSH setup" })).toBeInTheDocument();
  fireEvent.click(keys);
  const dialog = await screen.findByRole("dialog", { name: "SSH keys" });
  expect(dialog).toHaveTextContent("Every key of the user Loskai logs in as");
  // Not Loskai's own, which logs in the other way: said, and where it is.
  expect(dialog).toHaveTextContent("Loskai's own key isn't here: it logs in to this machine, from Loskai — see SSH setup.");
  const row = (name: string) => within(dialog).getByText(name).closest("li") as HTMLElement;
  // One plain list, git's first: what each is for, in a word or two.
  expect(names(dialog)).toEqual(["id_ed25519", "work", "deploy_blog", "server"]);
  expect(row("id_ed25519")).toHaveTextContent("Account · github.com");
  expect(row("deploy_blog")).toHaveTextContent("Deploy · me/blog");
  expect(row("server")).toHaveTextContent("Login");
  // Its comment without the mark.
  expect(row("server")).toHaveTextContent("admin@nas ·");
  expect(row("server")).not.toHaveTextContent("(loskai:");
  // Nothing of git's: no remotes, no Test, no host field, no Add to.
  expect(dialog).not.toHaveTextContent("Fetches");
  expect(within(dialog).queryByRole("link", { name: /Add to/ })).toBeNull();
  expect(within(dialog).queryByLabelText("Host")).toBeNull();
  for (const li of within(dialog).getAllByRole("listitem")) {
    const name = li.querySelector(".font-mono")?.textContent;
    const buttons = within(li).getAllByRole("button").filter((b) => !b.hasAttribute("data-hint"));
    expect(buttons).toHaveLength(3);
    ["Copy", "Label", "Delete"].forEach((verb, i) => expect(buttons[i]).toHaveAccessibleName(`${verb} ${name}`));
  }
  // One ~/.ssh/config names is yours: Delete leaves it alone.
  const deleteWork = within(row("work")).getByRole("button", { name: "Delete work" });
  expect(deleteWork).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(deleteWork); // a tap says why, and deletes nothing
  expect(screen.getByRole("tooltip")).toHaveTextContent(/~\/\.ssh\/config/);
  expect(within(row("deploy_blog")).getByRole("button", { name: "Delete deploy_blog" })).toBeEnabled();
});

test("an account key no remote uses says why: the remotes there are over HTTP", async () => {
  sshSetUp();
  // Labelled an account key, so git's — though no remote here uses it.
  const labelled = FACTS.ssh_keys.map((k) => (k.name === "id_ed25519" ? { ...k, comment: "loskai@nas (loskai: account)" } : k));
  facts = { ...FACTS, ssh_keys: labelled, remotes: [{ path: "projects/site", module: "", kind: "url", url: "http://192.168.10.216:3000/me/site.git" }],
    ssh_hosts: {}, ssh_config_keys: [] };
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  const row = within(dialog).getByText("id_ed25519").closest("li") as HTMLElement;
  expect(within(dialog).getByRole("region", { name: "Account keys" })).toContainElement(row);
  fireEvent.click(within(row).getByRole("button", { name: "No git remote here uses it" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/^The remotes here are over HTTP\(S\), which needs no key\. It may still be on your account/);
  // ssh's own: what logs in to other computers, as far as anyone here can tell — said, not hidden.
  expect(row).toHaveTextContent("ssh's default — it may log in to other computers");
  expect(within(dialog).getByText("deploy_blog").closest("li")).not.toHaveTextContent("ssh's default");
  // Nothing says which platform it is for: its host field is empty, its Test waits for one —
  // where it came from, typed here, on this key's row alone.
  const host = within(row).getByLabelText("Host to test id_ed25519 on");
  expect(host).toHaveValue("");
  expect(within(row).getByRole("button", { name: "Test id_ed25519" })).toBeDisabled();
  fireEvent.change(host, { target: { value: "git.home.lan:2222" } });
  fireEvent.keyDown(host, { key: "Enter" });
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=key-on-host&target=id_ed25519%40git.home.lan%3A2222")).toBeInTheDocument();
  fireEvent.pointerDown(document.body); // a tap elsewhere closes the first hint
  fireEvent.click(within(within(dialog).getByText("deploy_blog").closest("li") as HTMLElement).getByRole("button", { name: "No git remote here uses it" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/^No remote here names it\./);
});

test("an account key no remote uses, where the SSH ones each have their own, says so", async () => {
  sshSetUp();
  // codebox: its one SSH address, a submodule's push, goes through an alias with its own key.
  const labelled = FACTS.ssh_keys.map((k) => (k.name === "id_ed25519" ? { ...k, comment: "loskai@nas (loskai: account)" } : k));
  facts = { ...FACTS, ssh_keys: labelled, remotes: [
    { path: "projects/site", module: "", kind: "url", url: "http://192.168.10.216:3000/me/site.git" },
    { path: "projects/site", module: "public/page", kind: "pushurl", url: "git@gh-page:me/page.git" },
  ], ssh_hosts: { "gh-page": { hostname: "github.com", identities_only: true, keys: ["work"] } }, ssh_config_keys: ["work"] };
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  const row = within(dialog).getByText("id_ed25519").closest("li") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "No git remote here uses it" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent(/^The remotes here over SSH each use a key of their own/);
});

test("a key's Test drops down over Keys, which stays — its answer the drop-down's Done or Failed", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  // Its own host field, filled with the platform its remotes go to.
  expect(within(dialog).getByLabelText("Host to test id_ed25519 on")).toHaveValue("github.com");
  expect(within(dialog).getByLabelText("Host to test deploy_blog on")).toHaveValue("forgejo.lan");
  fireEvent.click(within(dialog).getByRole("button", { name: "Test id_ed25519" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=key-on-host&target=id_ed25519%40github.com")).toBeInTheDocument();
  // Automatic: the drop-down, not a dialog of its own.
  const terminal = screen.getByRole("region", { name: "Test: id_ed25519 on github.com — Storage box" });
  expect(screen.queryByRole("dialog", { name: /Test: id_ed25519/ })).toBeNull();
  // Keys is still there, under it; closing the drop-down comes back to it.
  expect(screen.getByRole("dialog", { name: "SSH keys" })).toBe(dialog);
  fireEvent.click(within(terminal).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: /Test: id_ed25519/ })).toBeNull());
  expect(screen.getByRole("dialog", { name: "SSH keys" })).toBeInTheDocument();
});

test("a key's Test, while Keys is open: a ✓ in its field's place, and no Add to …; a ✗ keeps both", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  const row = (name: string) => within(dialog).getByText(name).closest("li") as HTMLElement;
  expect(within(row("deploy_blog")).getByRole("link", { name: /Add to repository/ })).toBeInTheDocument();

  fireEvent.click(within(row("deploy_blog")).getByRole("button", { name: "Test deploy_blog" }));
  fireEvent.click(await screen.findByRole("button", { name: "end: done" }));
  // It got in: the field and its Test give way to the answer, in their place.
  const passed = await within(row("deploy_blog")).findByRole("button", { name: "Tested deploy_blog: it gets in on forgejo.lan — test again" });
  expect(passed).toHaveTextContent("forgejo.lan");
  // An arrow at its end: clicked, it tests again.
  expect(passed.querySelector("svg.lucide-rotate-cw")).not.toBeNull();
  expect(within(row("deploy_blog")).queryByLabelText("Host to test deploy_blog on")).toBeNull();
  expect(within(row("deploy_blog")).queryByRole("link", { name: /Add to/ })).toBeNull();
  fireEvent.click(within(screen.getByRole("region", { name: /Test: deploy_blog/ })).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: /Test: deploy_blog/ })).toBeNull());
  // Clicked: the field again, to test once more or elsewhere.
  fireEvent.click(passed);
  expect(within(row("deploy_blog")).getByLabelText("Host to test deploy_blog on")).toHaveValue("forgejo.lan");

  fireEvent.click(within(row("id_ed25519")).getByRole("button", { name: "Test id_ed25519" }));
  fireEvent.click(await screen.findByRole("button", { name: "end: failed" }));
  // Refused: the field stays — another host, or adding it, comes next — and so does Add to.
  // Said in words beside the field, not only by its red border; the host in its hint.
  const refused = await within(row("id_ed25519")).findByRole("button", { name: "refused" });
  fireEvent.click(refused);
  expect(screen.getByRole("tooltip")).toHaveTextContent("github.com refused it just now");
  fireEvent.pointerDown(document.body);
  expect(within(row("id_ed25519")).getByLabelText("Host to test id_ed25519 on")).toBeInTheDocument();
  expect(within(row("id_ed25519")).getByRole("link", { name: /Add to GitHub/ })).toBeInTheDocument();
});

test("a host tested before is offered in every host field, newest first, and forgotten with its ✕", async () => {
  localStorage.removeItem("loskai-recent-hosts");
  sshSetUp();
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  const field = (name: string) => within(dialog).getByLabelText(`Host to test ${name} on`);

  // Tested on two hosts: id_ed25519's row, then the field under the list.
  fireEvent.change(field("id_ed25519"), { target: { value: "git.home.lan:2222" } });
  fireEvent.keyDown(field("id_ed25519"), { key: "Enter" });
  fireEvent.click(within(await screen.findByRole("region", { name: /Test: id_ed25519/ })).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: /Test: id_ed25519/ })).toBeNull());
  fireEvent.change(within(dialog).getByLabelText("Host"), { target: { value: "codeberg.org" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Test key" }));
  fireEvent.click(within(await screen.findByRole("region", { name: /Test key: codeberg.org/ })).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(screen.queryByRole("region", { name: /Test key/ })).toBeNull());

  // Another key's field, clicked into: both, newest first.
  fireEvent.change(field("deploy_blog"), { target: { value: "" } });
  fireEvent.focus(field("deploy_blog"));
  const offered = screen.getByRole("list", { name: "Hosts tested before" });
  expect(within(offered).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["codeberg.org", "git.home.lan:2222"]);
  fireEvent.click(within(offered).getByRole("button", { name: "git.home.lan:2222" }));
  expect(field("deploy_blog")).toHaveValue("git.home.lan:2222");
  expect(screen.queryByRole("list", { name: "Hosts tested before" })).toBeNull();

  // One no longer wanted: forgotten, here and in the browser.
  fireEvent.focus(field("id_ed25519"));
  fireEvent.change(field("id_ed25519"), { target: { value: "" } });
  fireEvent.click(within(screen.getByRole("list", { name: "Hosts tested before" })).getByRole("button", { name: "Forget codeberg.org" }));
  expect(within(screen.getByRole("list", { name: "Hosts tested before" })).getAllByRole("listitem").map((li) => li.textContent))
    .toEqual(["git.home.lan:2222"]);
  expect(JSON.parse(localStorage.getItem("loskai-recent-hosts")!)).toEqual(["git.home.lan:2222"]);
});

test("Label, on a key: what it is for, picked in a dialog and written on the key", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");
  const dialog = await machineKeys();
  fireEvent.click(within(dialog).getByRole("button", { name: "Label id_ed25519" }));
  const label = await screen.findByRole("dialog", { name: "Label id_ed25519" });
  // An account key, for a platform: its field; a deploy key, a project — needed before Label.
  fireEvent.change(within(label).getByLabelText("Platform"), { target: { value: "github.com" } });
  fireEvent.click(within(label).getByLabelText(/^Deploy key/));
  expect(within(label).getByRole("button", { name: "Label" })).toBeDisabled();
  fireEvent.click(within(label).getByLabelText(/^Account key/));
  fireEvent.click(within(label).getByRole("button", { name: "Label" }));
  expect(screen.queryByRole("dialog", { name: "Label id_ed25519" })).toBeNull();
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=label-key&target=id_ed25519%40for%3Agithub.com")).toBeInTheDocument();
  // Keys stays, under it.
  expect(screen.getByRole("dialog", { name: "SSH keys" })).toBeInTheDocument();
});

test("a machine whose ssh config has Match exec: Git's Keys says which remotes use which key wasn't asked", async () => {
  sshSetUp();
  facts = { ...FACTS, ssh_hosts: {}, ssh_match_exec: true };
  renderPage("/machines/nas/tools");
  expect(await gitKeys()).toHaveTextContent("This machine's ssh config may run a command to choose keys (Match exec");
});

test("Delete, in Keys, asks first and then runs on the key", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const dialog = await machineKeys();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete deploy_blog" }));
  expect(await screen.findByText("Its file goes for good.")).toBeInTheDocument();
  expect(screen.queryByText(/shell at .*delete-key/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=delete-key&target=deploy_blog")).toBeInTheDocument();
});

test("Test key, in Keys, asks for a host — a plug, not a plus — and runs on it; Settings has neither", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  fireEvent.click(await within(tools).findByRole("button", { name: "Git settings" }));
  const settings = await screen.findByRole("dialog", { name: "Git settings" });
  expect(within(settings).queryByRole("button", { name: "Test key" })).toBeNull();
  fireEvent.click(within(settings).getByRole("button", { name: "Cancel" }));

  const dialog = await gitKeys();
  // One host field, for each action that asks for a host — none runs until one is typed.
  expect(within(dialog).getAllByLabelText("Host")).toHaveLength(1);
  const host = within(dialog).getByLabelText("Host");
  expect(host).toHaveAttribute("placeholder", "github.com");
  const button = within(dialog).getByRole("button", { name: "Test key" });
  for (const name of ["New key for a host", "Test key", "Try every key"]) {
    expect(within(dialog).getByRole("button", { name })).toBeDisabled();
  }
  expect(button.querySelector("svg")).toHaveClass("lucide-plug-zap");
  fireEvent.change(host, { target: { value: "git.home.lan:2222" } });
  fireEvent.click(button);
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=test-key&target=git.home.lan%3A2222")).toBeInTheDocument();
});

test("New key for a host, in Keys, makes one for the host typed", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  fireEvent.change(within(dialog).getByLabelText("Host"), { target: { value: "github.com" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "New key for a host" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=host-key&target=github.com")).toBeInTheDocument();
});

test("Keys offers New account key while there is none, and says when the status line can't list them", async () => {
  sshSetUp();
  facts = { ...FACTS, ssh_keys: [] };
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  expect(within(dialog).getByText("No SSH key here yet.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "New account key" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=ssh-key")).toBeInTheDocument();
});

test("an older status line: Keys says to install it again — for the keys, or for where they are used", async () => {
  sshSetUp();
  facts = { ...FACTS, ssh_keys: null };
  renderPage("/machines/nas/tools");
  expect(within(await gitKeys()).getByText(/status line is older than this Loskai/)).toBeInTheDocument();
});

test("a line with the keys but not the remotes lists them, and says where they're used needs it installed again", async () => {
  sshSetUp();
  facts = { ...FACTS, remotes: null, ssh_hosts: null, ssh_config_keys: null };
  renderPage("/machines/nas/tools");
  const dialog = await gitKeys();
  // Git's two — ssh's own, and the deploy key.
  expect(within(dialog).getAllByText("Install the status line again to see where it's used.")).toHaveLength(2);
});

test("a project's cog says which key it uses — its own teal like its own name — with Own key and Machine's key", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  const tools = await screen.findByRole("region", { name: "Tools" });
  // Not on the project's row.
  const siteRow = within(tools).getAllByText("site").map((el) => el.closest("li") as HTMLElement).find((li) => within(li).queryByRole("button", { name: "Pull" }))!;
  expect(within(siteRow).queryByRole("button", { name: "Own key" })).toBeNull();
  // blog has its own key: its cog is teal, and says so.
  const blogCog = await within(tools).findByRole("button", { name: "Project overrides for blog" });
  await vi.waitFor(() => expect(blogCog).toHaveClass("text-teal-300"));
  expect(blogCog.title).toContain("SSH key deploy_blog");
  fireEvent.click(blogCog);
  const blog = await screen.findByRole("dialog", { name: "Project overrides for blog" });
  expect(within(blog).getByLabelText("SSH key")).toHaveTextContent("Uses its own key, deploy_blog · SHA256:blog");
  // The one button that applies: back to the machine's — no list of actions beside it.
  expect(within(blog).getByRole("button", { name: /Back to the machine's key/ })).toBeEnabled();
  expect(within(blog).queryByRole("button", { name: /Give it its own key/ })).toBeNull();
  expect(within(blog).queryByText("Actions")).toBeNull();
  fireEvent.click(within(blog).getByRole("button", { name: "Cancel" }));

  fireEvent.click(within(tools).getByRole("button", { name: "Project overrides for site" }));
  const site = await screen.findByRole("dialog", { name: "Project overrides for site" });
  expect(within(site).getByLabelText("SSH key")).toHaveTextContent("Uses the machine's key.");
  fireEvent.click(within(site).getByRole("button", { name: /Give it its own key/ }));
  expect(screen.queryByRole("dialog", { name: "Project overrides for site" })).toBeNull();
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=git&action=own-key&target=site")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: /Own key: site — Storage box/ })).toBeInTheDocument();
});

test("a project whose remote is over HTTP: no SSH key is used, which its overrides say, the button greyed", async () => {
  sshSetUp();
  facts = { ...FACTS, remotes: [{ path: "projects/site", module: "", kind: "url", url: "http://192.168.10.216:3000/me/site.git" }] };
  renderPage("/machines/nas/tools");
  const tools = await screen.findByRole("region", { name: "Tools" });
  fireEvent.click(await within(tools).findByRole("button", { name: "Project overrides for site" }));
  const site = await screen.findByRole("dialog", { name: "Project overrides for site" });
  expect(within(site).getByRole("button", { name: /Give it its own key/ })).toHaveAttribute("aria-disabled", "true");
  expect(site).toHaveTextContent("Its remote is over HTTP(S), which uses no SSH key — switch it to its SSH address first.");
});

test("a name typed for an action that asks first is kept when that is cancelled", async () => {
  sshSetUp();
  toolsReply = TOOLS.map((t) => ({
    ...t,
    actions: t.actions.map((a) => ("ask" in a && a.ask === "session" ? { ...a, confirm: "Start it?" } : a)),
  }));
  renderPage("/machines/nas/tools");

  const name = await screen.findByLabelText("New session — name");
  fireEvent.change(name, { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(screen.getByLabelText("New session — name")).toHaveValue("work");
});

test("a project lists in its machine's projects folder, says its Claude session runs, and attaches to it", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  // On Claude Code's card and on Git's, each with its own buttons.
  const rows = (await screen.findAllByText("site")).map((el) => el.closest("li") as HTMLElement);
  const row = rows.find((r) => within(r).queryByRole("button", { name: "Attach" }))!;
  const gitRow = rows.find((r) => within(r).queryByRole("button", { name: "Pull" }))!;
  expect(rows).toHaveLength(2);
  expect(within(row).queryByRole("button", { name: "Pull" })).toBeNull();
  expect(within(gitRow).queryByRole("button", { name: "Attach" })).toBeNull();
  expect(within(row).getByText("running")).toBeInTheDocument(); // claude-site is a tmux session
  expect(row.textContent).toContain("main · 2 to push · uncommitted changes · committed");
  expect(within(row).getByTitle("Last commit: Add the header")).toHaveTextContent("site");
  expect(row.title).toBe("");
  // In ~ rather than ~/projects: not listed.
  expect(screen.queryByText("notes")).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Attach" }));

  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=claude&action=attach&target=site")).toBeInTheDocument();
});

test("a project's buttons follow its session in the same places: Attach, greyed while stopped; Start or Stop", async () => {
  sshSetUp();
  renderPage("/machines/nas/tools");

  await screen.findAllByText("blog");
  // Each project is on Git's card too, by its Pull.
  const claude = (name: string) =>
    screen.getAllByText(name).map((el) => el.closest("li") as HTMLElement).find((li) => !within(li).queryByRole("button", { name: "Pull" }))!;
  const buttons = (name: string) => within(claude(name)).getAllByRole("button").map((b) => b.textContent?.trim());
  expect(buttons("site")).toEqual(["Attach", "Stop"]);
  expect(buttons("blog")).toEqual(["Attach", "Start"]);
  expect(within(claude("site")).getByRole("button", { name: "Attach" })).toBeEnabled();
  const idle = within(claude("blog")).getByRole("button", { name: "Attach" });
  expect(idle).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(idle);
  expect(screen.getByRole("tooltip")).toHaveTextContent("Not running — Start it first");
  fireEvent.pointerDown(document.body);
});

test("Projects, from the Machines tab: each set-up machine's projects, their git and Claude together, run there", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
  const dialog = await screen.findByRole("dialog", { name: "Projects" });
  const nas = await within(dialog).findByRole("region", { name: "Storage box" });
  // Without SSH set up, pve isn't listed.
  expect(within(dialog).queryByRole("region", { name: "pve" })).toBeNull();
  // What the machine is, in a line: its address, Tailscale.
  expect(within(nas).getByText(/^192\.168\.10\.50 · Tailscale 100\.64\.0\.7$/)).toBeInTheDocument();

  // Each project once, a table: its git in columns, Git's buttons and Claude Code's by its session.
  // The column headings once, pinned above every machine (each table keeps them for a
  // screen reader).
  expect(within(dialog).getAllByText("Branch")).toHaveLength(2);
  expect(within(dialog).getAllByText("Branch")[0].closest("table")).toHaveAttribute("aria-hidden");
  const projects = within(nas).getByRole("table", { name: "Projects" });
  expect(within(projects).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
    ["Project", "Branch", "Changes", "Last commit", "Claude", "Actions"],
  );
  const row = (name: string) => within(nas).getByText(name).closest("tr") as HTMLElement;
  const buttons = (name: string) => within(row(name)).getAllByRole("button").map((b) => b.textContent?.trim()).sort();
  expect(await within(nas).findByText("running")).toBeInTheDocument();
  const cells = within(row("site")).getAllByRole("cell").map((c) => c.textContent);
  expect(cells.slice(0, 3)).toEqual(["siterunning", "main", "2 to push, uncommitted changes"]);
  expect(cells[3]).toMatch(/^committed \d+[mhd] ago$/);
  expect(within(row("site")).getAllByRole("cell")[3]).toHaveAttribute("title", "Last commit: Add the header");
  // No Claude yet: a dash, not an empty cell.
  expect(within(row("blog")).getAllByRole("cell")[4]).toHaveTextContent("—");
  expect(buttons("site")).toEqual(["Attach", "Pull", "Stop"]);
  expect(buttons("blog")).toEqual(["Attach", "Pull", "Start"]);
  expect(within(row("blog")).getByRole("button", { name: "Attach" })).toHaveAttribute("aria-disabled", "true");

  // Under them, its tmux sessions of your own — not Claude's, which is on its project — with
  // tmux's buttons.
  expect(within(nas).getByRole("heading", { name: "1 tmux session" })).toBeInTheDocument();
  const sessions = within(nas).getByRole("table", { name: "tmux sessions" });
  expect(within(sessions).getAllByRole("row").map((tr) => tr.querySelector(".font-mono")?.textContent)).toEqual(["build"]);
  // No headings of its own: its cells say what they are.
  expect(within(sessions).queryByRole("columnheader")).toBeNull();
  expect(within(row("build")).getAllByRole("cell")[1]).toHaveTextContent(/^2 windows$/);
  expect(within(row("build")).getAllByRole("cell")[2]).toHaveTextContent(/^started \d+[mhd] ago$/);
  fireEvent.click(within(sessions).getByRole("button", { name: "Attach" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=attach&target=build")).toBeInTheDocument();
});

test("Machine, in Projects, opens the machine's dialog over it; closing that comes back to Projects", async () => {
  sshSetUp();
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
  const nas = await within(await screen.findByRole("dialog", { name: "Projects" })).findByRole("region", { name: "Storage box" });

  fireEvent.click(within(nas).getByRole("link", { name: "Machine" }));
  const machine = await screen.findByRole("dialog", { name: "Storage box" });
  expect(screen.getByRole("dialog", { name: "Projects" })).toBeInTheDocument();
  // On top: drawn after it.
  expect(screen.getByRole("dialog", { name: "Projects" }).compareDocumentPosition(machine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.keyDown(document, { key: "Escape" });
  await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Storage box" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "Projects" })).toBeInTheDocument();
});

test("a project's buttons in Projects run in that machine's terminal", async () => {
  sshSetUp();
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
  const nas = await within(await screen.findByRole("dialog", { name: "Projects" })).findByRole("region", { name: "Storage box" });
  const site = (await within(nas).findByText("site")).closest("tr") as HTMLElement;
  fireEvent.click(within(site).getByRole("button", { name: "Attach" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=claude&action=attach&target=site")).toBeInTheDocument();
});

test("Projects lists only the machines with projects, beside a menu of them, and makes one on any machine", async () => {
  sshSetUp();
  sshHosts = { ...sshHosts, pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  sshTrusted = { nas: true, pve: true };
  // pve has git and Claude Code, and no project yet.
  facts = (path: string) => (path.includes("/pve/") ? { ...FACTS, projects: [], live: {} } : FACTS);
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
  const dialog = await screen.findByRole("dialog", { name: "Projects" });
  await within(dialog).findByRole("region", { name: "Storage box" });
  const menu = within(dialog).getByRole("navigation", { name: "Categories" });
  // Across the top at every width, not a column beside the projects.
  expect(menu).not.toHaveClass("sm:w-52");
  expect(within(menu).getByRole("button", { name: "Storage box" })).toBeInTheDocument();
  expect(within(menu).queryByRole("button", { name: "pve" })).toBeNull();
  expect(within(dialog).queryByRole("region", { name: "pve" })).toBeNull();
  // The search finds a machine by its projects.
  fireEvent.change(within(dialog).getByLabelText("Search"), { target: { value: "blog" } });
  expect(within(menu).getByRole("button", { name: "Storage box" })).toBeInTheDocument();

  // New project, from the dialog's header, in a dialog of its own: on pve — Claude Code's
  // new folder, or Git's clone — run in pve's terminal.
  fireEvent.click(within(dialog).getByRole("button", { name: "New project" }));
  const make = await screen.findByRole("dialog", { name: "New project" });
  expect(within(make).getAllByRole("option").map((o) => o.textContent)).toEqual(["Storage box", "pve"]);
  fireEvent.change(within(make).getByLabelText("Machine"), { target: { value: "pve" } });
  expect(within(make).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([
    expect.stringMatching(/^New folder/),
    expect.stringMatching(/^Clone a repository/),
  ]);
  fireEvent.click(within(make).getByLabelText(/^Clone a repository/));
  expect(within(make).getByLabelText("Repository")).toBeInTheDocument();
  fireEvent.click(within(make).getByLabelText(/^New folder/));
  expect(within(make).getByRole("button", { name: "New project" })).toBeDisabled();
  fireEvent.change(within(make).getByLabelText("Name"), { target: { value: "web" } });
  fireEvent.click(within(make).getByRole("button", { name: "New project" }));
  expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull();
  expect(await screen.findByText("shell at /api/ssh/machines/pve/terminal?tool=claude&action=new&target=web")).toBeInTheDocument();
});

test("Update all, from the row above the table: each set-up machine updated in turn, the next once the last ends", async () => {
  sshSetUp();
  sshHosts = { ...sshHosts, pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  sshTrusted = { nas: true, pve: true };
  renderPage();
  await screen.findByText("Storage box");

  // Projects and Update all sit together above the table, not in the header.
  const across = await screen.findByRole("toolbar", { name: "Across machines" });
  expect(within(across).getByRole("button", { name: "Projects" })).toBeInTheDocument();
  fireEvent.click(within(across).getByRole("button", { name: "Update all" }));
  const dialog = await screen.findByRole("dialog", { name: "Update all" });
  const row = (name: string) => within(dialog).getByText(name).closest("li") as HTMLElement;
  await vi.waitFor(() => expect(row("Storage box")).toHaveTextContent("12 waiting (apt)"));
  await vi.waitFor(() => expect(within(row("pve")).getByRole("button", { name: "Update pve" })).toBeEnabled());

  fireEvent.click(within(dialog).getByRole("button", { name: "Update all" }));
  // The first, in its terminal; the other waits for it.
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update")).toBeInTheDocument();
  expect(row("pve")).toHaveTextContent("Queued");
  expect(screen.queryByText("shell at /api/ssh/machines/pve/terminal?tool=system&action=update")).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Update all" })).toBeDisabled();

  // It ends: the next starts, and what waits on the first is read again.
  const reads = () => calls.filter((c) => c.path === "/api/ssh/machines/nas/facts").length;
  const before = reads();
  fireEvent.click(within(screen.getByRole("region", { name: "Update — Storage box" })).getByRole("button", { name: "Close" }));
  expect(await screen.findByText("shell at /api/ssh/machines/pve/terminal?tool=system&action=update")).toBeInTheDocument();
  await vi.waitFor(() => expect(reads()).toBeGreaterThan(before));
});

test("Update all has each machine's switch for updates without a password; root needs none", async () => {
  sshSetUp();
  sshHosts = { ...sshHosts, pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  sshTrusted = { nas: true, pve: true };
  facts = { ...FACTS, sudo_rule: "off" };
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
  const dialog = await screen.findByRole("dialog", { name: "Update all" });
  const row = (name: string) => within(dialog).getByText(name).closest("li") as HTMLElement;
  const rule = await within(row("Storage box")).findByRole("switch", { name: "Updates without a password" });
  expect(rule).toHaveAttribute("aria-checked", "false");
  expect(within(row("Storage box")).getByText("Passwordless sudo")).toBeInTheDocument();
  expect(within(row("pve")).queryByRole("switch")).toBeNull();
  expect(row("pve")).toHaveTextContent("root — no sudo needed");
  expect(within(row("pve")).queryByText("Passwordless sudo")).toBeNull();

  // Not while Update all runs: its run would hand the turn on.
  await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Update all" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Update all" }));
  await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update");
  expect(rule).toBeDisabled();
  fireEvent.click(within(screen.getByRole("region", { name: "Update — Storage box" })).getByRole("button", { name: "Close" }));
  await screen.findByText("shell at /api/ssh/machines/pve/terminal?tool=system&action=update");
  fireEvent.click(within(screen.getByRole("region", { name: "Update — pve" })).getByRole("button", { name: "Close" }));

  await vi.waitFor(() => expect(rule).toBeEnabled());
  fireEvent.click(rule);
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?sudo=allow")).toBeInTheDocument();
});

test("Update all can stop after the machine updating now", async () => {
  sshSetUp();
  sshHosts = { ...sshHosts, pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  sshTrusted = { nas: true, pve: true };
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "Update all" }));
  const dialog = await screen.findByRole("dialog", { name: "Update all" });
  await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Update pve" })).toBeEnabled());
  fireEvent.click(within(dialog).getByRole("button", { name: "Update all" }));
  await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update");

  fireEvent.click(within(dialog).getByRole("button", { name: "Stop after this one" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Update — Storage box" })).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(within(dialog).getByRole("button", { name: "Update all" })).toBeEnabled());
  expect(screen.queryByText("shell at /api/ssh/machines/pve/terminal?tool=system&action=update")).toBeNull();
});

test("the projects folder is set under the Git card's cog, not under General", async () => {
  sshSetUp();
  renderPage("/machines/nas");

  fireEvent.click(await within(await screen.findByRole("region", { name: "Tools" })).findByRole("button", { name: "Git settings" }));
  const folder = within(await screen.findByRole("dialog", { name: "Git settings" })).getByLabelText("Projects folder");
  expect(within(category("General")).queryByLabelText("Projects folder")).toBeNull();
  // Empty is the default, ~/projects — not a value it needs.
  fireEvent.change(folder, { target: { value: "" } });
  expect(screen.queryByText("Projects folder needs a value.")).toBeNull();
  fireEvent.change(folder, { target: { value: "~" } });
  fireEvent.keyDown(folder, { key: "Enter" });
  fireEvent.submit(folder);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      path: "/api/ssh/machines/nas/projects", method: "PUT", body: { folder: "~" },
    }),
  );
});

test("a set-up machine's row updates its system in its terminal; the plain one has no Update", async () => {
  sshSetUp();
  renderPage();
  await screen.findByText("Storage box");

  // pve has no SSH: no Update on its row.
  const pve = screen.getByText("pve").closest("tr") as HTMLElement;
  expect(within(pve).queryByTitle(/^Update the system/)).toBeNull();
  fireEvent.click(await within(nasRow()).findByTitle(/^Update the system/));

  expect(await screen.findByText("Update — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update")).toBeInTheDocument();
});

test("a set-up machine's row opens a terminal on it", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  sshKey = UNLOCKED_KEY;
  renderPage();
  await screen.findByText("Storage box");

  // Its tooltip says where the server logs in; the terminal is a shell on that machine.
  fireEvent.click(await within(nasRow()).findByTitle("Terminal: ssh nas — loskai@192.168.10.50"));
  expect(await screen.findByText("Terminal — Storage box")).toBeInTheDocument();
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal")).toBeInTheDocument();
});

test("a machine that doesn't exist says so", async () => {
  renderPage("/machines/gone");
  expect(await screen.findByText("No such machine.")).toBeInTheDocument();
});
test("updates without a password are allowed in the machine's terminal, and taken off there", async () => {
  sshSetUp();
  facts = { ...FACTS, sudo_rule: "off" };
  renderPage("/machines/nas/ssh");

  const toggle = await screen.findByRole("switch", { name: "Updates without a password" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);

  expect(await screen.findByText("Allow updates without a password — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?sudo=allow")).toBeInTheDocument();
});

test("a machine with the rule on offers to take it off", async () => {
  sshSetUp();
  facts = { ...FACTS, sudo_rule: "on" };
  renderPage("/machines/nas/ssh");

  const toggle = await screen.findByRole("switch", { name: "Updates without a password" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  fireEvent.click(toggle);
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?sudo=remove")).toBeInTheDocument();
});

test("a machine logged into as root needs no rule", async () => {
  sshSetUp();
  sshHosts = { nas: { hostname: "192.168.10.50", user: "root", port: 22 } };
  renderPage("/machines/nas/ssh");

  expect(await screen.findByText("not needed — it logs in as root")).toBeInTheDocument();
  expect(screen.queryByRole("switch", { name: "Updates without a password" })).toBeNull();
});

test("the unlock prompt says how long Settings › SSH keeps the key unlocked", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  settingsReply = { ssh_unlock_minutes: { value: "180", source: "stored", secret: false } };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByTitle(/^Terminal: ssh nas/));
  expect(await screen.findByText(/Your password unlocks it for 3 hours\./)).toBeInTheDocument();
});
