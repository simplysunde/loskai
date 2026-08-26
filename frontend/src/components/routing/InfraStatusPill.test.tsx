import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test } from "vitest";

import { InfraStatusPill } from "./InfraStatusPill";

function pill(props: Partial<Parameters<typeof InfraStatusPill>[0]> = {}) {
  return render(
    <MemoryRouter>
      <InfraStatusPill icon={null} name="AdGuard" linkLabel="Open AdGuard" {...props} />
    </MemoryRouter>,
  );
}

test("links out to the service when a URL is known", () => {
  pill({ health: { status: "healthy" }, url: "http://192.168.10.101:3000" });

  const link = screen.getByRole("link", { name: /Open AdGuard/ });
  expect(link).toHaveAttribute("href", "http://192.168.10.101:3000");
  expect(screen.getByText("online")).toBeInTheDocument();
});

test("offers Configure instead of a dead link when there is no URL", () => {
  pill({ health: { status: "unconfigured" }, url: null });

  expect(screen.queryByRole("link", { name: /Open AdGuard/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Configure/ })).toHaveAttribute(
    "href",
    "/settings/network",
  );
  expect(screen.getByText("not configured")).toBeInTheDocument();
});

test("surfaces the failure detail only when unhealthy", () => {
  const { rerender } = pill({
    health: { status: "unreachable", detail: "connection refused" },
    url: "http://caddy:2019",
  });
  expect(screen.getByText("connection refused")).toBeInTheDocument();

  rerender(
    <MemoryRouter>
      <InfraStatusPill
        icon={null}
        name="AdGuard"
        linkLabel="Open AdGuard"
        health={{ status: "healthy", detail: "connection refused" }}
        url="http://caddy:2019"
      />
    </MemoryRouter>,
  );
  expect(screen.queryByText("connection refused")).not.toBeInTheDocument();
});
