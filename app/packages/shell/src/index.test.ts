import { describe, expect, it } from "vitest";
import { SHELL_PACKAGE_NAME } from "./index.js";

describe("@cbb/shell package", () => {
  it("exports the package name constant", () => {
    expect(SHELL_PACKAGE_NAME).toBe("@cbb/shell");
  });
});
