import { describe, expect, it } from "vitest";
import { UI_PACKAGE_NAME } from "./index.js";

describe("@cbb/ui package", () => {
  it("exports the package name constant", () => {
    expect(UI_PACKAGE_NAME).toBe("@cbb/ui");
  });
});
