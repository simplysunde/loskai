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

const DEFAULT_SETTINGS = RESPONSES["/api/settings"];

afterEach(() => {
  vi.unstubAllGlobals();
  RESPONSES["/api/docker/containers"] = [];
  RESPONSES["/api/caddy/routes"] = [];
  RESPONSES["/api/settings"] = DEFAULT_SETTINGS;
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
const hostInput = () =>
  screen.getByRole("combobox", { name: "Host or machine" }) as HTMLInputElement;
const portInput = () => screen.getByRole("textbox", { name: "Port" }) as HTMLInputElement;
const addButton = () => screen.getByRole("button", { name: /Add route/ });

function typeUpstream(host: string, port: string) {
  fireEvent.change(hostInput(), { target: { value: host } });
  fireEvent.change(portInput(), { target: { value: port } });
}

// Open the host list from its chevron and pick an entry, as a mouse would.
async function pickHost(name: RegExp) {
  fireEvent.mouseDown(await screen.findByRole("button", { name: "Show hosts" }));
  fireEvent.mouseDown(screen.getByRole("option", { name }));
}

test("lowercases a typed prefix instead of silently rejecting it", () => {
  // isValidPrefix rejects uppercase, so "Grafana" used to leave Add route disabled with
  // nothing on screen explaining why. suggestPrefix only lowercases *pre-filled* names.
  const { onSubmit } = renderModal();

  fireEvent.change(prefixInput(), { target: { value: "Grafana" } });
  expect(prefixInput()).toHaveValue("grafana");

  typeUpstream("192.168.10.100", "3000");
  expect(addButton()).toBeEnabled();

  fireEvent.click(addButton());
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "grafana",
    upstream: "192.168.10.100:3000",
    upstream_tls: false,
    scheme: "https",
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

test("explains a host typed as a URL", () => {
  renderModal();
  fireEvent.change(hostInput(), { target: { value: "http://192.168.10.100" } });

  expect(
    screen.getByText("Just the host — no scheme (http://), path or port."),
  ).toBeInTheDocument();
});

test("a pasted host:port splits into the two fields", () => {
  renderModal();
  fireEvent.change(hostInput(), { target: { value: "192.168.10.100:3000" } });

  expect(hostInput()).toHaveValue("192.168.10.100");
  expect(portInput()).toHaveValue("3000");
});

test("the port takes digits only, and says when it's out of range", () => {
  renderModal();
  fireEvent.change(portInput(), { target: { value: "80a80" } });
  expect(portInput()).toHaveValue("8080");

  fireEvent.change(portInput(), { target: { value: "99999" } });
  expect(screen.getByText("The port is a number, 1–65535.")).toBeInTheDocument();
});

test("hints stay hidden while a field is empty", () => {
  renderModal();

  expect(
    screen.queryByText("Single DNS label only: lowercase letters, digits, hyphens."),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Just the host/)).not.toBeInTheDocument();
  expect(screen.queryByText(/The port is a number/)).not.toBeInTheDocument();
  expect(addButton()).toBeDisabled();
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

  expect(hostInput()).toHaveValue("grafana");
  expect(portInput()).toHaveValue("3000");
});

test("a container off Caddy's network is hinted by host IP, despite docker mode", async () => {
  // The regression this whole stage exists to stop: the deployment says "docker", but this
  // container is on another compose network, so name:port would 502.
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("sonarr"));

  expect(hostInput()).toHaveValue("192.168.10.50");
  expect(portInput()).toHaveValue("8989");
});

test("a host-networked recipe install fills the host and the recipe's name", async () => {
  // Bambuddy, as installed: Docker reports no ports, so no full upstream — but the host is
  // still the Docker host, and the install already named the instance after the recipe.
  RESPONSES["/api/docker/containers"] = [
    {
      id: "c", name: "bambuddy-bambuddy-1", image: "ghcr.io/maziggy/bambuddy", subdomain: null,
      suggested_upstream: null, suggested_host: "192.168.10.220", instance_id: "bambuddy",
      upstream_mode: "lan",
    },
  ];
  renderPicker();

  fireEvent.click(await screen.findByText("bambuddy-bambuddy-1"));

  expect(prefixInput()).toHaveValue("bambuddy");
  expect(hostInput()).toHaveValue("192.168.10.220");
  expect(portInput()).toHaveValue("");
});

test("a container with no linked instance keeps its own name as the prefix", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("grafana"));

  expect(screen.getByPlaceholderText("grafana")).toHaveValue("grafana");
});

