import { describe, expect, it } from "vitest";
import {
  BASELINE_CODES,
  DIAGNOSTIC_DOMAINS,
  extractCodeNumber,
  extractDomain,
  getDiagnostic,
  globalCatalog,
  isDiagnosticCode,
  makeCatalog,
  parseDiagnosticCode,
  registerDiagnostic,
} from "./index.js";
import type { DiagnosticCatalogEntry, DiagnosticCode } from "./index.js";

// ---------------------------------------------------------------------------
// isDiagnosticCode
// ---------------------------------------------------------------------------

describe("isDiagnosticCode", () => {
  it("accepts all defined domains with four-digit numbers", () => {
    for (const domain of DIAGNOSTIC_DOMAINS) {
      expect(isDiagnosticCode(`CBB-${domain}-0001`)).toBe(true);
      expect(isDiagnosticCode(`CBB-${domain}-9999`)).toBe(true);
    }
  });

  it("rejects unknown domain", () => {
    expect(isDiagnosticCode("CBB-UNKNOWN-0001")).toBe(false);
  });

  it("rejects wrong prefix", () => {
    expect(isDiagnosticCode("XYZ-DOC-0001")).toBe(false);
  });

  it("rejects fewer than four digits", () => {
    expect(isDiagnosticCode("CBB-DOC-001")).toBe(false);
  });

  it("rejects more than four digits", () => {
    expect(isDiagnosticCode("CBB-DOC-00001")).toBe(false);
  });

  it("rejects non-digit number segment", () => {
    expect(isDiagnosticCode("CBB-DOC-000A")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isDiagnosticCode("")).toBe(false);
  });

  it("rejects lowercase domain", () => {
    expect(isDiagnosticCode("CBB-doc-0001")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDiagnosticCode
// ---------------------------------------------------------------------------

describe("parseDiagnosticCode", () => {
  it("returns the code when valid", () => {
    const code = parseDiagnosticCode("CBB-DOC-0001");
    expect(code).toBe("CBB-DOC-0001");
  });

  it("throws TypeError for unknown domain", () => {
    expect(() => parseDiagnosticCode("CBB-BADDOM-0001")).toThrow(TypeError);
  });

  it("throws TypeError for wrong format", () => {
    expect(() => parseDiagnosticCode("not-a-code")).toThrow(TypeError);
  });

  it("error message includes the bad input", () => {
    try {
      parseDiagnosticCode("CBB-BADDOM-0001");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as TypeError).message).toContain("BADDOM");
    }
  });

  it("error message includes defined domains for unknown domain", () => {
    try {
      parseDiagnosticCode("CBB-BADDOM-0001");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as TypeError).message).toContain("DOC");
    }
  });
});

// ---------------------------------------------------------------------------
// extractDomain / extractCodeNumber
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  it("extracts the domain segment", () => {
    expect(extractDomain(parseDiagnosticCode("CBB-DOC-0001"))).toBe("DOC");
    expect(extractDomain(parseDiagnosticCode("CBB-LAYOUT-0007"))).toBe(
      "LAYOUT",
    );
    expect(extractDomain(parseDiagnosticCode("CBB-SECURITY-0001"))).toBe(
      "SECURITY",
    );
  });
});

