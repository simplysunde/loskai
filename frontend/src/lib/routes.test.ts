import { expect, test, vi } from "vitest";

import { saveNew } from "./routes";
import { json } from "../test/render";

// Add route's one submit goes to the endpoint for what it made — a link never reaches
// /api/routes, which would push it to Caddy.
test("a link is posted to /api/links without its kind; a route to /api/routes", async () => {
  const fetchMock = vi.fn(async () => json({ url: "x", caddy: "skipped", warning: null, instance_id: "x" }));
  vi.stubGlobal("fetch", fetchMock);

  await saveNew({ kind: "link", name: "NAS", upstream: "192.168.10.50:5000", upstream_tls: false });
  await saveNew({ prefix: "nas", upstream: "192.168.10.50:5000", upstream_tls: false });

  const [[linkPath, linkInit], [routePath]] = fetchMock.mock.calls as unknown as [string, RequestInit][];
  expect(linkPath).toBe("/api/links");
  expect(JSON.parse(String(linkInit.body))).toEqual({ name: "NAS", upstream: "192.168.10.50:5000", upstream_tls: false });
  expect(routePath).toBe("/api/routes");
});
