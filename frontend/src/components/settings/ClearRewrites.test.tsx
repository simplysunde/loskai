import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ClearRewrites } from "./ClearRewrites";

const CLEAR = "/api/adguard/rewrites/clear";

const REWRITES: unknown = {
  rewrites: [
    { domain: "grafana.example.no", answer: "192.168.10.101", managed: true },
    { domain: "printer.example.no", answer: "10.0.0.9", managed: false },
  ],
};

// The action is destructive and irreversible for rewrites Loskai didn't write, so the
// things worth pinning are that it never fires without the dialog being confirmed, and
// that the dialog shows what is about to go.
function renderPanel({
  list = REWRITES as unknown,
  clear = { cleared: [], restored: [], conflicts: [], errors: [] } as unknown,
  clearStatus = 200,
  listStatus = 200,
} = {}) {
  const fetchMock = vi.fn(async (path: string) => {
    const [body, status] = path === CLEAR ? [clear, clearStatus] : [list, listStatus];
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <ClearRewrites />
    </QueryClientProvider>,
  );
  return {
    fetchMock,
    cleared: () => fetchMock.mock.calls.filter(([p]) => p === CLEAR),
  };
}

const openDialog = () =>
  fireEvent.click(screen.getByRole("button", { name: /Clear rewrites/ }));


test("the button only opens the dialog — nothing is cleared yet", async () => {
  const { cleared } = renderPanel();

  openDialog();

  expect(screen.getByText("Clear all DNS rewrites?")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/Show the 2 rewrites/)).toBeInTheDocument());
  expect(cleared()).toHaveLength(0);
});

test("cancelling leaves AdGuard untouched", async () => {
  const { cleared } = renderPanel();

  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(cleared()).toHaveLength(0);
  expect(screen.queryByText("Clear all DNS rewrites?")).not.toBeInTheDocument();
});

test("the warning names hand-added rewrites as collateral", () => {
  renderPanel();

  openDialog();

  expect(screen.getByText(/including any you added by hand/)).toBeInTheDocument();
  expect(screen.getByText(/cannot be recovered/)).toBeInTheDocument();
});

test("the preview lists every entry and says which survive", async () => {
  renderPanel();

  openDialog();

  await waitFor(() =>
    expect(screen.getByText(/grafana\.example\.no/)).toBeInTheDocument(),
  );
  expect(screen.getByText(/printer\.example\.no/)).toBeInTheDocument();
  expect(screen.getByText("restored")).toBeInTheDocument();
  expect(screen.getByText("not restored")).toBeInTheDocument();
  // The count of what will NOT come back is the number that matters before confirming.
  expect(screen.getByText(/1 not restored/)).toBeInTheDocument();
});

test("an all-managed list offers no loss warning", async () => {
  renderPanel({
    list: {
      rewrites: [{ domain: "grafana.example.no", answer: "192.168.10.101", managed: true }],
    },
  });

  openDialog();

  await waitFor(() => expect(screen.getByText(/Show the 1 rewrite/)).toBeInTheDocument());
  expect(screen.queryByText(/not restored/)).not.toBeInTheDocument();
});

test("an empty rewrite list says so instead of showing an empty disclosure", async () => {
  renderPanel({ list: { rewrites: [] } });

  openDialog();

  await waitFor(() =>
    expect(screen.getByText(/AdGuard holds no rewrites right now/)).toBeInTheDocument(),
  );
});

test("an unreadable list warns without blocking the dialog", async () => {
  renderPanel({ listStatus: 502, list: { detail: "AdGuard unreachable" } });

  openDialog();

  await waitFor(() =>
    expect(screen.getByText(/Couldn't read the current rewrites/)).toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "Clear and restore" })).toBeInTheDocument();
});

test("confirming posts the reset and reports both halves", async () => {
  const { fetchMock } = renderPanel({
    clear: {
      cleared: ["a.example.no", "b.old.lan"],
      restored: ["a.example.no"],
      conflicts: [],
      errors: [],
    },
  });

  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() =>
    expect(screen.getByText("Removed 2 rewrites, restored 1 rewrite.")).toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    CLEAR,
    expect.objectContaining({ method: "POST" }),
  );
});

test("a failed delete is surfaced, not folded into the success line", async () => {
  renderPanel({
    clear: {
      cleared: ["a.example.no"],
      restored: ["a.example.no"],
      conflicts: [],
      errors: [{ domain: "b.example.no", detail: "connection refused" }],
    },
  });

  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() => expect(screen.getByText(/1 delete failed\./)).toBeInTheDocument());
});

test("AdGuard being unreachable shows the error, not a false success", async () => {
  renderPanel({ clear: { detail: "AdGuard unreachable" }, clearStatus: 502 });

  openDialog();
  fireEvent.click(screen.getByRole("button", { name: "Clear and restore" }));

  await waitFor(() =>
    expect(screen.getByText("AdGuard unreachable")).toBeInTheDocument(),
  );
});
