import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { InlineSettingsFields } from "./InlineSettingsFields";

const SETTINGS = { base_domain: { value: "example.no", source: "stored", secret: false } };

function renderField() {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(SETTINGS), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <InlineSettingsFields fields={[{ key: "base_domain", label: "Base domain" }]} />
    </QueryClientProvider>,
  );
  return puts;
}

afterEach(() => vi.unstubAllGlobals());

test("Escape puts a field back and saves nothing", async () => {
  const puts = renderField();
  const input = await screen.findByDisplayValue("example.no");
  act(() => input.focus()); // a real focus: the key handler's blur() then fires onBlur in it
  fireEvent.change(input, { target: { value: "typo.no" } });
  fireEvent.keyDown(input, { key: "Escape" });

  await waitFor(() => expect(input).toHaveValue("example.no"));
  await new Promise((r) => setTimeout(r, 50));
  expect(puts).toEqual([]);
});

test("Enter saves the field", async () => {
  const puts = renderField();
  const input = await screen.findByDisplayValue("example.no");
  act(() => input.focus());
  fireEvent.change(input, { target: { value: "home.no" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => expect(puts).toEqual([{ base_domain: "home.no" }]));
});
