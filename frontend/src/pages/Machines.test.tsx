import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Machines } from "./Machines";

// xterm needs a real canvas; these tests only need to know a terminal opened, and where.
vi.mock("../components/shared/XtermSession", () => ({
  XtermSession: ({ url }: { url: string }) => <div>shell at {url}</div>,
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
    fqdn: "plex.example.no", upstream: "192.168.10.50:32400",
    private: false, routed: true, synced: true,
  },
  {
    id: "jellyfin", name: "jellyfin", type: "external", kind: "service", subdomain: "tv",
    fqdn: "tv.example.no", upstream: "192.168.10.50:8096",
    private: false, routed: true, synced: true,
  },
  {
    id: "grafana", name: "grafana", type: "docker", kind: "service", subdomain: "grafana",
    fqdn: "grafana.example.no", upstream: "grafana:3000",
    private: false, routed: true, synced: true,
  },
];

let calls: { path: string; method: string; body: unknown }[] = [];
let sshHosts: Record<string, unknown> = {};
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
  tmux: [
    { name: "build", created: 1793212547, attached: false, windows: 2 },
    { name: "claude-site", created: 1793212547, attached: false, windows: 1 },
  ],
  projects: [
    { path: "projects/site", folder: "projects", name: "site", branch: "main", dirty: true, claude: 1793212000,
      ahead: 2, committed: 1793211000, subject: "Add the header" },
    { path: "notes", folder: "", name: "notes", branch: "main", dirty: false, claude: 0, committed: 1793211000, subject: "x" },
  ],
};
let facts: unknown = FACTS;
let factsStatus = 200;
let settingsReply: unknown = {};
const ADMIN_STATUS = { authed: true, needs_setup: false, user: { username: "admin", role: "admin", tabs: ["docker", "routing", "machines"] } };
let authStatus: unknown = ADMIN_STATUS;
let sshKey: unknown = null;
let deleteReply: unknown = { deleted: true, instance_id: "nas", warning: null };
const TOOLS = [
  {
    id: "system", name: "System", description: "Update the system, reboot, shut down.", requires: [], installable: [],
    actions: [
      { id: "update", label: "Update", description: "Update it.", target: null, confirm: null,
        run: { apt: "sudo apt-get update && sudo apt-get -y dist-upgrade" } },
      { id: "reboot", label: "Reboot", description: "Restart it.", target: null,
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
      { id: "open", label: "Claude", description: "Open it.", target: "project", ask: null, confirm: null, session: "claude", run: "claude" },
      { id: "new", label: "New project", description: "Make one.", target: null, ask: "project", confirm: null, session: "claude", run: "git init" },
    ],
  },
  {
    id: "tailscale", name: "Tailscale", description: "Connect it.", requires: ["tailscale"], installable: ["tailscale"],
    actions: [{ id: "up", label: "Connect", description: "Up.", target: null, ask: null, confirm: null, session: null, run: "sudo tailscale up" }],
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
  sshTrusted = {};
  facts = FACTS;
  factsStatus = 200;
  settingsReply = {};
  authStatus = ADMIN_STATUS;
  sshKey = null;
  deleteReply = { deleted: true, instance_id: "nas", warning: null };
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
              ? { key: sshKey, hosts: sshHosts, trusted: sshTrusted, projects: { nas: "~/projects", pve: "~/projects" } }
            : path === "/api/instances/nas" && init?.method === "DELETE"
              ? deleteReply
            : path === "/api/ssh/tools"
              ? TOOLS
            : path === "/api/auth/status"
              ? authStatus
            : path === "/api/settings"
              ? settingsReply
            : path === "/api/ssh/log"
              ? [
                  { at: "2026-11-01T10:00:00Z", event: "open", machine: "nas", from: "192.168.10.5", target: "loskai@192.168.10.50" },
                  { at: "2026-11-01T09:00:00Z", event: "open", machine: "pve", from: "192.168.10.5", target: "root@192.168.10.10" },
                ]
            : path === "/api/ssh/running"
              ? { nas: { ok: true, checked: 0, containers: [{ name: "plex-1", image: "plex", status: "Up 2 days" }], services: [], guests: [] } }
            : path.endsWith("/facts")
              ? facts
            : path.endsWith("/scan")
              ? { fingerprint: "SHA256:abc", type: "ssh-ed25519", state: "new" }
              : {};
      return new Response(JSON.stringify(data), {
        status: path.endsWith("/facts") ? factsStatus : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const nasRow = () => screen.getByText("Storage box").closest("tr") as HTMLElement;
// The machine's dialog: its side menu, and the category shown.
const dialog = () => screen.getByRole("dialog", { name: "Storage box" });
const category = (name: string) => screen.getByRole("region", { name });
const open = (name: string) =>
  fireEvent.click(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("button", { name }));

// The routes as App has them, so the cog and naming a machine go where they really do.
function renderPage(at = "/machines") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/machines" element={<Machines />} />
          <Route path="/machines/:id/:section?" element={<Machines />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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

test("a hosted route links out under URL; DNS state is the machine's alone", async () => {
  renderPage();
  const plexRow = (await screen.findByText("plex")).closest("tr") as HTMLElement;
  const [, url, address, dns] = within(plexRow).getAllByRole("cell");

  expect(within(url).getByRole("link", { name: "plex.example.no" })).toHaveAttribute(
    "href",
    "https://plex.example.no",
  );
  expect(address).toHaveTextContent(":32400");
  // plex's rewrite is missing, but that is Routing's to say; the machine's row says "set".
  expect(dns).toBeEmptyDOMElement();
  expect(within(nasRow()).getByText("set")).toBeInTheDocument();
  // The machine's own name sits in the same URL column, on its row.
  const [, nasUrl] = within(nasRow()).getAllByRole("cell");
  expect(nasUrl).toHaveTextContent("nas.example.no");
});

test("deleting a machine names the routes on its address, which keep it", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));

  expect(screen.getByText(/2 routes are on its address/)).toHaveTextContent("(jellyfin, plex)");
});

test("deleting a set-up machine takes Loskai's key off it, unlocking the key first", async () => {
  setUp();
  sshKey = { ...UNLOCKED_KEY, unlocked_until: null };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
  expect(screen.getByText(/Loskai's key is taken off the machine first/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await vi.waitFor(() =>
    expect(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/ssh/unlock"],
      ["DELETE", "/api/instances/nas"],
    ]),
  );
});

test("a machine deleted with Loskai's key still on it says so", async () => {
  setUp();
  deleteReply = { deleted: true, instance_id: "nas", warning: "Loskai's key is still on the machine: No route to host" };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("More"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete machine" }));
  // Unlocked already: no password asked.
  expect(screen.queryByLabelText("Your password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByText(/No route to host — remove its/)).toBeInTheDocument();
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
  expect(post.body).toEqual({ instance_id: "nas", address: "192.168.10.70", hostname: "nas", name: "Storage box" });
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

test("a machine's SSH user is set in its dialog, and setting one starts the setup", async () => {
  renderPage("/machines/pve/ssh");

  const user = await screen.findByLabelText("SSH user");
  expect(screen.getByLabelText("SSH port")).toBeDisabled();
  fireEvent.focus(user);
  fireEvent.change(user, { target: { value: "root" } });
  sshHosts = { pve: { hostname: "192.168.10.10", user: "root", port: 22 } };
  fireEvent.blur(user);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/machines")?.body).toMatchObject({
      instance_id: "pve", ssh: { user: "root", port: 22 },
    }),
  );
  expect(await screen.findByText(/SSH — /)).toBeInTheDocument();
});

test("removing a machine from the SSH config is its own button, confirmed", async () => {
  setUp();
  renderPage("/machines/nas/ssh");

  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  expect(calls.some((c) => c.path === "/api/machines")).toBe(false);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.path === "/api/machines")?.body).toMatchObject({ instance_id: "nas", ssh: null }),
  );
});

test("the search finds a section by what is in it, and shows only those", async () => {
  setUp();
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
    fqdn: "whoami.example.no", upstream: "192.168.10.220:8081", private: false, routed: true, synced: true,
  });
  sessionStorage.setItem("loskai.machines.expanded", JSON.stringify([":docker-host"]));
  try {
    renderPage();
    const row = (await screen.findByText("Docker host")).closest("tr") as HTMLElement;

    expect(within(row).getByText("not named")).toBeInTheDocument();
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
        hostname: "dockerhost", address: "192.168.10.220", name: "dockerhost",
      }),
    );
  } finally {
    ROUTES.pop();
  }
});

