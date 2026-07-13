import { describe, expect, it } from "vitest";
import { firstRunFinished, parseFirstRunPreference } from "./persistence.js";

describe("first-run preference persistence", () => {
  it("accepts only closed, versioned completion states", () => {
    expect(parseFirstRunPreference({
      version: 1,
      disposition: "completed",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      tourCompleted: false,
      tourBulletinLocalResourceId: "10000000-0000-4000-8000-000000000007",
    })).toEqual({
      version: 1,
      disposition: "completed",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      tourCompleted: false,
      tourBulletinLocalResourceId: "10000000-0000-4000-8000-000000000007",
    });
    expect(parseFirstRunPreference({ version: 1, disposition: "skipped" }))
      .toEqual({ version: 1, disposition: "skipped" });
    expect(parseFirstRunPreference({ version: 2, disposition: "completed" })).toBeUndefined();
    expect(parseFirstRunPreference({ version: 1, disposition: "later" })).toBeUndefined();
  });

  it("drops unknown optional choices without losing a valid completion marker", () => {
    expect(parseFirstRunPreference({
      version: 1,
      disposition: "completed",
      preferredOutput: "wallPoster",
      starterId: "downloaded-template",
    })).toEqual({ version: 1, disposition: "completed" });
    expect(firstRunFinished({ version: 1, disposition: "skipped" })).toBe(true);
    expect(firstRunFinished(null)).toBe(false);
  });

  it("restores only bounded canonical in-progress answers without treating setup as finished", () => {
    const value = {
      version: 1,
      disposition: "inProgress",
      step: 1,
      churchName: "Lamb of God",
      mailingAddress: "2210 E. Indian School Road",
      phone: "602-555-0100",
      email: "office@example.test",
      website: "https://example.test",
      logo: "asset:40000000-0000-4000-8000-000000000004",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      createPracticeBulletin: false,
      tourCompleted: true,
    };
    expect(parseFirstRunPreference(value)).toEqual({
      version: 1,
      disposition: "inProgress",
      step: 1,
      churchName: "Lamb of God",
      mailingAddress: "2210 E. Indian School Road",
      phone: "602-555-0100",
      email: "office@example.test",
      website: "https://example.test",
      logo: "asset:40000000-0000-4000-8000-000000000004",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      createPracticeBulletin: false,
    });
    expect(firstRunFinished(value)).toBe(false);
    expect(parseFirstRunPreference({
      ...value,
      churchName: "x".repeat(121),
      mailingAddress: "/tmp\nunsafe",
    })).not.toHaveProperty("churchName");
    expect(parseFirstRunPreference({ ...value, logo: "file:///tmp/logo.png" }))
      .not.toHaveProperty("logo");
  });
});
