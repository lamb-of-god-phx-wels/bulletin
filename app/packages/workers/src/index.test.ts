import { describe, expect, it } from "vitest";
import { WORKERS_PACKAGE_NAME } from "./index.js";

describe("@cbb/workers package", () => {
  it("exports the package name constant", () => {
    expect(WORKERS_PACKAGE_NAME).toBe("@cbb/workers");
  });
});
