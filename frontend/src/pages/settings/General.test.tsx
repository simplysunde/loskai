import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";

import { General } from "./General";
import { json, renderWithQuery } from "../../test/render";

const DOCKER_HOST = {
  id: "dockerhost", name: "dockerhost", type: "external", kind: "machine", subdomain: "dockerhost",
  fqdn: "dockerhost.example.no", upstream: "192.168.10.220", route_mode: "dns_only",
  private: false, routed: true, synced: null,
};

function renderGeneral({ hostIp, routes = [], trusted = {} }: {
  hostIp?: string; routes?: unknown[]; trusted?: Record<string, boolean>;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      json(
        path === "/api/settings"
          ? { host_ip: { value: hostIp ?? null, source: hostIp ? "stored" : null } }
          : path === "/api/caddy/routes"
            ? routes
            : path === "/api/ssh"
              ? { key: null, hosts: {}, trusted }
              : {},
      ),
    ),
  );
  renderWithQuery(
    <MemoryRouter>
      <General />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const link = () => screen.findByRole("link", { name: /Tailscale on the Docker host/ });

test("the Tailscale field links to the Docker host on the Machines tab, to name it", async () => {
  renderGeneral({ hostIp: "192.168.10.220" });
  expect(await link()).toHaveAttribute("href", "/machines");
});

test("a named Docker host opens at its SSH until that is set up, then at its tools", async () => {
  renderGeneral({ hostIp: "192.168.10.220", routes: [DOCKER_HOST] });
  await vi.waitFor(async () => expect(await link()).toHaveAttribute("href", "/machines/dockerhost/ssh"));
});

test("a set-up Docker host opens at its tools", async () => {
  renderGeneral({ hostIp: "192.168.10.220", routes: [DOCKER_HOST], trusted: { dockerhost: true } });
  await vi.waitFor(async () => expect(await link()).toHaveAttribute("href", "/machines/dockerhost/tools"));
});

test("without the Docker host's LAN IP there is nothing to link to", async () => {
  renderGeneral({});
  await screen.findByText("Docker Host Tailscale IP");
  expect(screen.queryByRole("link", { name: /Tailscale on the Docker host/ })).not.toBeInTheDocument();
});
