import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ClearRewrites } from "./ClearRewrites";

// The action is destructive and irreversible for rewrites Loskai didn't write, so the
// thing worth pinning is that it never fires without the dialog being confirmed.
function renderPanel(post: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", post);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <ClearRewrites />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("the button only opens the dialog — nothing is cleared yet", () => {
  const post = jsonResponse({ cleared: [], restored: [], conflicts: [], errors: [] });
  renderPanel(post);

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));

  expect(screen.getByText("Clear all DNS rewrites?")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("cancelling leaves AdGuard untouched", () => {
  const post = jsonResponse({ cleared: [], restored: [], conflicts: [], errors: [] });
  renderPanel(post);

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(post).not.toHaveBeenCalled();
  expect(screen.queryByText("Clear all DNS rewrites?")).not.toBeInTheDocument();
});

test("the warning names hand-added rewrites as collateral", () => {
  renderPanel(jsonResponse({}));

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));

  expect(screen.getByText(/including any you added by hand/)).toBeInTheDocument();
  expect(screen.getByText(/cannot be recovered/)).toBeInTheDocument();
});

test("confirming posts the reset and reports both halves", async () => {
  const post = jsonResponse({
    cleared: ["a.example.no", "b.old.lan"],
    restored: ["a.example.no"],
    conflicts: [],
    errors: [],
  });
  renderPanel(post);

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() =>
    expect(screen.getByText("Removed 2 rewrites, restored 1 rewrite.")).toBeInTheDocument(),
  );
  expect(post).toHaveBeenCalledWith(
    "/api/adguard/rewrites/clear",
    expect.objectContaining({ method: "POST" }),
  );
});

test("a failed delete is surfaced, not folded into the success line", async () => {
  renderPanel(
    jsonResponse({
      cleared: ["a.example.no"],
      restored: ["a.example.no"],
      conflicts: [],
      errors: [{ domain: "b.example.no", detail: "connection refused" }],
    }),
  );

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() => expect(screen.getByText(/1 delete failed\./)).toBeInTheDocument());
});

test("AdGuard being unreachable shows the error, not a false success", async () => {
  renderPanel(jsonResponse({ detail: "AdGuard unreachable" }, 502));

  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() =>
    expect(screen.getByText("AdGuard unreachable")).toBeInTheDocument(),
  );
});
