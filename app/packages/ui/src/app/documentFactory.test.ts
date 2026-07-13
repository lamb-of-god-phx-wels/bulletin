import { describe, expect, it } from "vitest";
import {
  canonicalRevisionToken,
  fieldContractHash,
  makeSequentialIdPort,
  validateDocumentSemantics,
  type CbbDocument,
} from "@cbb/core";
import { STARTER_CATALOG } from "../onboarding/index.js";
import { assertEditorDocumentValid } from "../store/index.js";
import { finalizedCustomDefinitionFixture } from "../store/testFixtures.js";
import { reviewedSandboxAuthoringDocument } from "./WeeklyWorkflowSandbox.js";
import {
  createBulletinFromStarter,
  createBulletinFromTemplateDocument,
  createTemplateFromDocument,
  hydrateWeeklyWorkflowSandboxSamples,
  localDateOnly,
  templateValueDecisionKey,
  templateValueReviewItems,
} from "./documentFactory.js";

describe("renderer document factory", () => {
  it("creates a semantically valid weekly bulletin from every built-in starter", () => {
    for (const starter of STARTER_CATALOG) {
      const bulletin = createBulletinFromStarter({
        starterId: starter.id,
        idPort: makeSequentialIdPort(1),
        publicationDate: "2026-07-13",
      });
      expect(bulletin.kind).toBe("bulletin");
      expect(bulletin.sampleFieldValues).toBeUndefined();
      expect(bulletin.fieldValues?.["publicationDate"]).toMatchObject({
        value: "2026-07-13",
        origin: "derived",
      });
      expect(bulletin.fieldValues?.["serviceName"]).toBeUndefined();
      expect(validateDocumentSemantics(bulletin)).toEqual({ valid: true, findings: [] });
    }
  });

  it("never turns template samples into production values and hydrates them only in the sandbox", () => {
    const source = STARTER_CATALOG[0]!.document;
    const bulletin = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(10),
      publicationDate: "2026-07-13",
    });

    expect(bulletin.fieldValues).toEqual({
      publicationDate: { value: "2026-07-13", origin: "derived" },
    });
    const sandbox = hydrateWeeklyWorkflowSandboxSamples(source, bulletin);
    expect(sandbox.fieldValues).toMatchObject({
      publicationDate: { value: "2026-07-13", origin: "derived" },
      serviceName: { value: "Weekly gathering", origin: "manual" },
    });
    expect(sandbox.sampleFieldValues).toBeUndefined();
    expect(() => assertEditorDocumentValid(sandbox)).not.toThrow();
    expect(validateDocumentSemantics(sandbox)).toEqual({ valid: true, findings: [] });
    expect(bulletin.fieldValues?.["serviceName"]).toBeUndefined();
  });

  it("hydrates and repins disposable Saved Section samples in body, page, and nested definitions", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "savedNotice",
      name: "Notice",
      fieldContract: {
        id: "90000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Notice fields",
        fields: [{ id: "message", label: "Message", type: "text", required: true }],
      },
      sampleFieldValues: {
        message: { value: "Sample local message", origin: "manual" },
      },
      elements: [{
        id: "noticeText",
        type: "text",
        name: "Notice text",
        data: { content: { kind: "plain", text: "Fallback" } },
      }],
    });
    const outer = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "outerSavedNotice",
      name: "Outer notice",
      fieldContract: {
        id: "90000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Outer fields",
        fields: [],
      },
      elements: [{
        id: "nestedNoticeInstance",
        type: "customInstance",
        name: "Nested notice",
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
      }],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Saved Section samples",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition, outer],
      elements: [
        {
          id: "noticeInstance",
          type: "customInstance",
          name: "Notice",
          definitionId: definition.id,
          definitionVersion: definition.definitionVersion,
          definitionHash: definition.definitionHash,
        },
        {
          id: "outerNoticeInstance",
          type: "customInstance",
          name: "Outer notice",
          definitionId: outer.id,
          definitionVersion: outer.definitionVersion,
          definitionHash: outer.definitionHash,
        },
      ],
      pageElements: [{
        id: "noticeFooterPlacement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomCenter",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: {
          id: "noticeFooterStack",
          type: "stack",
          name: "Notice footer",
          data: { direction: "vertical", gap: "0pt" },
          children: [{
            id: "noticeFooterChild",
            index: 0,
            element: {
              id: "pageNoticeInstance",
              type: "customInstance",
              name: "Page notice",
              definitionId: definition.id,
              definitionVersion: definition.definitionVersion,
              definitionHash: definition.definitionHash,
            },
          }],
        },
      }],
    };
    const original = JSON.stringify(source);
    const bulletin = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(20),
      publicationDate: "2026-07-13",
    });
    const productionInstance = bulletin.elements[0];
    expect(productionInstance?.type === "customInstance" ? productionInstance.fieldValues : undefined)
      .toBeUndefined();

    const sandbox = hydrateWeeklyWorkflowSandboxSamples(source, bulletin);
    const sandboxInstance = sandbox.elements[0];
    expect(sandboxInstance?.type === "customInstance" ? sandboxInstance.fieldValues : undefined)
      .toEqual({ message: { value: "Sample local message", origin: "manual" } });
    const sandboxNotice = sandbox.customElementDefinitions?.find((candidate) =>
      candidate.id === definition.id);
    const sandboxOuter = sandbox.customElementDefinitions?.find((candidate) =>
      candidate.id === outer.id);
    const nestedInstance = sandboxOuter?.elements[0];
    expect(nestedInstance?.type === "customInstance" ? nestedInstance.fieldValues : undefined)
      .toEqual({ message: { value: "Sample local message", origin: "manual" } });
    expect(nestedInstance?.type === "customInstance" ? nestedInstance.definitionHash : undefined)
      .toBe(sandboxNotice?.definitionHash);
    const pageStack = sandbox.pageElements?.[0]?.element;
    const pageInstance = pageStack?.type === "stack" ? pageStack.children[0]?.element : undefined;
    expect(pageInstance?.type === "customInstance" ? pageInstance.fieldValues : undefined)
      .toEqual({ message: { value: "Sample local message", origin: "manual" } });
    const sandboxOuterInstance = sandbox.elements[1];
    expect(sandboxOuterInstance?.type === "customInstance"
      ? sandboxOuterInstance.definitionHash
      : undefined).toBe(sandboxOuter?.definitionHash);
    expect(sandbox.sampleFieldValues).toBeUndefined();
    expect(sandboxNotice?.sampleFieldValues).toEqual(definition.sampleFieldValues);
    expect(() => assertEditorDocumentValid(sandbox)).not.toThrow();
    expect(validateDocumentSemantics(sandbox)).toEqual({ valid: true, findings: [] });
    expect(reviewedSandboxAuthoringDocument(source, sandbox)).toEqual(source);
    expect(JSON.stringify(source)).toBe(original);
    expect(productionInstance?.type === "customInstance" ? productionInstance.fieldValues : undefined)
      .toBeUndefined();
  });

  it("retains declarative defaults and records only portable source-template lineage", () => {
    const starter = STARTER_CATALOG[0]!.document;
    if (starter.fieldContract === undefined) throw new Error("starter contract missing");
    const savedContract = {
      ...starter.fieldContract,
      fields: starter.fieldContract.fields.map((field) =>
        field.id === "serviceName" ? { ...field, default: "Sunday Worship" } : field
      ),
    };
    const source: CbbDocument = {
      ...starter,
      name: "Saved Sunday template",
      metadata: { ...starter.metadata, title: "Saved Sunday template" },
      fieldContract: savedContract,
    };

    const bulletin = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(30),
      publicationDate: "2026-07-13",
    });

    expect(bulletin.sampleFieldValues).toBeUndefined();
    expect(bulletin.fieldValues?.["serviceName"]).toBeUndefined();
    expect(bulletin.fieldContract?.fields.find((field) => field.id === "serviceName")?.default)
      .toBe("Sunday Worship");
    expect(bulletin.sourceTemplate).toEqual({
      contractId: savedContract.id,
      contractVersion: savedContract.version,
      contractHash: fieldContractHash(savedContract),
      sourceDocumentHash: canonicalRevisionToken(source),
      sourceDisplayName: "Saved Sunday template",
    });
    expect(Object.keys(bulletin.sourceTemplate ?? {})).not.toContain("localResourceId");
    expect(validateDocumentSemantics(bulletin)).toEqual({ valid: true, findings: [] });
  });

  it("copies a semantically identified publication date into bulletin metadata", () => {
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Custom date field template",
      metadata: { title: "Custom date field template" },
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "11111111-1111-4111-8111-111111111111",
        version: 1,
        name: "Weekly fields",
        fields: [{
          id: "serviceDay",
          label: "Service day",
          type: "date",
          required: true,
          semanticRole: "publicationDate",
        }],
      },
      elements: [],
    };

    const bulletin = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(40),
      publicationDate: "2026-07-19",
    });

    expect(bulletin.fieldValues).toEqual({
      serviceDay: { value: "2026-07-19", origin: "derived" },
    });
    expect(bulletin.metadata?.publicationDate).toBe("2026-07-19");
  });

  it("reconciles service-label metadata after template field values are stripped", () => {
    const serviceField = {
      id: "serviceKind",
      label: "Service kind",
      type: "choice" as const,
      required: false,
      default: "sunday",
      semanticRole: "serviceLabel" as const,
      constraints: {
        choices: [
          { id: "sunday", label: "Sunday Service" },
          { id: "special", label: "Special Service" },
        ],
      },
    };
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Choice label template",
      metadata: { title: "Choice label template", serviceLabel: "Special Service" },
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "11111111-1111-4111-8111-111111111112",
        version: 1,
        name: "Weekly fields",
        fields: [serviceField],
      },
      fieldValues: {
        serviceKind: { value: "special", origin: "manual" },
      },
      elements: [],
    };

    const defaulted = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(41),
      publicationDate: "2026-07-19",
    });
    expect(defaulted.fieldValues).toBeUndefined();
    expect(defaulted.metadata?.serviceLabel).toBe("Sunday Service");
    expect(validateDocumentSemantics(defaulted)).toEqual({ valid: true, findings: [] });

    const { default: _default, ...withoutDefault } = serviceField;
    const cleared = createBulletinFromTemplateDocument({
      ...source,
      fieldContract: { ...source.fieldContract!, fields: [withoutDefault] },
    }, {
      idPort: makeSequentialIdPort(42),
      publicationDate: "2026-07-19",
    });
    expect(cleared.metadata?.serviceLabel).toBeUndefined();
    expect(validateDocumentSemantics(cleared)).toEqual({ valid: true, findings: [] });
  });

  it("round-trips a bulletin into a clean template sample without weekly review residue", () => {
    const bulletin = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(50),
      publicationDate: "2026-07-13",
      displayName: "Sunday Worship",
    });
    const template = createTemplateFromDocument({
      ...bulletin,
      fieldReview: [],
      contentReview: [],
    }, "Sunday template");

    expect(template.kind).toBe("template");
    expect(template.name).toBe("Sunday template");
    expect(template.fieldValues).toBeUndefined();
    expect(template.fieldReview).toBeUndefined();
    expect(template.contentReview).toBeUndefined();
    expect(template.sampleFieldValues).toEqual(bulletin.fieldValues);
    expect(validateDocumentSemantics(template)).toEqual({ valid: true, findings: [] });
  });

  it("duplicates an existing template without conflating samples, defaults, or Profile mappings", () => {
    const fieldContract = {
      id: "98000000-0000-4000-8000-000000000001",
      version: 3,
      name: "Weekly fields",
      fields: [{
        id: "serviceDate",
        label: "Service date",
        type: "date" as const,
        required: false,
        semanticRole: "publicationDate" as const,
        default: "2026-07-19",
        weeklyBehavior: {
          rolloverPolicy: "clear" as const,
          reviewExpectation: "everyBulletin" as const,
        },
      }, {
        id: "serviceName",
        label: "Service name",
        type: "text" as const,
        required: false,
        semanticRole: "serviceLabel" as const,
        default: "Sunday Worship",
        profileKey: "defaultServiceLabel" as const,
      }],
    };
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Existing template",
      metadata: {
        title: "Existing template",
        publicationDate: "2026-07-19",
        serviceLabel: "Sunday Worship",
      },
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract,
      sampleFieldValues: {
        serviceName: { value: "Sample festival name", origin: "manual" },
      },
      elements: [],
    };

    const duplicate = createTemplateFromDocument(source, "Existing template copy");
    expect(duplicate.fieldContract).toEqual(fieldContract);
    expect(duplicate.sampleFieldValues).toEqual(source.sampleFieldValues);
    expect(duplicate.metadata).toEqual({
      title: "Existing template copy",
      publicationDate: "2026-07-19",
      serviceLabel: "Sunday Worship",
    });
    expect(validateDocumentSemantics(duplicate)).toEqual({ valid: true, findings: [] });
    expect(source.name).toBe("Existing template");
  });

  it("preserves repeat item identity when a Saved Section weekly value becomes a sample", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "repeatSampleNotice",
      name: "Repeat sample notice",
      fieldContract: {
        id: "99000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Notice fields",
        fields: [{
          id: "items",
          label: "Items",
          type: "array",
          required: false,
          itemField: { id: "item", label: "Item", type: "text", required: true },
        }],
      },
      contentRules: [{
        kind: "repeat",
        id: "repeatSampleRule",
        fieldId: "items",
        prototypeNodeId: "repeatSamplePrototype",
        emptyState: { mode: "collapse" },
        maxItems: 5,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add item",
      }],
      elements: [{
        id: "repeatSamplePrototype",
        type: "text",
        name: "Item",
        data: { content: { kind: "plain", text: "Item" } },
      }],
    });
    const itemIds = [
      "99100000-0000-4000-8000-000000000001",
      "99100000-0000-4000-8000-000000000002",
    ];
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Repeat sample bulletin",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition],
      elements: [{
        id: "repeatSampleInstance",
        type: "customInstance",
        name: "Repeat sample",
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
        fieldValues: {
          items: { value: ["Alpha", "Beta"], origin: "manual", itemIds },
        },
      }],
    };
    expect(validateDocumentSemantics(source)).toEqual({ valid: true, findings: [] });
    const item = templateValueReviewItems(source).find((candidate) =>
      candidate.target.scope === "savedSection" && candidate.fieldId === "items");
    if (item === undefined) throw new Error("repeat sample review item missing");

    const template = createTemplateFromDocument(source, "Repeat sample template", {
      [item.decisionKey]: { disposition: "sample" },
    });
    expect(template.customElementDefinitions?.[0]?.sampleFieldValues?.["items"]?.itemIds)
      .toEqual(itemIds);
    expect(template.elements[0]?.type === "customInstance"
      ? template.elements[0].fieldValues
      : undefined).toBeUndefined();
    expect(validateDocumentSemantics(template)).toEqual({ valid: true, findings: [] });

    const production = createBulletinFromTemplateDocument(template, {
      idPort: makeSequentialIdPort(75),
      publicationDate: "2026-07-19",
    });
    expect(production.elements[0]?.type === "customInstance"
      ? production.elements[0].fieldValues
      : undefined).toBeUndefined();
    const sandbox = hydrateWeeklyWorkflowSandboxSamples(template, production);
    expect(sandbox.elements[0]?.type === "customInstance"
      ? sandbox.elements[0].fieldValues?.["items"]?.itemIds
      : undefined).toEqual(itemIds);
    expect(() => assertEditorDocumentValid(sandbox)).not.toThrow();
    expect(validateDocumentSemantics(sandbox)).toEqual({ valid: true, findings: [] });
  });

  it("versions Profile mapping changes and never preserves a stale contract hash", () => {
    const unhashedContract = {
      id: "70000000-0000-4000-8000-000000000001",
      version: 7,
      name: "Reviewed weekly fields",
      fields: [{ id: "churchName", label: "Church name", type: "text" as const, required: false }],
    };
    const originalHash = fieldContractHash(unhashedContract);
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Profile review",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: { ...unhashedContract, contractHash: originalHash },
      fieldValues: { churchName: { value: "Grace Church", origin: "manual" } },
      elements: [],
    };

    const mapped = createTemplateFromDocument(source, "Mapped template", {
      churchName: { disposition: "profile", profileKey: "churchName" },
    });
    expect(mapped.fieldContract).toMatchObject({
      version: 8,
      fields: [{ id: "churchName", profileKey: "churchName" }],
    });
    expect(mapped.fieldContract?.contractHash).toBeUndefined();

    const defaulted = createTemplateFromDocument(source, "Defaulted template", {
      churchName: { disposition: "default" },
    });
    expect(defaulted.fieldContract).toMatchObject({
      version: 8,
      fields: [{ id: "churchName", default: "Grace Church" }],
    });
    expect(defaulted.fieldContract?.contractHash).toBeUndefined();

    const sampled = createTemplateFromDocument(source, "Sampled template", {
      churchName: { disposition: "sample" },
    });
    expect(sampled.fieldContract?.version).toBe(7);
    expect(sampled.fieldContract?.contractHash).toBe(originalHash);
  });

  it("materializes repeat defaults with fresh document and per-instance item identities", () => {
    const leaf = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "repeatLeaf",
      name: "Repeat leaf",
      fieldContract: {
        id: "91000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Leaf fields",
        fields: [{
          id: "localItems",
          label: "Local items",
          type: "array",
          required: false,
          itemField: { id: "localItem", label: "Item", type: "text", required: true },
          default: ["One", "Two"],
        }, {
          id: "localEmptyItems",
          label: "Local empty items",
          type: "array",
          required: false,
          itemField: { id: "localEmptyItem", label: "Item", type: "text", required: true },
          default: [],
        }],
      },
      contentRules: [{
        kind: "repeat",
        id: "localRepeat",
        fieldId: "localItems",
        prototypeNodeId: "localPrototype",
        emptyState: { mode: "collapse" },
        maxItems: 10,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add item",
      }, {
        kind: "repeat",
        id: "localEmptyRepeat",
        fieldId: "localEmptyItems",
        prototypeNodeId: "localEmptyPrototype",
        emptyState: { mode: "collapse" },
        maxItems: 10,
        userReorderable: true,
        itemLabel: "Empty item",
        addLabel: "Add empty item",
      }],
      elements: [{
        id: "localPrototype",
        type: "text",
        name: "Local prototype",
        data: { content: { kind: "plain", text: "Item" } },
      }, {
        id: "localEmptyPrototype",
        type: "text",
        name: "Local empty prototype",
        data: { content: { kind: "plain", text: "Empty item" } },
      }],
    });
    const leafHash = leaf.definitionHash;
    const outer = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "repeatOuter",
      name: "Repeat outer",
      fieldContract: {
        id: "91000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Outer fields",
        fields: [],
      },
      elements: ["first", "second"].map((id) => ({
        id,
        type: "customInstance" as const,
        name: id,
        definitionId: leaf.id,
        definitionVersion: leaf.definitionVersion,
        definitionHash: leafHash,
      })),
    });
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Repeat defaults",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "91000000-0000-4000-8000-000000000003",
        version: 1,
        name: "Document fields",
        fields: [{
          id: "documentItems",
          label: "Document items",
          type: "array",
          required: false,
          itemField: { id: "item", label: "Item", type: "text", required: true },
          default: ["Alpha", "Beta"],
        }, {
          id: "emptyItems",
          label: "Empty items",
          type: "array",
          required: false,
          itemField: { id: "emptyItem", label: "Item", type: "text", required: true },
          default: [],
        }],
      },
      contentRules: [{
        kind: "repeat",
        id: "documentRepeat",
        fieldId: "documentItems",
        prototypeNodeId: "documentPrototype",
        emptyState: { mode: "collapse" },
        maxItems: 10,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add item",
      }, {
        kind: "repeat",
        id: "documentEmptyRepeat",
        fieldId: "emptyItems",
        prototypeNodeId: "documentEmptyPrototype",
        emptyState: { mode: "collapse" },
        maxItems: 10,
        userReorderable: true,
        itemLabel: "Empty item",
        addLabel: "Add empty item",
      }],
      customElementDefinitions: [leaf, outer],
      elements: [{
        id: "documentPrototype",
        type: "text",
        name: "Document prototype",
        data: { content: { kind: "plain", text: "Item" } },
      }, {
        id: "documentEmptyPrototype",
        type: "text",
        name: "Document empty prototype",
        data: { content: { kind: "plain", text: "Empty item" } },
      }, {
        id: "outerInstance",
        type: "customInstance",
        name: "Outer instance",
        definitionId: outer.id,
        definitionVersion: outer.definitionVersion,
        definitionHash: outer.definitionHash,
      }, {
        id: "directLeafInstance",
        type: "customInstance",
        name: "Direct leaf instance",
        definitionId: leaf.id,
        definitionVersion: leaf.definitionVersion,
        definitionHash: leafHash,
        fieldValues: {
          localItems: {
            value: ["Direct override"],
            origin: "manual",
            itemIds: ["99999999-9999-4999-8999-999999999999"],
          },
        },
      }],
      pageElements: [{
        id: "pageLeafPlacement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomCenter",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: {
          id: "pageLeafStack",
          type: "stack",
          name: "Page leaf stack",
          data: { direction: "vertical", gap: "0pt" },
          children: [{
            id: "pageLeafWrapper",
            index: 0,
            element: {
              id: "pageLeafInstance",
              type: "customInstance",
              name: "Page leaf instance",
              definitionId: leaf.id,
              definitionVersion: leaf.definitionVersion,
              definitionHash: leafHash,
            },
          }],
        },
      }],
    };

    const first = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(100),
      publicationDate: "2026-07-13",
    });
    const second = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(200),
      publicationDate: "2026-07-13",
    });
    const firstDocumentIds = first.fieldValues?.["documentItems"]?.itemIds;
    expect(first.fieldValues?.["documentItems"]).toMatchObject({
      value: ["Alpha", "Beta"],
      origin: "materializedDefault",
    });
    expect(first.fieldValues?.["emptyItems"]).toEqual({
      value: [],
      origin: "materializedDefault",
      itemIds: [],
    });
    expect(firstDocumentIds).toHaveLength(2);
    expect(second.fieldValues?.["documentItems"]?.itemIds).not.toEqual(firstDocumentIds);

    const outputLeaf = first.customElementDefinitions?.find((definition) => definition.id === leaf.id);
    const outputOuter = first.customElementDefinitions?.find((definition) => definition.id === outer.id);
    if (outputLeaf === undefined || outputOuter === undefined) throw new Error("definitions missing");
    const nested = outputOuter.elements;
    const firstIds = nested[0]?.type === "customInstance"
      ? nested[0].fieldValues?.["localItems"]?.itemIds
      : undefined;
    const secondIds = nested[1]?.type === "customInstance"
      ? nested[1].fieldValues?.["localItems"]?.itemIds
      : undefined;
    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(2);
    expect(firstIds).not.toEqual(secondIds);
    for (const instance of nested) {
      expect(instance.type === "customInstance"
        ? instance.fieldValues?.["localEmptyItems"]
        : undefined).toEqual({ value: [], origin: "materializedDefault", itemIds: [] });
    }
    const directLeaf = first.elements.find((element) => element.id === "directLeafInstance");
    const directIds = directLeaf?.type === "customInstance"
      ? directLeaf.fieldValues?.["localItems"]?.itemIds
      : undefined;
    expect(directIds).toHaveLength(1);
    expect(directIds).not.toEqual(firstIds);
    expect(directIds).not.toEqual(["99999999-9999-4999-8999-999999999999"]);
    const secondDirect = second.elements.find((element) => element.id === "directLeafInstance");
    expect(secondDirect?.type === "customInstance"
      ? secondDirect.fieldValues?.["localItems"]?.itemIds
      : undefined).not.toEqual(directIds);
    expect(directLeaf?.type === "customInstance"
      ? directLeaf.fieldValues?.["localEmptyItems"]
      : undefined).toEqual({ value: [], origin: "materializedDefault", itemIds: [] });
    expect(directLeaf?.type === "customInstance" ? directLeaf.definitionHash : undefined)
      .toBe(outputLeaf?.definitionHash);
    expect(nested.every((element) =>
      element.type === "customInstance" && element.definitionHash === outputLeaf.definitionHash
    )).toBe(true);
    const rootOuter = first.elements.find((element) => element.id === "outerInstance");
    expect(rootOuter?.type === "customInstance" ? rootOuter.definitionHash : undefined)
      .toBe(outputOuter.definitionHash);
    const pageRoot = first.pageElements?.[0]?.element;
    const pageLeaf = pageRoot?.type === "stack" ? pageRoot.children[0]?.element : undefined;
    const pageIds = pageLeaf?.type === "customInstance"
      ? pageLeaf.fieldValues?.["localItems"]?.itemIds
      : undefined;
    expect(pageIds).toHaveLength(2);
    expect(pageIds).not.toEqual(firstIds);
    expect(pageLeaf?.type === "customInstance"
      ? pageLeaf.fieldValues?.["localEmptyItems"]
      : undefined).toEqual({ value: [], origin: "materializedDefault", itemIds: [] });
    expect(pageLeaf?.type === "customInstance" ? pageLeaf.definitionHash : undefined)
      .toBe(outputLeaf.definitionHash);
    expect(validateDocumentSemantics(first)).toEqual({ valid: true, findings: [] });
  });

  it("clears stale default and Profile mappings when template review says clear", () => {
    const contract = {
      id: "92000000-0000-4000-8000-000000000001",
      version: 4,
      name: "Weekly fields",
      fields: [{
        id: "serviceName",
        label: "Service name",
        type: "text" as const,
        required: false,
        default: "Old default",
        profileKey: "defaultServiceLabel" as const,
      }],
    };
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Reviewed bulletin",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: { ...contract, contractHash: fieldContractHash(contract) },
      fieldValues: { serviceName: { value: "This week", origin: "manual" } },
      elements: [],
    };
    const template = createTemplateFromDocument(source, "Cleared template", {
      serviceName: { disposition: "clear" },
    });
    expect(template.fieldContract).toMatchObject({ version: 5 });
    expect(template.fieldContract?.fields[0]?.default).toBeUndefined();
    expect(template.fieldContract?.fields[0]?.profileKey).toBeUndefined();
    expect(template.fieldContract?.contractHash).toBeUndefined();
    expect(template.sampleFieldValues).toBeUndefined();
  });

  it("formats a local date without UTC rollover", () => {
    expect(localDateOnly(new Date(2026, 6, 13, 23, 59))).toBe("2026-07-13");
  });

  it("reviews each weekly value and applies clear, default, sample, and Profile choices", () => {
    const bulletin = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(60),
      publicationDate: "2026-07-13",
    });
    const source: CbbDocument = {
      ...bulletin,
      fieldContract: {
        ...bulletin.fieldContract!,
        fields: [
          ...bulletin.fieldContract!.fields,
          { id: "churchName", label: "Church name", type: "text" as const, required: false },
          { id: "logo", label: "Logo", type: "assetRef" as const, required: false },
          {
            id: "languageChoice",
            label: "Language choice",
            type: "choice" as const,
            required: false,
            constraints: { choices: [{ id: "en", label: "English" }] },
          },
          { id: "notes", label: "Notes", type: "text" as const, required: false },
        ],
      },
      fieldValues: {
        ...bulletin.fieldValues,
        serviceName: { value: "Weekly gathering", origin: "manual" as const },
        churchName: { value: "Grace Church", origin: "manual" as const },
        logo: {
          value: "asset:00000000-0000-4000-8000-000000000001",
          origin: "manual" as const,
        },
        languageChoice: { value: "en", origin: "manual" as const },
        notes: { value: "Long-reading sample", origin: "manual" as const },
      },
    };
    expect(templateValueReviewItems(source).find((item) => item.fieldId === "publicationDate"))
      .toMatchObject({ likelyOneWeekContent: true });
    expect(templateValueReviewItems(source).find((item) => item.fieldId === "churchName"))
      .toMatchObject({
        profileCompatible: true,
        profileKeys: [
          "churchName",
          "mailingAddress",
          "locationAddress",
          "phone",
          "email",
          "website",
          "defaultServiceLabel",
        ],
      });
    expect(templateValueReviewItems(source).find((item) => item.fieldId === "languageChoice"))
      .toMatchObject({ profileCompatible: false, profileKeys: [] });
    expect(templateValueReviewItems(source).find((item) => item.fieldId === "logo"))
      .toMatchObject({ profileCompatible: true, profileKeys: ["logo"] });

    const template = createTemplateFromDocument(source, "Reviewed template", {
      publicationDate: { disposition: "clear" },
      serviceName: { disposition: "default" },
      churchName: { disposition: "profile", profileKey: "churchName" },
      logo: { disposition: "profile", profileKey: "logo" },
      languageChoice: { disposition: "clear" },
      notes: { disposition: "sample" },
    });
    expect(template.sampleFieldValues).toEqual({
      notes: { value: "Long-reading sample", origin: "manual" },
    });
    expect(template.fieldContract?.fields.find((field) => field.id === "serviceName")?.default)
      .toBe(source.fieldValues?.["serviceName"]?.value);
    expect(template.fieldContract?.fields.find((field) => field.id === "churchName")?.profileKey)
      .toBe("churchName");
    expect(template.fieldContract?.fields.find((field) => field.id === "logo")?.profileKey)
      .toBe("logo");
    expect(validateDocumentSemantics(template)).toEqual({ valid: true, findings: [] });

    expect(() => createTemplateFromDocument(source, "Invalid template", {
      churchName: {
        disposition: "profile",
        profileKey: "language" as never,
      },
    })).toThrow(/compatible Church Profile value/u);
  });

  it("reviews one shared Saved Section field across body, page, and nested-definition copies", () => {
    const noticeBase = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "sharedNotice",
      name: "Shared notice",
      fieldContract: {
        id: "93000000-0000-4000-8000-000000000001",
        version: 3,
        name: "Notice fields",
        fields: [{
          id: "message",
          label: "Announcement message",
          type: "text",
          required: false,
          default: "Old default",
          profileKey: "defaultServiceLabel",
        }],
      },
      sampleFieldValues: {
        message: { value: "Old sample", origin: "manual" },
      },
      elements: [{
        id: "sharedNoticeText",
        type: "text",
        name: "Notice text",
        data: { content: { kind: "plain", text: "Fallback" } },
      }],
    });
    const noticeHash = noticeBase.definitionHash;
    const outer = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "outerNotice",
      name: "Outer notice",
      fieldContract: {
        id: "93000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Outer fields",
        fields: [],
      },
      elements: [{
        id: "nestedNoticeInstance",
        type: "customInstance",
        name: "Nested notice",
        definitionId: noticeBase.id,
        definitionVersion: noticeBase.definitionVersion,
        definitionHash: noticeHash,
        fieldValues: { message: { value: "Reusable message", origin: "manual" } },
      }],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Scoped values",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [noticeBase, outer],
      elements: [{
        id: "rootNoticeInstance",
        type: "customInstance",
        name: "Root notice",
        definitionId: noticeBase.id,
        definitionVersion: noticeBase.definitionVersion,
        definitionHash: noticeHash,
        fieldValues: { message: { value: "Reusable message", origin: "manual" } },
      }, {
        id: "outerNoticeInstance",
        type: "customInstance",
        name: "Outer",
        definitionId: outer.id,
        definitionVersion: outer.definitionVersion,
        definitionHash: outer.definitionHash,
      }],
      pageElements: [{
        id: "noticeFooterPlacement",
        purpose: "footer",
        target: { mode: "all" },
        layer: "overlay",
        region: "bottomMargin",
        anchor: "bottomCenter",
        x: "0in",
        y: "0in",
        width: "100%",
        height: "auto",
        zIndex: 0,
        clipToRegion: true,
        semantic: { mode: "artifact" },
        element: {
          id: "noticeFooterStack",
          type: "stack",
          name: "Footer stack",
          data: { direction: "vertical", gap: "0pt" },
          children: [{
            id: "noticeFooterWrapper",
            index: 0,
            element: {
              id: "pageNoticeInstance",
              type: "customInstance",
              name: "Page notice",
              definitionId: noticeBase.id,
              definitionVersion: noticeBase.definitionVersion,
              definitionHash: noticeHash,
              fieldValues: { message: { value: "Reusable message", origin: "manual" } },
            },
          }],
        },
      }],
    };
    expect(validateDocumentSemantics(source)).toEqual({ valid: true, findings: [] });
    const item = templateValueReviewItems(source).find((candidate) =>
      candidate.target.scope === "savedSection" && candidate.fieldId === "message");
    expect(item).toMatchObject({
      ownerLabel: "Shared notice",
      occurrenceCount: 3,
      valueCount: 3,
      hasConflictingValues: false,
    });
    if (item === undefined) throw new Error("scoped review item missing");

    const template = createTemplateFromDocument(source, "Scoped template", {
      [item.decisionKey]: { disposition: "sample" },
    });
    const notice = template.customElementDefinitions?.find((definition) =>
      definition.id === noticeBase.id);
    const nextOuter = template.customElementDefinitions?.find((definition) =>
      definition.id === outer.id);
    expect(notice?.fieldContract).toMatchObject({ version: 4 });
    expect(notice?.fieldContract.fields[0]?.default).toBeUndefined();
    expect(notice?.fieldContract.fields[0]?.profileKey).toBeUndefined();
    expect(notice?.sampleFieldValues).toEqual({
      message: { value: "Reusable message", origin: "manual" },
    });
    const rootNotice = template.elements.find((element) => element.id === "rootNoticeInstance");
    expect(rootNotice?.type === "customInstance" ? rootNotice.fieldValues : undefined)
      .toBeUndefined();
    const nestedNotice = nextOuter?.elements[0];
    expect(nestedNotice?.type === "customInstance" ? nestedNotice.fieldValues : undefined)
      .toBeUndefined();
    const pageStack = template.pageElements?.[0]?.element;
    const pageNotice = pageStack?.type === "stack" ? pageStack.children[0]?.element : undefined;
    expect(pageNotice?.type === "customInstance" ? pageNotice.fieldValues : undefined)
      .toBeUndefined();
    expect(nestedNotice?.type === "customInstance" ? nestedNotice.definitionHash : undefined)
      .toBe(notice?.definitionHash);
    const rootOuter = template.elements.find((element) => element.id === "outerNoticeInstance");
    expect(rootOuter?.type === "customInstance" ? rootOuter.definitionHash : undefined)
      .toBe(nextOuter?.definitionHash);
    expect(validateDocumentSemantics(template)).toEqual({ valid: true, findings: [] });
  });

  it("fails closed for different values in copies sharing one Saved Section field", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "conflictingNotice",
      name: "Conflicting notice",
      fieldContract: {
        id: "94000000-0000-4000-8000-000000000001",
        version: 2,
        name: "Notice fields",
        fields: [{
          id: "message",
          label: "Weekly message",
          type: "text",
          required: false,
          default: "Old default",
          profileKey: "defaultServiceLabel",
        }],
      },
      sampleFieldValues: { message: { value: "Old sample", origin: "manual" } },
      elements: [],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Conflicting values",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition],
      elements: ["First", "Second"].map((value, index) => ({
        id: `conflictingNotice${index}`,
        type: "customInstance" as const,
        name: `${value} notice`,
        definitionId: definition.id,
        definitionVersion: definition.definitionVersion,
        definitionHash: definition.definitionHash,
        fieldValues: { message: { value, origin: "manual" as const } },
      })),
    };
    const item = templateValueReviewItems(source).find((candidate) =>
      candidate.target.scope === "savedSection");
    expect(item).toMatchObject({
      occurrenceCount: 2,
      valueCount: 2,
      hasConflictingValues: true,
    });
    if (item === undefined) throw new Error("conflict review item missing");
    expect(item.decisionKey).toBe(templateValueDecisionKey({
      scope: "savedSection",
      definitionId: definition.id,
      fieldId: "message",
    }));
    expect(() => createTemplateFromDocument(source, "Unsafe sample"))
      .toThrow(/different current values/u);
    expect(() => createTemplateFromDocument(source, "Unsafe default", {
      [item.decisionKey]: { disposition: "default" },
    })).toThrow(/different current values/u);

    const cleared = createTemplateFromDocument(source, "Cleared copies", {
      [item.decisionKey]: { disposition: "clear" },
    });
    const output = cleared.customElementDefinitions?.[0];
    expect(output?.fieldContract.version).toBe(3);
    expect(output?.fieldContract.fields[0]?.default).toBeUndefined();
    expect(output?.fieldContract.fields[0]?.profileKey).toBeUndefined();
    expect(output?.sampleFieldValues).toBeUndefined();
    expect(cleared.elements.every((element) =>
      element.type === "customInstance" && element.fieldValues === undefined)).toBe(true);
    expect(validateDocumentSemantics(cleared)).toEqual({ valid: true, findings: [] });
  });
});
