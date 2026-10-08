import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Machines } from "./Machines";

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
    fqdn: "plex.example.no", upstream: "192.168.10.50:32400", machine: "nas",
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

beforeEach(() => {
  calls = [];
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
              ? { url: "nas.example.no", warning: null, relinked: ["plex"] }
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Machines />
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

test("a hosted route links out under URL, its DNS state under DNS", async () => {
  renderPage();
  const plexRow = (await screen.findByText("plex")).closest("tr") as HTMLElement;
  const [, url, address, dns] = within(plexRow).getAllByRole("cell");

  expect(within(url).getByRole("link", { name: "plex.example.no" })).toHaveAttribute(
    "href",
    "https://plex.example.no",
  );
  expect(address).toHaveTextContent(":32400");
  expect(dns).toHaveTextContent("missing");
  // The machine's own name sits in the same URL column, on its row.
  const [, nasUrl] = within(nasRow()).getAllByRole("cell");
  expect(nasUrl).toHaveTextContent("nas.example.no");
});

test("deleting a machine names the routes that will stop following it", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("Delete machine"));

  expect(screen.getByText(/1 route points/)).toHaveTextContent("(plex)");
});

test("an unlinked route on a machine's address is listed under it, marked as matched", async () => {
  renderPage();
  const row = (await screen.findByText("jellyfin")).closest("tr") as HTMLElement;

  expect(within(row).getByRole("img", { name: /^Matched by IP/ })).toBeInTheDocument();
  expect(within(row).getByText(":8096")).toBeInTheDocument();
  // The linked route says so instead — it follows the machine.
  const plex = screen.getByText("plex").closest("tr") as HTMLElement;
  expect(within(plex).getByRole("img", { name: /^Linked/ })).toBeInTheDocument();
  expect(within(plex).queryByRole("img", { name: /^Matched by IP/ })).not.toBeInTheDocument();
});

test("editing a machine posts its id, and the banner says what moved with it", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("Edit machine"));
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

test("a machine's row adds a route already linked to it", async () => {
  renderPage();
  await screen.findByText("Storage box");

  fireEvent.click(within(nasRow()).getByTitle("Add a route on this machine"));

  expect(await screen.findByRole("combobox", { name: "Machine" })).toHaveValue("nas");
  expect(screen.getByText(/follows Storage box/)).toBeInTheDocument();
});