test("a Docker host already named is listed once, as itself", async () => {
  settingsReply = { host_ip: { value: "192.168.10.50", source: "env" } };
  renderPage();

  await screen.findByText("Storage box");
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
  open("SSH");
  expect(await screen.findByText("not set up")).toBeInTheDocument();
  fireEvent.click(within(category("SSH")).getByRole("button", { name: "Set up SSH" }));
  expect(await screen.findByText("SHA256:abc")).toBeInTheDocument();
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
  expect(within(tools).getByText("1 project, 1 running")).toBeInTheDocument();
  expect(await within(category("Running")).findByText("plex-1")).toBeInTheDocument();
  // Only this machine's entries.
  expect(await within(category("Log")).findByText("Terminal opened (loskai@192.168.10.50)")).toBeInTheDocument();
  // The side menu marks the section picked.
  open("Running");
  expect(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("button", { name: "Running" }))
    .toHaveAttribute("aria-current", "location");
  expect(screen.queryByText(/root@192.168.10.10/)).not.toBeInTheDocument();

  fireEvent.click(within(dialog()).getByRole("button", { name: "Terminal" }));
  // No key in this stub, so it asks to unlock first.
  expect(await screen.findByText("Terminal — Storage box")).toBeInTheDocument();
  expect(screen.getByLabelText("Your password")).toBeInTheDocument();
});

