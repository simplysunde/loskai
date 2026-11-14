import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { LinkModal } from "./LinkModal";
import type { Instance } from "./ServiceTable";

const host = () => screen.getByRole("combobox", { name: "Host" }) as HTMLInputElement;
const port = () => screen.getByRole("textbox", { name: "Port" }) as HTMLInputElement;

function row(overrides: Partial<Instance>): Instance {
  return {
    id: "jellyfin", name: "Jellyfin", type: "docker", kind: "service", subdomain: null, fqdn: null,
    upstream: null, private: false, routed: false, synced: null, ...overrides,
  };
}

test("a container's record from an old route never starts at Caddy's address", () => {
  // Routed once as `jellyfin:8096` (Caddy on its network), the route removed since: a
  // browser can't open that name, so the link starts at the Docker host.
  render(
    <LinkModal
      row={row({ container: "jellyfin-jellyfin-1", upstream: "jellyfin:8096" })}
      dockerHost="192.168.10.220"
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );

  expect(host().value).toBe("192.168.10.220");
  expect(port().value).toBe("");
});

test("a container's record starts at its published port, following it", () => {
  const onSubmit = vi.fn();
  render(
    <LinkModal
      row={row({ container: "jellyfin-jellyfin-1", upstream: "jellyfin:8096" })}
      published="192.168.10.220:8096"
      onSubmit={onSubmit}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save link" }));

  expect(onSubmit).toHaveBeenCalledWith({
    name: "Jellyfin", upstream: "192.168.10.220:8096", upstream_tls: false, follow_container: true,
  });
});

test("a link being edited keeps its address; another record's LAN address is a fine start", () => {
  const { unmount } = render(
    <LinkModal
      row={row({ route_mode: "direct", upstream: "192.168.10.50:5000", type: "external" })}
      dockerHost="192.168.10.220"
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );
  expect(host().value).toBe("192.168.10.50");
  unmount();

  render(
    <LinkModal
      row={row({ type: "external", upstream: "192.168.10.60:8123" })}
      dockerHost="192.168.10.220"
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );
  expect(host().value).toBe("192.168.10.60");
  expect(port().value).toBe("8123");
});
