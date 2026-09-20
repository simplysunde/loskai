import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AddRouteModal } from "./AddRouteModal";

// The modal reads three queries; none of them matter to the field validation under test,
// so they answer with the smallest shape each consumer needs.
const RESPONSES: Record<string, unknown> = {
  "/api/docker/containers": [],
  "/api/caddy/routes": [],
  "/api/settings": {
    base_domain: { value: "example.no", source: "stored", secret: false },
    adguard_url: { value: "http://192.168.10.101:3000", source: "stored", secret: false },
  },
  "/api/health": {
    caddy: { status: "healthy", mode: "lan" },
    adguard: { status: "healthy", answer_ip: "192.168.10.101" },
    wireguard: { status: "healthy" },
    docker: { status: "healthy" },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      new Response(JSON.stringify(RESPONSES[path] ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  RESPONSES["/api/docker/containers"] = [];
  RESPONSES["/api/caddy/routes"] = [];
});

function renderModal(overrides = {}) {
  const onSubmit = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddRouteModal
          open
          baseDomain="example.no"
          mode="lan"
          routedOrigins={new Set()}
          onSubmit={onSubmit}
          onClose={() => {}}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Every field test uses the External source — it's the one that starts empty.
  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  return { onSubmit };
}

const prefixInput = () => screen.getByPlaceholderText("grafana");
const upstreamInput = () => screen.getByPlaceholderText("e.g. 192.168.10.100:3000");
const addButton = () => screen.getByRole("button", { name: /Add route/ });

test("lowercases a typed prefix instead of silently rejecting it", () => {
  // isValidPrefix rejects uppercase, so "Grafana" used to leave Add route disabled with
  // nothing on screen explaining why. suggestPrefix only lowercases *pre-filled* names.
  const { onSubmit } = renderModal();

  fireEvent.change(prefixInput(), { target: { value: "Grafana" } });
  expect(prefixInput()).toHaveValue("grafana");

  fireEvent.change(upstreamInput(), { target: { value: "192.168.10.100:3000" } });
  expect(addButton()).toBeEnabled();

  fireEvent.click(addButton());
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "grafana",
    upstream: "192.168.10.100:3000",
    upstream_tls: false,
    route_mode: "proxy",
  });
});

test("explains an invalid prefix rather than just disabling the button", () => {
  renderModal();
  fireEvent.change(prefixInput(), { target: { value: "-nope-" } });

  expect(
    screen.getByText("Single DNS label only: lowercase letters, digits, hyphens."),
  ).toBeInTheDocument();
  expect(addButton()).toBeDisabled();
});

test("explains an upstream typed as a URL", () => {
  renderModal();
  fireEvent.change(upstreamInput(), { target: { value: "http://192.168.10.100:3000" } });

  expect(
    screen.getByText("Use host:port — no scheme (http://) or path."),
  ).toBeInTheDocument();
});

test("hints stay hidden while a field is empty", () => {
  renderModal();

  expect(
    screen.queryByText("Single DNS label only: lowercase letters, digits, hyphens."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Use host:port — no scheme (http://) or path."),
  ).not.toBeInTheDocument();
  expect(addButton()).toBeDisabled();
});

test("DNS-only mode validates a bare IP and submits dns_only", () => {
  const { onSubmit } = renderModal();
  fireEvent.click(screen.getByRole("button", { name: "DNS-only" }));

  const host = screen.getByPlaceholderText("rack1.vm3");
  fireEvent.change(host, { target: { value: "Rack1.VM3" } });
  expect(host).toHaveValue("rack1.vm3"); // dots allowed, case still normalised

  const target = screen.getByPlaceholderText("e.g. 192.168.10.55");
  fireEvent.change(target, { target: { value: "192.168.10.55:80" } });
  expect(screen.getByText("A bare IPv4 address — no port.")).toBeInTheDocument();
  expect(addButton()).toBeDisabled();

  fireEvent.change(target, { target: { value: "192.168.10.55" } });
  fireEvent.click(addButton());
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "rack1.vm3",
    upstream: "192.168.10.55",
    upstream_tls: false,
    route_mode: "dns_only",
  });
});


// --- The upstream hint is the container's, not the deployment's (Phase 16 Stage A) ---

function renderPicker(overrides = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onSubmit = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddRouteModal
          open
          baseDomain="example.no"
          // Deployment-wide mode says "docker" — a hostname admin URL. Before Stage A this
          // alone decided the hint, so every container was told to use name:port.
          mode="docker"
          routedOrigins={new Set()}
          onSubmit={onSubmit}
          onClose={() => {}}
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSubmit };
}

