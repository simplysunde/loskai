import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { Certificate } from "./Certificate";

const ROOT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBozCCAUmg\n-----END CERTIFICATE-----\n";

let response: { status: number; body: unknown } = {
  status: 200,
  body: { pem: ROOT_PEM, common_name: "Caddy Local Authority", filename: "caddy-root.crt" },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(response.body), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  response = {
    status: 200,
    body: { pem: ROOT_PEM, common_name: "Caddy Local Authority", filename: "caddy-root.crt" },
  };
});

async function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <Certificate />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Certificate" });
}

test("offers the root as a download once Caddy answers", async () => {
  await renderPage();
  expect(await screen.findByRole("button", { name: /caddy-root\.crt/ })).toBeInTheDocument();
  expect(screen.getByText("Caddy Local Authority")).toBeInTheDocument();
});

// The regression the whole endpoint exists for: a direct link to Caddy's own :80 file is
// a plain-HTTP download from an HTTPS page, which Chrome and Edge block without telling
// anyone. The PEM has to arrive as data and be saved by the page.
test("saves the certificate from the page, never as a cross-origin link", async () => {
  Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  // Intercept on the prototype: jsdom would otherwise try to navigate, and the point is
  // to inspect whatever anchor the page built.
  let saved: { href: string; download: string } | null = null;
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      saved = { href: this.href, download: this.download };
    });
  await renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /caddy-root\.crt/ }));

  expect(saved).toEqual({ href: "blob:test", download: "caddy-root.crt" });
  click.mockRestore();
});

// Phase 12's open defect: `update-ca-certificates` is Debian's, and doesn't exist on
// Fedora — the page confidently printed a command that could only fail there.
test("gives Fedora its own trust-store command, not Debian's", async () => {
  await renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Linux" }));

  expect(screen.getByText(/\/etc\/pki\/ca-trust\/source\/anchors\//)).toBeInTheDocument();
  expect(screen.getByText(/sudo update-ca-trust/)).toBeInTheDocument();
  expect(screen.getByText(/\/usr\/local\/share\/ca-certificates\//)).toBeInTheDocument();
});

// Chrome on Linux reads NSS, not the system store, so the system-wide install alone
// leaves the warning in place in the browser most people are using.
test("covers Chrome's separate store on Linux", async () => {
  await renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Linux" }));

  expect(screen.getByText(/certutil -d sql:\$HOME\/\.pki\/nssdb/)).toBeInTheDocument();
});

test("says there is nothing to install when Caddy runs no internal CA", async () => {
  response = { status: 409, body: { detail: "Caddy has no internal CA" } };
  await renderPage();

  expect(await screen.findByText(/Nothing to install/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /caddy-root\.crt/ })).not.toBeInTheDocument();
});

test("reports an unreachable Caddy instead of a silent empty page", async () => {
  response = { status: 502, body: { detail: "Connection refused" } };
  await renderPage();

  expect(await screen.findByText(/Couldn't reach Caddy/)).toBeInTheDocument();
});