test("a machine on the older status line is offered the reinstall for its overview", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  facts = { ok: false, old: true, checked: 0, error: "Its status line predates the overview — install again" };
  renderPage("/machines/nas/overview");

  fireEvent.click(await screen.findByRole("button", { name: "Install again" }));
  expect(await screen.findByText(/SSH — Storage box/)).toBeInTheDocument();
});

function setUp() {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  sshKey = UNLOCKED_KEY;
}

test("a tool's action runs in the terminal, named — never as a command", async () => {
  setUp();
  renderPage("/machines/nas/tools");

  const update = await screen.findByRole("button", { name: "Update" });
  // The machine's package manager decides the command, shown on hover.
  expect(update.title).toContain("$ sudo apt-get update && sudo apt-get -y dist-upgrade");
  fireEvent.click(update);

  expect(await screen.findByText("Update — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=update")).toBeInTheDocument();
});

test("an action that is hard to undo asks first", async () => {
  setUp();
  renderPage("/machines/nas/tools");

  fireEvent.click(await screen.findByRole("button", { name: "Reboot" }));
  expect(screen.getByText("Everything on it stops until it is back up.")).toBeInTheDocument();
  expect(screen.queryByText(/shell at/)).not.toBeInTheDocument();

  // The dialog's own Reboot, after the tool's.
  fireEvent.click(screen.getAllByRole("button", { name: "Reboot" }).at(-1)!);
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=system&action=reboot")).toBeInTheDocument();
});

test("a row of the Running list gets the buttons of the tools that apply", async () => {
  setUp();
  renderPage("/machines/nas/running");

  const row = (await screen.findByText("plex-1")).closest("tr") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Restart" }));

  expect(await screen.findByText("Restart plex-1 — Storage box")).toBeInTheDocument();
  expect(
    screen.getByText("shell at /api/ssh/machines/nas/terminal?tool=services&action=restart-container&target=plex-1"),
  ).toBeInTheDocument();
});

test("a tool the machine lacks is offered to add, when Loskai can install what it needs", async () => {
  setUp();
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
  setUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  // The machine's overview is read once the menu is open.
  expect(await screen.findByRole("menuitem", { name: /Claude Code.*1 project, 1 running/ })).toBeInTheDocument();
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
  setUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Claude Code/ }));
  expect(await screen.findByText("site")).toBeInTheDocument();
  expect(screen.getByText("~/projects/")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));

  // The machine's dialog, where the folder is set — the tool's own dialog closed.
  expect(await screen.findByLabelText("Projects folder")).toHaveValue("~/projects");
  expect(screen.queryByText("~/projects/")).not.toBeInTheDocument();
});

test("Tailscale says its address and how much of the tailnet is online, and lists it", async () => {
  setUp();
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByRole("button", { name: "Tools" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Tailscale.*100\.64\.0\.7 · 1 of 2 online/ }));

  expect(await screen.findByText("phone")).toBeInTheDocument();
  expect(screen.getByText("this machine")).toBeInTheDocument();
  expect(screen.getByText("phone").closest("li")!.title).toBe("offline");
  // A button's symbol says what it does, not a play button on every one.
  const connect = screen.getByRole("button", { name: "Connect" }).querySelector("svg")!.classList;
  expect(connect).toContain("lucide-plug");
});

test("a tool's dialog on an older status line goes straight to installing it again", async () => {
  setUp();
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
  setUp();
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
  setUp();
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
  setUp();
  renderPage("/machines/nas/tools");

  const row = (await screen.findByText("build")).closest("li") as HTMLElement;
  // claude-site is Claude Code's, on its project.
  expect(screen.queryByText("claude-site")).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Attach" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=attach&target=build")).toBeInTheDocument();
});

