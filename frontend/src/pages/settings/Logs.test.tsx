import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { Logs } from "./Logs";
import { json } from "../../test/render";

const SIGN_INS = [
  { at: "2026-11-06T10:01:00+00:00", user: "admin", from: "10.0.0.5", ok: true },
  { at: "2026-11-06T10:00:00+00:00", user: "root", from: "10.0.0.9", ok: false },
];
const SSH_LOG = [{ at: "2026-11-06T09:00:00+00:00", event: "open", machine: "nas", from: "10.0.0.5", user: "admin", target: "loskai@nas" }];

test("both logs, a wrong password by the name typed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => json(path === "/api/auth/logins" ? SIGN_INS : path === "/api/ssh/log" ? SSH_LOG : [])),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Logs />
    </QueryClientProvider>,
  );

  const root = (await screen.findByText("root")).closest("tr") as HTMLElement;
  expect(within(root).getByText("Wrong password")).toHaveClass("text-amber-300");
  expect(within(root).getByText("10.0.0.9")).toBeInTheDocument();
  expect(screen.getByText("Signed in")).toBeInTheDocument();
  expect(await screen.findByText("Terminal opened (loskai@nas)")).toBeInTheDocument();
});
