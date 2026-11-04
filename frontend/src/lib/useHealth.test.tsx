import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { useHealth } from "./useHealth";

function Poller() {
  useHealth();
  return null;
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Each poll renews the session, so an open page keeps it even in a background tab, as
// Proxmox's does.
test("the health poll goes on while the tab is in the background", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Poller />
    </QueryClientProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(fetch).toHaveBeenCalledTimes(1);

  focusManager.setFocused(false); // the tab hidden
  await act(() => vi.advanceTimersByTimeAsync(65_000));

  expect(fetch).toHaveBeenCalledTimes(3);
});