test("an action that asks for a name runs on what is typed", async () => {
  setUp();
  renderPage("/machines/nas/tools");

  const name = await screen.findByLabelText("New session — name");
  expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
  fireEvent.change(name, { target: { value: "work" } });
  fireEvent.click(screen.getByRole("button", { name: "New session" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=tmux&action=new&target=work")).toBeInTheDocument();
});

test("a project lists in its machine's projects folder, says its Claude session runs, and opens it", async () => {
  setUp();
  renderPage("/machines/nas/tools");

  const row = (await screen.findByText("site")).closest("li") as HTMLElement;
  expect(within(row).getByText("running")).toBeInTheDocument(); // claude-site is a tmux session
  expect(row.textContent).toContain("main · 2 to push · uncommitted changes · committed");
  expect(row.title).toBe("Last commit: Add the header");
  // In ~ rather than ~/projects: not listed.
  expect(screen.queryByText("notes")).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Claude" }));

  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?tool=claude&action=open&target=site")).toBeInTheDocument();
});

test("the projects folder is set in the machine's dialog, under General", async () => {
  setUp();
  renderPage("/machines/nas");

  const folder = await screen.findByLabelText("Projects folder");
  fireEvent.focus(folder);
  fireEvent.change(folder, { target: { value: "~" } });
  fireEvent.keyDown(folder, { key: "Enter" });
  fireEvent.blur(folder);

  await vi.waitFor(() =>
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      path: "/api/ssh/machines/nas/projects", method: "PUT", body: { folder: "~" },
    }),
  );
});

test("a set-up machine's row updates its system in its terminal; the plain one has no Update", async () => {
  setUp();
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
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByTitle(/^Terminal: ssh nas/));
  expect(await screen.findByText("Terminal — Storage box")).toBeInTheDocument();
});

test("a machine that doesn't exist says so", async () => {
  renderPage("/machines/gone");
  expect(await screen.findByText("No such machine.")).toBeInTheDocument();
});
test("updates without a password are allowed in the machine's terminal, and taken off there", async () => {
  setUp();
  facts = { ...FACTS, sudo_rule: "off" };
  renderPage("/machines/nas/ssh");

  const row = (await screen.findByText("Updates without a password")).parentElement!.parentElement as HTMLElement;
  expect(await within(row).findByText("off")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Take it off" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Allow" }));

  expect(await screen.findByText("Allow updates without a password — Storage box")).toBeInTheDocument();
  expect(screen.getByText("shell at /api/ssh/machines/nas/terminal?sudo=allow")).toBeInTheDocument();
});

test("a machine with the rule on offers to take it off", async () => {
  setUp();
  facts = { ...FACTS, sudo_rule: "on" };
  renderPage("/machines/nas/ssh");

  const row = (await screen.findByText("Updates without a password")).parentElement!.parentElement as HTMLElement;
  expect(await within(row).findByText("on")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Allow" })).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Take it off" }));
  expect(await screen.findByText("shell at /api/ssh/machines/nas/terminal?sudo=remove")).toBeInTheDocument();
});

test("a machine logged into as root needs no rule", async () => {
  setUp();
  sshHosts = { nas: { hostname: "192.168.10.50", user: "root", port: 22 } };
  renderPage("/machines/nas/ssh");

  expect(await screen.findByText("not needed — it logs in as root")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
});

test("removing the SSH connection with Loskai's key locked asks for the admin password first", async () => {
  setUp();
  sshKey = { ...UNLOCKED_KEY, unlocked_until: null };
  renderPage("/machines/nas/ssh");

  fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
  fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "admin-pw" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);

  await vi.waitFor(() => expect(calls.find((c) => c.path === "/api/machines")).toBeTruthy());
  const unlockAt = calls.findIndex((c) => c.path === "/api/ssh/unlock");
  expect(calls[unlockAt].body).toEqual({ password: "admin-pw" });
  expect(unlockAt).toBeLessThan(calls.findIndex((c) => c.path === "/api/machines"));
  expect(calls.find((c) => c.path === "/api/machines")!.body).toMatchObject({ instance_id: "nas", ssh: null });
});

test("the unlock prompt says how long Settings › SSH keeps the key unlocked", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  settingsReply = { ssh_unlock_minutes: { value: "180", source: "stored", secret: false } };
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(await within(nasRow()).findByTitle(/^Terminal: ssh nas/));
  expect(await screen.findByText("Your password unlocks it for 3 hours.")).toBeInTheDocument();
});

test("an operator without Routing gets no Add route on a machine's row", async () => {
  authStatus = { authed: true, needs_setup: false, user: { username: "ola", role: "operator", tabs: ["machines"] } };
  renderPage();
  await screen.findByText("Storage box");

  expect(within(nasRow()).queryByTitle("Add a route on this machine")).toBeNull();
  expect(within(nasRow()).getByTitle(/^Machine settings/)).toBeInTheDocument();
});