test("a container whose address is known is followed by default, locked", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  const { onSubmit } = renderPicker();

  fireEvent.click(await screen.findByText("sonarr"));
  expect(hostInput().readOnly).toBe(true);
  expect(portInput().readOnly).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /Add route/ }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ container: "sonarr", follow_container: true }),
  );
});

test("Set by hand on a picked container sends an address of its own", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  const { onSubmit } = renderPicker();

  fireEvent.click(await screen.findByText("sonarr"));
  fireEvent.click(screen.getByRole("button", { name: "Set by hand" }));
  typeUpstream("192.168.10.50", "9999");
  fireEvent.click(screen.getByRole("button", { name: /Add route/ }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ follow_container: false, upstream: "192.168.10.50:9999" }),
  );
});

test("a container whose port Docker can't name starts unlocked, half-filled", async () => {
  RESPONSES["/api/docker/containers"] = [
    {
      id: "c", name: "bambuddy-bambuddy-1", image: "x", subdomain: null,
      suggested_upstream: null, suggested_host: "192.168.10.220", instance_id: "bambuddy",
      upstream_mode: "lan",
    },
  ];
  renderPicker();

  fireEvent.click(await screen.findByText("bambuddy-bambuddy-1"));

  expect(hostInput().readOnly).toBe(false);
  expect(hostInput()).toHaveValue("192.168.10.220");
  expect(portInput()).toHaveValue("");
  expect(screen.getByText(/can't name this container's port/)).toBeInTheDocument();
});

test("switching source clears the container's mode", async () => {
  RESPONSES["/api/docker/containers"] = CONTAINERS;
  renderPicker();

  fireEvent.click(await screen.findByText("sonarr")); // lan
  fireEvent.click(screen.getByRole("button", { name: /External/ }));

  // Back to the deployment-wide "docker" hint — a stale lan hint would misdescribe it.
  expect(hostInput()).toHaveAttribute("placeholder", "jellyfin");
});

// --- Machines as upstreams (Phase 21a) ---

const MACHINES = [
  // A named machine: its upstream is a bare address, and `kind` says so.
  {
    id: "nas",
    name: "nas",
    type: "external",
    subdomain: "nas",
    kind: "machine",
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
    kind: "service",
    route_mode: "proxy",
    fqdn: "grafana.example.no",
    upstream: "192.168.10.60:3000",
    private: false,
    routed: true,
    synced: true,
    upstream_healthy: true,
  },
];

test("the host list offers named machines, and only those", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.mouseDown(await screen.findByRole("button", { name: "Show hosts" }));

  expect(screen.getByRole("option", { name: /nas/ })).toHaveTextContent("192.168.10.50");
  // grafana is a service on a machine, not an address to point at.
  expect(screen.queryByRole("option", { name: /grafana/ })).not.toBeInTheDocument();
});

test("picking a machine links the route to it, not just its address", async () => {
  // The link is what makes the route follow the machine when its IP changes.
  RESPONSES["/api/caddy/routes"] = MACHINES;
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await pickHost(/nas/);
  fireEvent.change(prefixInput(), { target: { value: "plex" } });
  fireEvent.change(portInput(), { target: { value: "32400" } });
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ machine: "nas", upstream: "192.168.10.50:32400" }),
  );
});

