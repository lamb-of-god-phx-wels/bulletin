import { describe, expect, it } from "vitest";
import type { CbbDocument } from "@cbb/core";
import {
  checkEditorCapabilities,
  checkEditorCapability,
  effectiveAuthoringPolicy,
} from "./capabilities.js";
import {
  bulletin,
  finalizedCustomDefinitionFixture,
  nestedElements,
  textElement,
} from "./testFixtures.js";

describe("editor capabilities", () => {
  it("allows ordinary unlocked content operations in Weekly Content", () => {
    expect(
      checkEditorCapability(bulletin(), "weeklyContent", {
        capability: "content.edit",
        target: { kind: "node", nodeId: "heading" },
      }),
    ).toEqual({ allowed: true });
  });

  it("requires Customize Layout for every structural entry point", () => {
    const decision = checkEditorCapability(bulletin(), "weeklyContent", {
      capability: "layout.editStructure",
      target: { kind: "node", nodeId: "heading" },
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "requiresCustomizeLayout",
    });
    if (!decision.allowed) {
      expect(decision.reason).toBe(
        "Switch to Customize Layout to change document structure.",
      );
    }
  });

  it("inherits content protection and reports its source", () => {
    const document = bulletin({
      authoringPolicy: { contentLocked: true },
      elements: nestedElements(),
    });
    const decision = checkEditorCapability(document, "weeklyContent", {
      capability: "content.edit",
      target: { kind: "node", nodeId: "nested-text" },
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: "contentLocked",
      lockSource: { kind: "document" },
    });
  });

  it("applies property-level overrides through element and wrapper ancestry", () => {
    const document = bulletin({
      authoringPolicy: { contentLocked: true, layoutLocked: true },
      elements: [
        {
          id: "stack",
          type: "stack",
          name: "Stack",
          authoringPolicy: { contentLocked: false },
          data: { direction: "vertical", gap: "0pt" },
          children: [
            {
              id: "wrapper",
              index: 0,
              authoringPolicy: { layoutLocked: false },
              element: textElement("child"),
            },
          ],
        },
      ],
    });

    expect(
      effectiveAuthoringPolicy(document, { kind: "node", nodeId: "child" }),
    ).toMatchObject({ contentLocked: false, layoutLocked: true });
    expect(
      effectiveAuthoringPolicy(document, { kind: "node", nodeId: "wrapper" }),
    ).toEqual({ contentLocked: false, layoutLocked: false });
    expect(
      checkEditorCapability(document, "customizeLayout", {
        capability: "layout.editPlacement",
        target: { kind: "node", nodeId: "wrapper" },
      }),
    ).toEqual({ allowed: true });
  });

  it("never treats a placement-wrapper content flag as child content policy", () => {
    const document = bulletin({
      elements: [
        {
          id: "stack",
          type: "stack",
          name: "Stack",
          data: { direction: "vertical", gap: "0pt" },
          children: [
            {
              id: "wrapper",
              index: 0,
              authoringPolicy: { contentLocked: true, layoutLocked: true },
              element: textElement("child"),
            },
          ],
        },
      ],
    });

    expect(
      checkEditorCapability(document, "weeklyContent", {
        capability: "content.edit",
        target: { kind: "node", nodeId: "child" },
      }),
    ).toEqual({ allowed: true });
    expect(
      checkEditorCapability(document, "customizeLayout", {
        capability: "layout.resize",
        target: { kind: "node", nodeId: "child" },
      }),
    ).toEqual({ allowed: true });
    expect(
      checkEditorCapability(document, "customizeLayout", {
        capability: "layout.editPlacement",
        target: { kind: "node", nodeId: "wrapper" },
      }),
    ).toMatchObject({ allowed: false, code: "layoutLocked" });
  });

  it("honors layout protection in Customize Layout until explicitly unlocked", () => {
    const document = bulletin({
      elements: [
        textElement("locked", "Locked", {
          authoringPolicy: { layoutLocked: true },
        }),
      ],
    });
    expect(
      checkEditorCapability(document, "customizeLayout", {
        capability: "layout.resize",
        target: { kind: "node", nodeId: "locked" },
      }),
    ).toMatchObject({ allowed: false, code: "layoutLocked" });
  });

  it("permits explicit protection edits despite current protection", () => {
    const document = bulletin({
      authoringPolicy: { contentLocked: true, layoutLocked: true },
    });
    expect(
      checkEditorCapability(document, "customizeLayout", {
        capability: "authoringPolicy.edit",
      }),
    ).toEqual({ allowed: true });
    expect(
      checkEditorCapability(document, "weeklyContent", {
        capability: "authoringPolicy.edit",
      }),
    ).toMatchObject({ allowed: false, code: "requiresCustomizeLayout" });
  });

  it("resolves page wrapper and custom-definition policy ancestry", () => {
    const document: CbbDocument = bulletin({
      pageElements: [
        {
          id: "header-placement",
          purpose: "header",
          target: { mode: "all" },
          layer: "overlay",
          region: "topMargin",
          anchor: "topCenter",
          x: "0pt",
          y: "0pt",
          width: "auto",
          height: "auto",
          zIndex: 1,
          clipToRegion: true,
          semantic: { mode: "artifact" },
          authoringPolicy: { layoutLocked: true },
          element: textElement("header-text"),
        },
      ],
      customElementDefinitions: [
        finalizedCustomDefinitionFixture({
          version: 1,
          kind: "customElementDefinition",
          id: "custom-definition",
          name: "Welcome block",
          fieldContract: {
            id: "00000000-0000-4000-8000-000000000001",
            version: 1,
            name: "Fields",
            fields: [],
          },
          elements: [textElement("custom-text")],
          authoringPolicy: { contentLocked: true },
        }),
      ],
    });

    expect(
      effectiveAuthoringPolicy(document, {
        kind: "node",
        nodeId: "header-placement",
      }),
    ).toMatchObject({
      layoutLocked: true,
      layoutLockSource: { kind: "node", nodeId: "header-placement" },
    });
    expect(
      effectiveAuthoringPolicy(document, {
        kind: "node",
        nodeId: "custom-text",
      }),
    ).toMatchObject({
      contentLocked: true,
      contentLockSource: { kind: "node", nodeId: "custom-definition" },
    });
  });

  it("returns a stable missing-target denial", () => {
    expect(
      checkEditorCapability(bulletin(), "customizeLayout", {
        capability: "layout.resize",
        target: { kind: "node", nodeId: "removed" },
      }),
    ).toEqual({
      allowed: false,
      code: "targetNotFound",
      reason: "This item is no longer in the document.",
      requirement: {
        capability: "layout.resize",
        target: { kind: "node", nodeId: "removed" },
      },
    });
  });

  it("checks multiple source and destination requirements before a move", () => {
    const document = bulletin({
      elements: [
        textElement("source"),
        textElement("destination", "Destination", {
          authoringPolicy: { layoutLocked: true },
        }),
      ],
    });
    expect(
      checkEditorCapabilities(document, "customizeLayout", [
        {
          capability: "layout.editPlacement",
          target: { kind: "node", nodeId: "source" },
        },
        {
          capability: "layout.editPlacement",
          target: { kind: "node", nodeId: "destination" },
        },
      ]),
    ).toMatchObject({
      allowed: false,
      code: "layoutLocked",
      requirement: {
        target: { kind: "node", nodeId: "destination" },
      },
    });
  });
});
