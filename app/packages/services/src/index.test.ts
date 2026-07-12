import { describe, expect, it } from "vitest";
import { SERVICES_PACKAGE_NAME } from "./index.js";

describe("@cbb/services package", () => {
  it("exports the package name constant", () => {
    expect(SERVICES_PACKAGE_NAME).toBe("@cbb/services");
  });
});
