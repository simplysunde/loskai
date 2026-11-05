import { expect, test } from "vitest";

import { answerHost } from "./useHealth";

test("the answer IP's host, whatever an older setting wrapped it in", () => {
  expect(answerHost("192.168.10.216")).toBe("192.168.10.216");
  expect(answerHost("http://192.168.10.216:2019/")).toBe("192.168.10.216");
  expect(answerHost(null)).toBe("");
});