const CONTAINERS = [
  {
    id: "a", name: "grafana", image: "grafana/img", subdomain: null,
    suggested_upstream: "grafana:3000", upstream_mode: "docker",
  },
  {
    // A managed stack: its own compose project, so Caddy cannot resolve the name.
    id: "b", name: "sonarr", image: "sonarr/img", subdomain: null,
    suggested_upstream: "192.168.10.50:8989", upstream_mode: "lan",
  },
];

test("a container on Caddy's network is hinted by name", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("grafana"));

  expect(screen.getByPlaceholderText("e.g. grafana:3000")).toHaveValue("grafana:3000");
});

test("a container off Caddy's network is hinted by host IP, despite docker mode", async () => {
  // The regression this whole stage exists to stop: the deployment says "docker", but this
  // container is on another compose network, so name:port would 502.
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("sonarr"));

  expect(screen.getByPlaceholderText("e.g. 192.168.10.100:3000")).toHaveValue(
    "192.168.10.50:8989",
  );
});

test("switching source clears the container's mode", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("sonarr")); // lan
  fireEvent.click(screen.getByRole("button", { name: /External/ }));

  // Back to the deployment-wide "docker" hint — a stale lan hint would misdescribe it.
  expect(screen.getByPlaceholderText("e.g. grafana:3000")).toBeInTheDocument();
});

// --- Machines as upstreams (Phase 21a) ---

const MACHINES = [
  // A named machine: dns_only, so its upstream is a bare IP.
  {
    id: "nas",
    name: "nas",
    type: "external",
    subdomain: "nas",
    route_mode: "dns_only",
    fqdn: "nas.example.no",
    upstream: "192.168.10.50",
    private: false,
    routed: true,
    synced: null,
    upstream_healthy: null,
  },
  // A proxied service: host:port, not an address — must not be offered as a machine.
  {
    id: "grafana",
    name: "grafana",
    type: "docker",
    subdomain: "grafana",
    route_mode: "proxy",
    fqdn: "grafana.example.no",
    upstream: "192.168.10.60:3000",
    private: false,
    routed: true,
    synced: true,
    upstream_healthy: true,
  },
];

test("External lists named machines, and only those", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));

  expect(await screen.findByText("192.168.10.50 · nas.example.no")).toBeInTheDocument();
  // grafana is a service on a machine, not an address to point at.
  expect(screen.queryByText(/192\.168\.10\.60:3000/)).not.toBeInTheDocument();
});

test("picking a machine links the route to it, not just its address", async () => {
  // The link is what makes the route follow the machine when its IP changes.
  RESPONSES["/api/caddy/routes"] = MACHINES;
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.click(await screen.findByText("192.168.10.50 · nas.example.no"));
  fireEvent.change(screen.getByPlaceholderText("grafana"), { target: { value: "plex" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. grafana:3000"), {
    target: { value: "192.168.10.50:32400" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ machine: "nas" }));
});

test("a typed address carries no machine link", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.change(screen.getByPlaceholderText("grafana"), { target: { value: "thing" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. grafana:3000"), {
    target: { value: "192.168.10.77:8080" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.not.objectContaining({ machine: expect.anything() }),
  );
});

test("the presets open straight into the machine form", async () => {
  renderPicker({ initialSource: "external", initialRouteMode: "dns_only" });

  // "Name a machine" lands on the DNS-only External form, not the container list.
  expect(await screen.findByPlaceholderText("rack1.vm3")).toBeInTheDocument();
  expect(screen.getByText(/give it a name and its bare IP/)).toBeInTheDocument();
});

test("picking a machine fills its address and leaves the port to type", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.click(await screen.findByText("192.168.10.50 · nas.example.no"));

  expect(screen.getByPlaceholderText("e.g. grafana:3000")).toHaveValue("192.168.10.50:");
});

test("picking a machine leaves the prefix alone", async () => {
  // Prefilling it with the machine's name would collide with the name the machine
  // already answers to — the route is a service *on* it, not the machine itself.
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.click(await screen.findByText("192.168.10.50 · nas.example.no"));

  expect(screen.getByPlaceholderText("grafana")).toHaveValue("");
});

test("DNS-only mode offers no machine list — it is where machines are made", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.click(screen.getByRole("button", { name: "DNS-only" }));

  expect(screen.queryByText("192.168.10.50 · nas.example.no")).not.toBeInTheDocument();
});

test("with no machines yet, External still takes a typed address", async () => {
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));

  expect(await screen.findByText(/No named machines yet/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText("e.g. grafana:3000")).toBeInTheDocument();
});
