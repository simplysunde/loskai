import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AssignModal } from "./AssignModal";

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

test("shows the assembled FQDN live as you type the prefix", () => {
  renderModal();
  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "jelly" },
  });
  expect(screen.getByText("jelly.example.no")).toBeInTheDocument();
});

test("Assign is disabled until prefix and upstream are valid", () => {
  const { onSubmit } = renderModal();
  const assign = screen.getByRole("button", { name: "Assign" });
  expect(assign).toBeDisabled();

  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "grafana" },
  });
  fireEvent.change(screen.getByPlaceholderText("e.g. 192.168.10.100:3000"), {
    target: { value: "192.168.10.100:3000" },
  });
  expect(assign).toBeEnabled();

  fireEvent.click(assign);
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "grafana",
    upstream: "192.168.10.100:3000",
    upstream_tls: false,
    machine: null,
    scheme: "https",
  });
});

test("the HTTPS-backend checkbox sets upstream_tls", () => {
  const { onSubmit } = renderModal();
  fireEvent.change(screen.getByPlaceholderText("grafana"), {
    target: { value: "proxmox" },
  });
  fireEvent.change(screen.getByPlaceholderText("e.g. 192.168.10.100:3000"), {
    target: { value: "192.168.10.202:8006" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenCalledWith({
    prefix: "proxmox",
    upstream: "192.168.10.202:8006",
    upstream_tls: true,
    machine: null,
    scheme: "https",
  });
});

test("uses the Docker upstream hint in docker mode", () => {
  renderModal({ mode: "docker" });
  expect(screen.getByPlaceholderText("e.g. grafana:3000")).toBeInTheDocument();
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
    machine: null,
    scheme: "https",
  });
});

// --- Linking an existing route to a machine (Phase 21g) ---

const MACHINES = [
  {
    id: "nas", name: "nas", type: "external" as const, kind: "machine" as const,
    subdomain: "nas", fqdn: "nas.example.no", upstream: "192.168.10.50",
    private: false, routed: true, synced: null, upstream_healthy: null,
  },
  {
    id: "web", name: "web", type: "external" as const, kind: "service" as const,
    subdomain: "web", fqdn: "web.example.no", upstream: "192.168.10.60:80",
    private: false, routed: true, synced: true, upstream_healthy: true,
  },
];

test("a route created before the link can be attached to a machine", () => {
  // The gap this closes: such a route otherwise had to be deleted and rebuilt.
  const { onSubmit } = renderModal({
    rows: MACHINES,
    initialPrefix: "plex",
    initialUpstream: "192.168.10.50:32400",
  });

  fireEvent.click(screen.getByRole("button", { name: /nas/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ machine: "nas", upstream: "192.168.10.50:32400" }),
  );
});

test("picking a machine keeps the port and takes its address", () => {
  const { onSubmit } = renderModal({
    rows: MACHINES,
    initialPrefix: "plex",
    initialUpstream: "10.0.0.9:32400",
  });

  fireEvent.click(screen.getByRole("button", { name: /nas/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ upstream: "192.168.10.50:32400" }),
  );
});

test("a linked route can be unlinked, and null is what says so", () => {
  const { onSubmit } = renderModal({
    rows: MACHINES,
    initialPrefix: "plex",
    initialUpstream: "192.168.10.50:32400",
    initialMachine: "nas",
  });

  fireEvent.click(screen.getByRole("button", { name: /unlink/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ machine: null }));
});

test("only machines are offered — a service is an address in use, not one to point at", () => {
  renderModal({ rows: MACHINES });

  expect(screen.getByRole("button", { name: /nas/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /web/ })).not.toBeInTheDocument();
});

test("with no machines named yet, the picker stays out of the way", () => {
  renderModal({ rows: [] });

  expect(screen.queryByText("Hosted on a machine")).not.toBeInTheDocument();
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

const upstream = () => screen.getByPlaceholderText("e.g. 192.168.10.100:3000") as HTMLInputElement;

test("a following route shows the container's address, locked", () => {
  const { onSubmit } = renderModal({
    initialPrefix: "whoami",
    initialUpstream: "192.168.10.220:8081",
    follow: { initial: true, derived: "192.168.10.220:8081" },
  });

  expect(upstream()).toHaveValue("192.168.10.220:8081");
  expect(upstream().readOnly).toBe(true);
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
  expect(upstream().readOnly).toBe(false);
  fireEvent.change(upstream(), { target: { value: "192.168.10.220:9000" } });
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

  expect(upstream()).toHaveValue("192.168.10.220:8081");
  expect(upstream().readOnly).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ follow_container: true }));
});

test("following and a machine link exclude each other in the form, as on the server", () => {
  const { onSubmit } = renderModal({
    rows: MACHINES,
    initialPrefix: "whoami",
    initialUpstream: "192.168.10.220:8081",
    initialMachine: "nas",
    follow: { initial: false, derived: "192.168.10.220:8081" },
  });

  // Following clears the machine...
  fireEvent.click(screen.getByRole("button", { name: /Follow the container/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenLastCalledWith(
    expect.objectContaining({ follow_container: true, machine: null }),
  );

  // ...and picking a machine stops following.
  fireEvent.click(screen.getByRole("button", { name: /nas/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));
  expect(onSubmit).toHaveBeenLastCalledWith(
    expect.objectContaining({ follow_container: false, machine: "nas" }),
  );
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
