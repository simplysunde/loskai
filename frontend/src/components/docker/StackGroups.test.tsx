import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { StackGroups } from "./StackGroups";
import { VolumeList } from "./VolumeList";

const container = (name: string, project: string | null, status = "running") => ({
  id: name, name, image: `${name}/img`, project, status, uptime: 60, ports: [],
  subdomain: null, suggested_upstream: null, cpu: 1, mem: { percent: 2 },
});

const RESPONSES: Record<string, unknown> = {
  "/api/docker/containers": [
    container("immich-server", "immich"),
    container("immich-db", "immich", "exited"),
    container("loskai", "loskai"),
    container("portainer", null),
  ],
  "/api/docker/stacks": [{ name: "immich", services: ["server", "db"], status: "partial" }],
  "/api/docker/volumes": [
    { name: "immich_pgdata", driver: "local", size: 2048, project: "immich", anonymous: false, used_by: ["immich-db"] },
    { name: "f".repeat(64), driver: "local", size: null, project: null, anonymous: true, used_by: [] },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      new Response(JSON.stringify(RESPONSES[path] ?? {}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderWith(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const noop = () => {};
const groups = () =>
  renderWith(
    <StackGroups
      baseDomain="example.no"
      onLogs={noop}
      onTerminal={noop}
      onRemove={noop}
      onEditStack={noop}
      onDeleteStack={noop}
    />,
  );
const header = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) }).closest("tr")!;

test("a managed stack carries its actions; a project from elsewhere and standalone don't", async () => {
  groups();
  await screen.findByText("immich-server");

  expect(within(header("immich")).getByTitle("Up")).toBeInTheDocument();
  expect(within(header("immich")).getByText("1 of 2 running")).toBeInTheDocument();
  expect(within(header("loskai")).queryByTitle("Up")).not.toBeInTheDocument();
  expect(within(header("loskai")).getByText("not in stacks folder")).toBeInTheDocument();
  expect(within(header("Standalone")).queryByTitle("Up")).not.toBeInTheDocument();
  expect(screen.getByText("portainer")).toBeInTheDocument();
});

test("collapsing a stack hides its containers, not the others", async () => {
  groups();
  await screen.findByText("immich-server");

  fireEvent.click(screen.getByRole("button", { name: /^immich/ }));

  expect(screen.queryByText("immich-server")).not.toBeInTheDocument();
  expect(screen.getByText("portainer")).toBeInTheDocument();
});

test("volumes show what mounts them, and flag the ones nothing does", async () => {
  renderWith(<VolumeList />);

  expect(await screen.findByText("immich_pgdata")).toBeInTheDocument();
  expect(screen.getByText("immich-db")).toBeInTheDocument();
  expect(screen.getByText("unused")).toBeInTheDocument();
  // An anonymous volume's 64-hex name is shortened, and labelled as such.
  expect(screen.getByText(`${"f".repeat(12)}…`)).toBeInTheDocument();
  expect(screen.getByText(/1 unused/)).toBeInTheDocument();
});
