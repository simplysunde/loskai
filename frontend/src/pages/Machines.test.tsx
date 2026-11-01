import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Machine } from "./Machine";
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

beforeEach(() => {
  // Machines start collapsed; most tests look at the routes beneath, so both begin open.
  sessionStorage.setItem("loskai.machines.expanded", JSON.stringify(["nas", "pve"]));
  calls = [];
  sshHosts = {};
  sshTrusted = {};
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
              ? { key: null, hosts: sshHosts, trusted: sshTrusted }
            : path === "/api/ssh/log"
              ? [
                  { at: "2026-11-01T10:00:00Z", event: "open", machine: "nas", from: "192.168.10.5", target: "loskai@192.168.10.50" },
                  { at: "2026-11-01T09:00:00Z", event: "open", machine: "pve", from: "192.168.10.5", target: "root@192.168.10.10" },
                ]
            : path === "/api/ssh/running"
              ? { nas: { ok: true, checked: 0, containers: [{ name: "plex-1", image: "plex", status: "Up 2 days" }], services: [], guests: [] } }
            : path.endsWith("/scan")
              ? { fingerprint: "SHA256:abc", type: "ssh-ed25519", state: "new" }
              : {};
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const nasRow = () => screen.getByText("Storage box").closest("tr") as HTMLElement;

// Both pages, so the cog and naming a machine go where they really do.
function renderPage(at = "/machines") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/machines" element={<Machines />} />
          <Route path="/machines/:id" element={<Machine />} />
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

  fireEvent.click(within(nasRow()).getByTitle("Delete machine"));

  expect(screen.getByText(/2 routes are on its address/)).toHaveTextContent("(jellyfin, plex)");
});

test("every route on a machine's address is listed under it, by port", async () => {
  // Nothing links them: the address alone puts them on the machine.
  renderPage();
  const row = (await screen.findByText("jellyfin")).closest("tr") as HTMLElement;

  expect(within(row).getByText(":8096")).toBeInTheDocument();
  expect(within(screen.getByText("plex").closest("tr") as HTMLElement).getByText(":32400"))
    .toBeInTheDocument();
});

test("a machine's cog opens its page, where editing posts its id and says what moved", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle(/^Machine settings/));
  expect(await screen.findByRole("heading", { name: "Storage box" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const ip = screen.getByPlaceholderText("192.168.10.50");
  fireEvent.change(ip, { target: { value: "192.168.10.70" } });
  fireEvent.click(screen.getByRole("button", { name: "Save machine" }));

  const post = await vi.waitFor(() => {
    const c = calls.find((x) => x.path === "/api/machines");
    if (!c) throw new Error("not posted yet");
    return c;
  });
  expect(post.body).toMatchObject({ instance_id: "nas", address: "192.168.10.70", hostname: "nas" });
  const banner = await screen.findByText(/Moved plex with it/);
  expect(within(banner).getByText("nas.example.no")).toBeInTheDocument();
});

test("a machine's row adds a route on its address", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("Add a route on this machine"));

  expect(await screen.findByRole("combobox", { name: "Host" })).toHaveValue("192.168.10.50");
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

test("a machine's page sets up its SSH from there", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  renderPage("/machines/nas");

  expect(await screen.findByText("not set up")).toBeInTheDocument();
  expect(screen.getByText("Set up SSH to see what runs here.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Set up SSH" }));
  expect(await screen.findByText("SHA256:abc")).toBeInTheDocument();
});

test("a set-up machine's page: what runs there, its own log, and a terminal", async () => {
  sshHosts = { nas: { hostname: "192.168.10.50", user: "loskai", port: 22 } };
  sshTrusted = { nas: true };
  renderPage("/machines/nas");

  expect(await screen.findByText("plex-1")).toBeInTheDocument();
  expect(screen.getByText("loskai@192.168.10.50:22")).toBeInTheDocument();
  // Only this machine's entries.
  expect(await screen.findByText("Terminal opened (loskai@192.168.10.50)")).toBeInTheDocument();
  expect(screen.queryByText(/root@192.168.10.10/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
  // No key in this stub, so it asks to unlock first.
  expect(await screen.findByText("Terminal — Storage box")).toBeInTheDocument();
  expect(screen.getByLabelText("Admin password")).toBeInTheDocument();
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