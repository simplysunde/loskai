import { describe, expect, test } from "vitest";

import { assembleFqdn, isValidPrefix } from "./validation";

describe("isValidPrefix", () => {
  test("accepts single DNS labels", () => {
    expect(isValidPrefix("grafana")).toBe(true);
    expect(isValidPrefix("uptime-kuma")).toBe(true);
    expect(isValidPrefix("a1")).toBe(true);
  });

  test("rejects invalid labels", () => {
    expect(isValidPrefix("")).toBe(false);
    expect(isValidPrefix("Grafana")).toBe(false); // uppercase
    expect(isValidPrefix("-lead")).toBe(false);
    expect(isValidPrefix("trail-")).toBe(false);
    expect(isValidPrefix("has.dot")).toBe(false); // multi-label
    expect(isValidPrefix("under_score")).toBe(false);
  });
});

test("assembleFqdn joins prefix and base domain", () => {
  expect(assembleFqdn("grafana", "example.no")).toBe("grafana.example.no");
});