describe("extractCodeNumber", () => {
  it("extracts the numeric segment as an integer", () => {
    expect(extractCodeNumber(parseDiagnosticCode("CBB-DOC-0001"))).toBe(1);
    expect(extractCodeNumber(parseDiagnosticCode("CBB-LAYOUT-0007"))).toBe(7);
    expect(extractCodeNumber(parseDiagnosticCode("CBB-SYNC-0005"))).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// makeCatalog — isolated catalog instance
// ---------------------------------------------------------------------------

describe("makeCatalog", () => {
  it("starts empty", () => {
    const cat = makeCatalog();
    expect(cat.size()).toBe(0);
    expect(cat.all()).toHaveLength(0);
  });

  it("registers and retrieves an entry", () => {
    const cat = makeCatalog();
    const entry: DiagnosticCatalogEntry = {
      code: parseDiagnosticCode("CBB-DOC-0001"),
      meaning: "Test meaning",
      defaultSeverity: "error",
      defaultDisposition: "block",
      acknowledgeable: false,
      defaultRecoveryActions: ["cancel"],
      redactionClass: "public",
      retired: false,
    };
    cat.register(entry);
    expect(cat.has(parseDiagnosticCode("CBB-DOC-0001"))).toBe(true);
    expect(cat.get(parseDiagnosticCode("CBB-DOC-0001"))).toStrictEqual(entry);
  });

  it("has() returns false for unregistered codes", () => {
    const cat = makeCatalog();
    expect(cat.has(parseDiagnosticCode("CBB-DOC-0001"))).toBe(false);
  });

  it("get() returns undefined for unregistered codes", () => {
    const cat = makeCatalog();
    expect(cat.get(parseDiagnosticCode("CBB-DOC-0001"))).toBeUndefined();
  });

  it("throws on duplicate code registration", () => {
    const cat = makeCatalog();
    const entry: DiagnosticCatalogEntry = {
      code: parseDiagnosticCode("CBB-DOC-0001"),
      meaning: "First meaning",
      defaultSeverity: "error",
      defaultDisposition: "block",
      acknowledgeable: false,
      defaultRecoveryActions: [],
      redactionClass: "public",
      retired: false,
    };
    cat.register(entry);
    const duplicate: DiagnosticCatalogEntry = {
      ...entry,
      meaning: "Second meaning — must not replace",
    };
    expect(() => cat.register(duplicate)).toThrow(Error);
  });

  it("duplicate registration error message includes the code", () => {
    const cat = makeCatalog();
    const entry: DiagnosticCatalogEntry = {
      code: parseDiagnosticCode("CBB-SCHEMA-0001"),
      meaning: "Test",
      defaultSeverity: "error",
      defaultDisposition: "block",
      acknowledgeable: false,
      defaultRecoveryActions: [],
      redactionClass: "public",
      retired: false,
    };
    cat.register(entry);
    try {
      cat.register(entry);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("CBB-SCHEMA-0001");
    }
  });

  it("all() returns entries in registration order", () => {
    const cat = makeCatalog();
    const codes: DiagnosticCode[] = [
      "CBB-DOC-0001",
      "CBB-SCHEMA-0001",
      "CBB-FIELD-0001",
    ].map(parseDiagnosticCode);

    for (const code of codes) {
      cat.register({
        code,
        meaning: `meaning for ${code}`,
        defaultSeverity: "info",
        defaultDisposition: "allow",
        acknowledgeable: false,
        defaultRecoveryActions: [],
        redactionClass: "public",
        retired: false,
      });
    }

    const returned = cat.all().map((e) => e.code);
    expect(returned).toStrictEqual(codes);
  });

  it("size() tracks registration count", () => {
    const cat = makeCatalog();
    expect(cat.size()).toBe(0);
    cat.register({
      code: parseDiagnosticCode("CBB-DOC-0001"),
      meaning: "m",
      defaultSeverity: "info",
      defaultDisposition: "allow",
      acknowledgeable: false,
      defaultRecoveryActions: [],
      redactionClass: "public",
      retired: false,
    });
    expect(cat.size()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Global catalog — baseline entries loaded by importing diagnostics/index.ts
// ---------------------------------------------------------------------------

describe("globalCatalog (baseline)", () => {
  it("contains all baseline codes from the spec", () => {
    for (const raw of BASELINE_CODES) {
      const code = parseDiagnosticCode(raw);
      if (!globalCatalog.has(code)) {
        throw new Error(`Expected baseline code "${raw}" to be registered`);
      }
    }
  });

  it("has all 43 baseline codes", () => {
    // The spec table originally defined 42 codes; CBB-SCHEMA-0002 was added
    // for internal semantic-validator-registry errors (now 43 total).
    expect(BASELINE_CODES).toHaveLength(43);
    // All codes should be present in the global catalog.
    for (const raw of BASELINE_CODES) {
      expect(globalCatalog.has(parseDiagnosticCode(raw))).toBe(true);
    }
  });

  it("all registered codes parse without error", () => {
    for (const entry of globalCatalog.all()) {
      expect(() => parseDiagnosticCode(entry.code)).not.toThrow();
    }
  });

  it("CBB-SECURITY-0001 is fatal and blocks", () => {
    const entry = globalCatalog.get(
      parseDiagnosticCode("CBB-SECURITY-0001"),
    );
    expect(entry?.defaultSeverity).toBe("fatal");
    expect(entry?.defaultDisposition).toBe("block");
  });

  it("CBB-FONT-0004 is info and allows (managed substitute notification)", () => {
    const entry = globalCatalog.get(parseDiagnosticCode("CBB-FONT-0004"));
    expect(entry?.defaultSeverity).toBe("info");
    expect(entry?.defaultDisposition).toBe("allow");
  });

  it("CBB-PACKAGE-0001 is fatal", () => {
    const entry = globalCatalog.get(parseDiagnosticCode("CBB-PACKAGE-0001"));
    expect(entry?.defaultSeverity).toBe("fatal");
  });

  it("CBB-BUILD-0004 (stale artifact) is warning and allows", () => {
    const entry = globalCatalog.get(parseDiagnosticCode("CBB-BUILD-0004"));
    expect(entry?.defaultSeverity).toBe("warning");
    expect(entry?.defaultDisposition).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// Redaction class mapping
// ---------------------------------------------------------------------------

describe("redaction class mapping", () => {
  it("credential-related sync code uses redacted-credentials", () => {
    const entry = globalCatalog.get(parseDiagnosticCode("CBB-SYNC-0002"));
    expect(entry?.redactionClass).toBe("redacted-credentials");
  });

  it("asset-related codes use redacted-assets", () => {
    const assetCodes: DiagnosticCode[] = [
      "CBB-ASSET-0001",
      "CBB-ASSET-0002",
      "CBB-FONT-0001",
      "CBB-FONT-0002",
      "CBB-FONT-0003",
    ].map(parseDiagnosticCode);
    for (const code of assetCodes) {
      const entry = globalCatalog.get(code);
      if (entry?.redactionClass !== "redacted-assets") {
        throw new Error(
          `Expected ${code} to have redacted-assets, got: ${entry?.redactionClass}`,
        );
      }
    }
  });

  it("content-related codes use redacted-content", () => {
    const contentCodes: DiagnosticCode[] = [
      "CBB-DOC-0001",
      "CBB-DOC-0002",
      "CBB-FIELD-0001",
      "CBB-FIELD-0002",
      "CBB-PDF-0002",
      "CBB-SCRIPTURE-0001",
      "CBB-AI-0001",
    ].map(parseDiagnosticCode);
    for (const code of contentCodes) {
      const entry = globalCatalog.get(code);
      if (entry?.redactionClass !== "redacted-content") {
        throw new Error(
          `Expected ${code} to have redacted-content, got: ${entry?.redactionClass}`,
        );
      }
    }
  });

  it("path-related codes use redacted-paths", () => {
    const pathCodes: DiagnosticCode[] = [
      "CBB-IMPORT-0001",
      "CBB-BACKUP-0001",
    ].map(parseDiagnosticCode);
    for (const code of pathCodes) {
      const entry = globalCatalog.get(code);
      if (entry?.redactionClass !== "redacted-paths") {
        throw new Error(
          `Expected ${code} to have redacted-paths, got: ${entry?.redactionClass}`,
        );
      }
    }
  });

  it("public structural codes use public redaction class", () => {
    const publicCodes: DiagnosticCode[] = [
      "CBB-SCHEMA-0001",
      "CBB-LAYOUT-0001",
      "CBB-BUILD-0001",
      "CBB-SECURITY-0001",
      "CBB-PACKAGE-0001",
    ].map(parseDiagnosticCode);
    for (const code of publicCodes) {
      const entry = globalCatalog.get(code);
      if (entry?.redactionClass !== "public") {
        throw new Error(
          `Expected ${code} to have public redaction, got: ${entry?.redactionClass}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// registerDiagnostic convenience alias (global)
// ---------------------------------------------------------------------------

describe("registerDiagnostic / getDiagnostic (global catalog convenience)", () => {
  // Use a separate isolated catalog to avoid contaminating the global catalog.
  // The global convenience functions are thin wrappers, so we test them in
  // isolation by confirming getDiagnostic returns the same entries the
  // globalCatalog already has.

  it("getDiagnostic finds all baseline codes", () => {
    for (const raw of BASELINE_CODES) {
      const code = parseDiagnosticCode(raw);
      const entry = getDiagnostic(code);
      expect(entry).toBeDefined();
      expect(entry?.code).toBe(code);
    }
  });

  it("getDiagnostic returns undefined for an unregistered code", () => {
    // CBB-DOC-9999 is not in the baseline catalog.
    const code = parseDiagnosticCode("CBB-DOC-9999");
    expect(getDiagnostic(code)).toBeUndefined();
  });

  it("registerDiagnostic registers into globalCatalog", () => {
    // Use a code NOT in the baseline so we don't conflict.
    const code = parseDiagnosticCode("CBB-DOC-8888");
    registerDiagnostic({
      code,
      meaning: "test-only entry for registerDiagnostic coverage",
      defaultSeverity: "info",
      defaultDisposition: "allow",
      acknowledgeable: false,
      defaultRecoveryActions: [],
      redactionClass: "public",
      retired: false,
    });
    expect(getDiagnostic(code)).toBeDefined();
    expect(getDiagnostic(code)?.code).toBe(code);
  });
});

// ---------------------------------------------------------------------------
// Isolated catalog does not affect global catalog
// ---------------------------------------------------------------------------

describe("catalog isolation", () => {
  it("registerDiagnostic into isolated catalog does not affect globalCatalog", () => {
    const isolated = makeCatalog();
    const code = parseDiagnosticCode("CBB-DOC-9998");
    isolated.register({
      code,
      meaning: "isolated test",
      defaultSeverity: "info",
      defaultDisposition: "allow",
      acknowledgeable: false,
      defaultRecoveryActions: [],
      redactionClass: "public",
      retired: false,
    });
    // Verify isolated catalog has it.
    expect(isolated.has(code)).toBe(true);
    // Verify global catalog does NOT have it.
    expect(globalCatalog.has(code)).toBe(false);
  });
});
