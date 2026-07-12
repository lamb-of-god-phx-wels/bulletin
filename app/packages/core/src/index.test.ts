import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_NAME } from "./index.js";

describe("@cbb/core package", () => {
  it("exports the package name constant", () => {
    expect(CORE_PACKAGE_NAME).toBe("@cbb/core");
  });
});
