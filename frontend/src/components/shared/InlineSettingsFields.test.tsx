import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { InlineSettingsFields } from "./InlineSettingsFields";
import { renderWithQuery, json } from "../../test/render";

const SETTINGS = { base_domain: { value: "example.no", source: "stored", secret: false } };

function renderField() {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
      return json(SETTINGS);
    }),
  );
  renderWithQuery(<InlineSettingsFields fields={[{ key: "base_domain", label: "Base domain" }]} />);
  return puts;
}


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

test("a refused choice goes back to the stored one, and says why", async () => {
  const choices = [{ value: "120", label: "2 hours" }, { value: "10080", label: "7 days" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? json({ detail: "Settings are read-only here" }, 422)
        : json({ session_idle_minutes: { value: "120", source: "stored", secret: false } }),
    ),
  );
  renderWithQuery(<InlineSettingsFields fields={[{ key: "session_idle_minutes", label: "Idle", options: choices }]} />);
  const select = await screen.findByDisplayValue("2 hours");

  fireEvent.change(select, { target: { value: "10080" } });

  expect(await screen.findByText("Settings are read-only here")).toBeInTheDocument();
  expect(select).toHaveValue("120");
});
