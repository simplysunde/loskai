import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { MachineTerminal } from "./MachineTerminal";
import { json, renderWithQuery } from "../../test/render";

// The session, faked: buttons for what the machine prints and how the session ends.
vi.mock("../shared/XtermSession", () => ({
  XtermSession: ({ url, onOutput, onClosed }: {
    url: string; onOutput?: (t: string) => void; onClosed?: (code: number, reason: string) => void;
  }) => (
    <div>
      shell at {url}
      <button onClick={() => onOutput?.("Sharing 192.168.10.0/24\r\n")}>print</button>
      <button onClick={() => onOutput?.("\r\n[failed, exit 3] Enter closes this.\r\n")}>fail</button>
      <button onClick={() => onClosed?.(1000, "")}>end</button>
    </div>
  ),
}));

const KEY = {
  public_key: "ssh-ed25519 AAAA", fingerprint: "SHA256:x", lines: [], from: null,
  unlocked_until: new Date(Date.now() + 3600_000).toISOString(),
};
const RUN = { tool: "tailscale", action: "share", title: "Share this network" };

function renderRun({ automatic = true, quick = true } = {}) {
  const onClose = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (path: string) =>
    json(path.endsWith("/run") ? { automatic, needs_password: false, ticket: null } : {}),
  ));
  renderWithQuery(<MachineTerminal machine={{ id: "nas", name: "nas" }} sshKey={KEY} run={RUN} quick={quick} onClose={onClose} />);
  return onClose;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("an automatic run drops down over the page instead of opening a dialog", async () => {
  renderRun();

  const panel = await screen.findByRole("region", { name: "Share this network — nas" });
  expect(await screen.findByText(/shell at .*action=share/)).toBeInTheDocument();
  expect(panel).toHaveTextContent("Running…");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("done, it lingers with a bar — held while hovered, kept on Keep open — then slides away", async () => {
  const onClose = renderRun();
  await screen.findByText(/shell at/);
  fireEvent.click(screen.getByText("print"));
  fireEvent.click(screen.getByText("end"));

  const panel = screen.getByRole("region", { name: "Share this network — nas" });
  expect(panel).toHaveTextContent("Done");
  const bar = screen.getByTestId("linger");
  fireEvent.mouseEnter(panel);
  expect(bar.style.animationPlayState).toBe("paused");
  fireEvent.mouseLeave(panel);
  expect(bar.style.animationPlayState).toBe("running");

  // The bar emptying is the timer.
  vi.useFakeTimers();
  fireEvent.animationEnd(bar);
  act(() => vi.advanceTimersByTime(250));
  expect(onClose).toHaveBeenCalledOnce();
});

test("Keep open stops the timer", async () => {
  const onClose = renderRun();
  await screen.findByText(/shell at/);
  fireEvent.click(screen.getByText("end"));

  fireEvent.click(screen.getByRole("button", { name: /Keep open/ }));
  expect(screen.queryByTestId("linger")).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test("a failed run says its exit code and stays until it is read", async () => {
  const onClose = renderRun();
  await screen.findByText(/shell at/);
  fireEvent.click(screen.getByText("fail"));

  const panel = screen.getByRole("region", { name: "Share this network — nas" });
  expect(panel).toHaveTextContent("Failed — exit 3");
  expect(screen.queryByTestId("linger")).not.toBeInTheDocument();
  // Enter in the terminal, once read, ends the session: then it goes.
  fireEvent.click(screen.getByText("end"));
  expect(onClose).toHaveBeenCalledOnce();
});

test("a run that turns out not to be automatic opens as a dialog", async () => {
  renderRun({ automatic: false });

  expect(await screen.findByRole("dialog", { name: "Share this network — nas" })).toBeInTheDocument();
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
