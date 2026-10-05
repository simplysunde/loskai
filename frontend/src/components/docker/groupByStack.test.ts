import { expect, test } from "vitest";

import { groupByStack, type Container, type Stack } from "./groupByStack";

function c(name: string, project: string | null = null): Container {
  return {
    id: name, name, image: `${name}/img`, project, status: "running", uptime: 1, ports: [],
    subdomain: null, suggested_upstream: null, cpu: null, mem: null,
  };
}
function s(name: string, status: Stack["status"] = "up"): Stack {
  return { name, services: [], status };
}

const CONTAINERS = [
  c("portainer"),
  c("immich-server", "immich"),
  c("loskai", "loskai"),
  c("immich-db", "immich"),
  c("jellyfin", "jellyfin"),
];
const STACKS = [s("immich", "partial"), s("jellyfin"), s("paperless", "down")];

test("containers nest under their stack, other projects next, standalone last", () => {
  const groups = groupByStack(CONTAINERS, STACKS);

  expect(groups.map((g) => g.key)).toEqual([
    "stack:immich",
    "stack:jellyfin",
    "stack:paperless",
    "project:loskai",
    "standalone",
  ]);
  expect(groups[0].containers.map((x) => x.name)).toEqual(["immich-db", "immich-server"]);
});

test("a stack with no containers still has its group", () => {
  // Down and never created: its actions (Up, Edit) must still be reachable.
  const paperless = groupByStack(CONTAINERS, STACKS).find((g) => g.key === "stack:paperless");
  expect(paperless?.containers).toEqual([]);
});

test("no container is lost or listed twice", () => {
  const listed = groupByStack(CONTAINERS, STACKS).flatMap((g) => g.containers.map((x) => x.name));
  expect(listed.sort()).toEqual(CONTAINERS.map((x) => x.name).sort());
});

test("with nothing loose, there is no standalone group", () => {
  const groups = groupByStack([c("a", "jellyfin")], [s("jellyfin")]);
  expect(groups.map((g) => g.key)).toEqual(["stack:jellyfin"]);
});