test("a typed address carries no machine link", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.change(prefixInput(), { target: { value: "thing" } });
  typeUpstream("192.168.10.77", "8080");
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.not.objectContaining({ machine: expect.anything() }),
  );
});

test("typing over a picked machine unlinks it", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await pickHost(/nas/);
  expect(screen.getByText(/Linked to nas/)).toBeInTheDocument();
  fireEvent.change(prefixInput(), { target: { value: "thing" } });
  typeUpstream("192.168.10.77", "8080");
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(screen.queryByText(/Linked to nas/)).not.toBeInTheDocument();
  expect(onSubmit).toHaveBeenCalledWith(
    expect.not.objectContaining({ machine: expect.anything() }),
  );
});

test("picking a machine fills its address and leaves the port to type", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await pickHost(/nas/);

  expect(hostInput()).toHaveValue("192.168.10.50");
  expect(portInput()).toHaveValue("");
});

test("picking a machine keeps a port already typed", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.change(portInput(), { target: { value: "32400" } });
  await pickHost(/nas/);

  expect(portInput()).toHaveValue("32400");
});

test("picking a machine leaves the prefix alone", async () => {
  // Prefilling it with the machine's name would collide with the name the machine
  // already answers to — the route is a service *on* it, not the machine itself.
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await pickHost(/nas/);

  expect(prefixInput()).toHaveValue("");
});

test("typing filters the host list by name or address", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  RESPONSES["/api/settings"] = {
    ...(DEFAULT_SETTINGS as object),
    host_ip: { value: "192.168.10.220", source: "stored", secret: false },
  };
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await screen.findByRole("button", { name: "Show hosts" });
  fireEvent.change(hostInput(), { target: { value: "dock" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
    "Docker host192.168.10.220",
  ]);

  fireEvent.change(hostInput(), { target: { value: "10.50" } });
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["nas192.168.10.50"]);
});

test("the keyboard picks from the list — but Enter never swaps a typed address", async () => {
  RESPONSES["/api/caddy/routes"] = MACHINES;
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  await screen.findByRole("button", { name: "Show hosts" });

  // "192.168.10.5" is a prefix of nas's address; Enter must leave what was typed.
  fireEvent.change(hostInput(), { target: { value: "192.168.10.5" } });
  fireEvent.keyDown(hostInput(), { key: "Enter" });
  expect(hostInput()).toHaveValue("192.168.10.5");

  // An arrow key highlights; then Enter picks.
  fireEvent.keyDown(hostInput(), { key: "ArrowDown" });
  fireEvent.keyDown(hostInput(), { key: "Enter" });
  expect(hostInput()).toHaveValue("192.168.10.50");
  expect(screen.getByText(/Linked to nas/)).toBeInTheDocument();
});

test("with no hosts to offer, the host field is a plain text field", async () => {
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  expect(screen.queryByRole("button", { name: "Show hosts" })).not.toBeInTheDocument();
  fireEvent.change(prefixInput(), { target: { value: "tv" } });
  typeUpstream("192.168.10.77", "8080");
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ upstream: "192.168.10.77:8080" }));
});

// --- Per-route scheme (Phase 12b) ---

test("the scheme defaults to https and rides along with the route", () => {
  const { onSubmit } = renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.change(prefixInput(), { target: { value: "tv" } });
  typeUpstream("192.168.10.50", "8080");
  fireEvent.click(screen.getByRole("button", { name: "HTTP" }));
  fireEvent.click(screen.getByRole("button", { name: "Add route" }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scheme: "http" }));
});

test("the preview drops to http:// when the scheme does", () => {
  renderPicker();

  fireEvent.click(screen.getByRole("button", { name: /External/ }));
  fireEvent.change(screen.getByPlaceholderText("grafana"), { target: { value: "tv" } });
  expect(screen.getByText("https://tv.example.no")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "HTTP" }));

  expect(screen.getByText("http://tv.example.no")).toBeInTheDocument();
});
