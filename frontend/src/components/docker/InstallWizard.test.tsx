import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { InstallWizard } from "./InstallWizard";

const GRAFANA = {
  id: "grafana",
  name: "Grafana",
  type: "pull",
  description: "Dashboards",
  env: [
    { key: "PORT", label: "Host port", default: "3000" },
    { key: "DATA", label: "Data folder", type: "path", default: "./data" },
  ],
  suggested_subdomain: "grafana",
  instructions: "# Grafana\nFirst login is admin / admin.\n",
  source: "loskai-recipes",
  source_url: "https://git.example/sunde/loskai-recipes.git",
};

const SOURCES = [
  {
    url: "https://git.example/sunde/loskai-recipes.git",
    label: "loskai-recipes",
    enabled: true,
    builtin: true,
    synced: true,
    count: 1,
  },
];

// The wizard is the only surface that runs an install, and two things it reports are not
// reconstructible from anywhere else: the recipe's own instructions.md, and which copy of
// a duplicated recipe id actually won.
function renderWizard({
  recipes = [GRAFANA] as unknown[],
  invalid = [] as unknown[],
  shadowed = [] as unknown[],
  sources = SOURCES as unknown[],
  local_count = 0,
  install = { ok: true, output: "Started", container: "grafana-app-1" } as unknown,
} = {}) {
  const fetchMock = vi.fn(async (path: string) => {
    const body = path.endsWith("/install")
      ? install
      : { recipes, invalid, shadowed, sources, local_count };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <InstallWizard onClose={() => {}} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const pickGrafana = async () => fireEvent.click(await screen.findByText("Grafana"));

afterEach(() => vi.unstubAllGlobals());

test("the review step shows the recipe's instructions before the form", async () => {
  renderWizard();
  await pickGrafana();

  expect(screen.getByText(/First login is admin \/ admin/)).toBeInTheDocument();
  // The form is one step further on — the walk-through comes first.
  expect(screen.queryByText("Host port")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("Host port")).toBeInTheDocument();
});

test("the review step names what the install will create", async () => {
  renderWizard();
  await pickGrafana();

  expect(screen.getByText("grafana/")).toBeInTheDocument();
  expect(screen.getByText("./data")).toBeInTheDocument();
  expect(screen.getByText(/— in its own folder/)).toBeInTheDocument();
  expect(screen.getByText("PORT, DATA")).toBeInTheDocument();
});

// --- type: path — the wizard says where a mounted folder lands ---

async function fillStep() {
  renderWizard();
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}
const dataField = () => screen.getByLabelText(/Data folder/) as HTMLInputElement;
const setData = (value: string) => fireEvent.change(dataField(), { target: { value } });
const deploy = () => screen.getByRole("button", { name: "Deploy" });

test("a relative path lands beside the compose file, kept on Delete", async () => {
  await fillStep();

  expect(dataField()).toHaveValue("./data");
  expect(screen.getByText(/In its own folder: stacks\/grafana\/data/)).toBeInTheDocument();
  expect(screen.getByText(/Kept when the stack is deleted/)).toBeInTheDocument();
  expect(deploy()).toBeEnabled();
});

test("an absolute path is on the host, and never Loskai's to delete", async () => {
  await fillStep();
  setData("/srv/grafana");

  expect(screen.getByText(/On the Docker host. Loskai never deletes it/)).toBeInTheDocument();
  expect(deploy()).toBeEnabled();
});

test.each([
  ["~/grafana", /container's home \(\/root\)/],
  ["grafana", /a bare 'grafana' is a Docker volume/],
  ["/srv/a:b", /split the volume spec/],
])("%s is refused before Deploy, with the reason", async (value, reason) => {
  await fillStep();
  setData(value);

  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(deploy()).toBeDisabled();
});

test("a cleared path is required", async () => {
  await fillStep();
  setData("");

  expect(screen.getByText(/Required — the folder to mount/)).toBeInTheDocument();
  expect(deploy()).toBeDisabled();
});

test("a shadowed recipe says which source lost and which won", async () => {
  renderWizard({
    shadowed: [{ id: "grafana", source: "local", shadowed_by: "loskai-recipes" }],
  });

  expect(
    await screen.findByText(/grafana \(local copy hidden by loskai-recipes\)/),
  ).toBeInTheDocument();
});

test("an invalid recipe reports why it was skipped", async () => {
  renderWizard({ invalid: [{ id: "broken", source: "local", error: "compose.yml missing" }] });

  expect(await screen.findByText(/broken — compose.yml missing/)).toBeInTheDocument();
});

test("no sources and no recipes points at the settings page", async () => {
  renderWizard({ recipes: [], sources: [] });

  expect(await screen.findByText(/No recipe sources are enabled/)).toBeInTheDocument();
});

test("a configured but never-synced source says to sync, not to add one", async () => {
  renderWizard({
    recipes: [],
    sources: [{ ...SOURCES[0], synced: false, count: 0 }],
  });

  expect(await screen.findByText(/loskai-recipes has never synced/)).toBeInTheDocument();
});

test("an install that cannot identify its container surfaces the warning", async () => {
  renderWizard({
    install: {
      ok: true,
      output: "Started",
      container: null,
      warning: "'Grafana' is up, but its container could not be identified — route it from the Routing tab's Add route picker.",
    },
  });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  expect(await screen.findByText(/could not be identified/)).toBeInTheDocument();
});

test("a failed install offers no subdomain suggestion", async () => {
  renderWizard({ install: { ok: false, output: "port is allocated", container: null } });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  await waitFor(() => expect(screen.getByText(/Finished with errors/)).toBeInTheDocument());
  expect(screen.queryByText(/Suggested subdomain/)).not.toBeInTheDocument();
});

test("an install that reused a kept folder says so", async () => {
  renderWizard({
    install: { ok: true, output: "Started", container: "grafana-app-1", reused_data: true },
  });
  await pickGrafana();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Deploy" }));

  expect(await screen.findByText(/Picked up the data left in its folder/)).toBeInTheDocument();
});
