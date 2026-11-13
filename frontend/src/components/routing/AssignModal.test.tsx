import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AssignModal } from "./AssignModal";

const hostInput = () =>
  screen.getByRole("combobox", { name: "Host" }) as HTMLInputElement;
const portInput = () => screen.getByRole("textbox", { name: "Port" }) as HTMLInputElement;

function typeUpstream(host: string, port: string) {
  fireEvent.change(hostInput(), { target: { value: host } });
  fireEvent.change(portInput(), { target: { value: port } });
}

// The host dropdown, opened from its chevron.
function hostList() {
  fireEvent.mouseDown(screen.getByRole("button", { name: "Show hosts" }));
  return screen.getAllByRole("option").map((o) => o.textContent);
}

function renderModal(overrides = {}) {
  const onSubmit = vi.fn();
  render(
    <AssignModal
      open
      baseDomain="example.no"
      mode="lan"
      onSubmit={onSubmit}
      onClose={() => {}}
      {...overrides}
    />,
  );
  return { onSubmit };
}

test("shows where it will open as you type the prefix, over the scheme picked", () => {
  renderModal();
  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "jelly" },
  });
  expect(screen.getByText("https://jelly.example.no")).toBeInTheDocument();
  // The same line Add route shows: an HTTP-only route opens at http://.
  fireEvent.click(screen.getByRole("button", { name: "HTTP" }));
  expect(screen.getByText("http://jelly.example.no")).toBeInTheDocument();
});

test("Assign is disabled until prefix and upstream are valid", () => {
  const { onSubmit } = renderModal();
  const assign = screen.getByRole("button", { name: "Assign" });
  expect(assign).toBeDisabled();

  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "grafana" },
  });
  typeUpstream("192.168.10.100", "3000");
  expect(assign).toBeEnabled();

  fireEvent.click(assign);
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "grafana",
    upstream: "192.168.10.100:3000",
    upstream_tls: false,
    scheme: "https",
  });
});

test("the HTTPS-backend checkbox sets upstream_tls", () => {
  const { onSubmit } = renderModal();
  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "proxmox" },
  });
  typeUpstream("192.168.10.202", "8006");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "proxmox",
    upstream: "192.168.10.202:8006",
    upstream_tls: true,
    scheme: "https",
  });
});

test("uses the Docker upstream hint in docker mode", () => {
  renderModal({ mode: "docker" });
  expect(hostInput()).toHaveAttribute("placeholder", "jellyfin");
});

test("prefills prefix, upstream, and TLS when re-assigning an instance", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "proxmox",
    initialUpstream: "192.168.10.202:8006",
    initialTls: true,
  });
  const assign = screen.getByRole("button", { name: "Assign" });
  expect(assign).toBeEnabled(); // valid prefilled values -> submittable immediately
  fireEvent.click(assign);
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "proxmox",
    upstream: "192.168.10.202:8006",
    upstream_tls: true,
    scheme: "https",
  });
});

// --- The host list: the Docker host, this container, the named machines ---

const MACHINES = [
  {
    id: "nas", name: "nas", type: "external" as const, kind: "machine" as const,
    subdomain: "nas", fqdn: "nas.example.no", upstream: "192.168.10.50",
    private: false, routed: true, synced: null,
  },
  {
    id: "web", name: "web", type: "external" as const, kind: "service" as const,
    subdomain: "web", fqdn: "web.example.no", upstream: "192.168.10.60:80",
    private: false, routed: true, synced: true,
  },
];

test("the host list offers the Docker host, this container and the machines — not services", () => {
  renderModal({ rows: MACHINES, dockerHost: "192.168.10.220", containerHost: "jellyfin" });

  expect(hostList()).toEqual([
    "Docker host192.168.10.220", "This containerjellyfin", "nas192.168.10.50",
  ]);
});

test("picking a machine types its address in, keeps the port, and links nothing", () => {
  // The route is on the machine because of its address — there is no link to send.
  const { onSubmit } = renderModal({
    rows: MACHINES,
    initialPrefix: "plex",
    initialUpstream: "10.0.0.9:32400",
  });

  hostList();
  fireEvent.mouseDown(screen.getByRole("option", { name: /nas/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  expect(onSubmit.mock.calls[0][0]).toMatchObject({ upstream: "192.168.10.50:32400" });
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("machine");
});

test("a machine on the Docker host's address is one entry, named both ways", () => {
  renderModal({ rows: MACHINES, dockerHost: "192.168.10.50", containerHost: "192.168.10.50" });

  expect(hostList()).toEqual(["Docker host · This container · nas192.168.10.50"]);
});

test("with nothing to offer, the host field is a plain text field", () => {
  renderModal({ rows: [] });

  expect(screen.queryByRole("button", { name: "Show hosts" })).not.toBeInTheDocument();
});

test("an existing route's scheme is prefilled and editable", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "tv",
    initialUpstream: "192.168.10.50:8080",
    initialScheme: "http",
  });

  // Prefilled: the current scheme is the selected one...
  fireEvent.click(screen.getByRole("button", { name: "Both" }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  // ...and changing it is what makes the toggle useful on an existing route.
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ scheme: "both" }));
});

// --- A container's route can follow it (Phase 29) ---


test("a following route shows the container's address, locked", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "whoami",
    initialUpstream: "192.168.10.220:8081",
    follow: { initial: true, derived: "192.168.10.220:8081" },
  });

  expect(hostInput()).toHaveValue("192.168.10.220");
  expect(portInput()).toHaveValue("8081");
  expect(hostInput().readOnly && portInput().readOnly).toBe(true);
  // Locked means no list either.
  expect(screen.queryByRole("button", { name: "Show hosts" })).not.toBeInTheDocument();
  expect(screen.getByText(/Follows the container/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ follow_container: true }));
});

test("Set by hand unlocks the address and stops following", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "whoami",
    initialUpstream: "192.168.10.220:8081",
    follow: { initial: true, derived: "192.168.10.220:8081" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Set by hand" }));
  expect(hostInput().readOnly || portInput().readOnly).toBe(false);
  fireEvent.change(portInput(), { target: { value: "9000" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ follow_container: false, upstream: "192.168.10.220:9000" }),
  );
});

test("a route set by hand is offered following, with the address it would get", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "whoami",
    initialUpstream: "10.0.0.9:9000",
    follow: { initial: false, derived: "192.168.10.220:8081" },
  });

  fireEvent.click(screen.getByRole("button", { name: /Follow the container \(192\.168\.10\.220:8081\)/ }));

  expect(hostInput()).toHaveValue("192.168.10.220");
  expect(portInput()).toHaveValue("8081");
  expect(hostInput().readOnly).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ follow_container: true }));
});

test("a container whose port Docker can't name says how to make it followable", () => {
  renderModal({ initialPrefix: "bambuddy", follow: { initial: false, derived: null } });

  expect(screen.getByText(/can't name this container's port/)).toBeInTheDocument();
  expect(screen.getByText("loskai.port")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Follow the container/ })).not.toBeInTheDocument();
});

test("a route that isn't a container's never mentions following", () => {
  const { onSubmit } = renderModal({ initialPrefix: "nas", initialUpstream: "192.168.10.50:5000" });

  expect(screen.queryByText(/Follow/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("follow_container");
});
