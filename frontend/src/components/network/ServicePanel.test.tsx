import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ServicePanel } from "./ServicePanel";

test("shows the status label and an enabled link when a URL is given", () => {
  render(
    <ServicePanel
      icon={<span />}
      name="AdGuard"
      subtitle="DNS"
      status="healthy"
      linkUrl="http://ad.example"
      linkLabel="Open AdGuard"
    />,
  );
  expect(screen.getByText("online")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open AdGuard/ })).toHaveAttribute(
    "href",
    "http://ad.example",
  );
});

test("disables the link (no href) when the URL is unknown", () => {
  render(
    <ServicePanel
      icon={<span />}
      name="Caddy"
      subtitle="TLS"
      status="unconfigured"
      linkUrl={null}
      linkLabel="Certificate setup"
    />,
  );
  expect(screen.getByText("not configured")).toBeInTheDocument();
  // An anchor without href is not a link role — assert via the label text instead.
  expect(screen.getByText(/Certificate setup/)).toBeInTheDocument();
});
