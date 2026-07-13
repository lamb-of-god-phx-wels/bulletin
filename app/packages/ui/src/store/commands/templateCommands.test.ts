import { describe, expect, it } from "vitest";
import {
  fieldContractHash,
  type CbbDocument,
  type FieldDefinition,
  type IdPort,
} from "@cbb/core";
import { EditorStore } from "../editorStore.js";
import {
  bulletin,
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
  textElement,
} from "../testFixtures.js";
import {
  authorableElements,
  bindableProperties,
  createAddConditionalRuleCommand,
  createAddRepeatRuleCommand,
  createAddWeeklyFieldCommand,
  createAddWeeklyFieldGroupCommand,
  createApplyTemplateAuthoringChangesCommand,
  createAssignWeeklyFieldGroupCommand,
  createDuplicateSavedSectionCommand,
  createInsertSavedSectionCommand,
  createLinkWeeklyFieldCommand,
  createMakeIndependentCommand,
  createMakeSavedSectionIndependentCommand,
  createMakeWeeklyFieldCommand,
  createRemoveSavedSectionCommand,
  createRemoveContentRuleCommand,
  createRemoveWeeklyFieldCommand,
  createRemoveWeeklyFieldGroupCommand,
  createReorderWeeklyFieldCommand,
  createReorderWeeklyFieldGroupCommand,
  createSaveAsSavedSectionCommand,
  createSetUnboundContentReviewCommand,
  createSetWeeklyFieldSampleValueCommand,
  createSetWeeklyFieldProfileMappingCommand,
  createUpdateWeeklyFieldCommand,
  createUpdateWeeklyFieldGroupCommand,
  templateAuthoringDiagnostics,
  type ChurchProfileFieldKey,
} from "./templateCommands.js";

const CONTRACT_A = "11111111-1111-4111-8111-111111111111";
const CONTRACT_B = "22222222-2222-4222-8222-222222222222";

function field(id: string, type: FieldDefinition["type"] = "text"): FieldDefinition {
  return { id, label: id === "message" ? "Welcome message" : id, type, required: false };
}

function idPort(): IdPort {
  let value = 1;
  return {
    randomUuid: () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`,
  };
}

function definitionDocument(): CbbDocument {
  const definition = finalizedCustomDefinitionFixture({
    version: 1,
    kind: "customElementDefinition",
    id: "savedCallout",
    name: "Callout",
    fieldContract: {
      id: CONTRACT_B,
      version: 1,
      name: "Callout weekly fields",
      fields: [],
    },
    elements: [textElement("savedText", "Callout")],
  });
  return bulletin({
    customElementDefinitions: [definition],
    elements: [customInstanceFixture(definition, {
      id: "calloutInstance",
      type: "customInstance",
      name: "Callout",
    })],
  });
}

describe("template authoring commands", () => {
  it("does not insert a Saved section that would create a second active credits block", () => {
    const rights = (id: string) => ({
      id,
      type: "rightsAttribution" as const,
      name: "Copyrights & Permissions",
      data: {
        heading: "Copyrights & Permissions",
        groupOrder: ["scripture", "music", "other"] as const,
        sortPolicy: "firstAppearance" as const,
      },
    });
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "savedCredits",
      name: "Saved credits",
      fieldContract: { id: CONTRACT_B, version: 1, name: "Credits", fields: [] },
      elements: [rights("savedCreditsBlock")],
    });
    const store = new EditorStore(bulletin({
      elements: [rights("activeCredits")],
      customElementDefinitions: [definition],
    }), { initialMode: "customizeLayout" });
    expect(() => store.execute(createInsertSavedSectionCommand({
      definitionId: definition.id,
      instanceId: "secondCredits",
      index: 1,
    }))).toThrow(/already has Copyrights/u);
  });
  it("reports unused fields and broken bindings and controls unlinked content review", () => {
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("unused"), field("message")],
      },
      elements: [{
        ...textElement("broken", "Welcome", { name: "Broken welcome" }),
        bindings: [{
          id: "broken-binding",
          scope: "document",
          fieldId: "missing",
          target: "/not/a/property",
        }],
      }, textElement("unlinked", "Please review", { name: "Pastor note" })],
    });
    const diagnostics = templateAuthoringDiagnostics(document, { kind: "document" });
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missingBindingField", nodeId: "broken" }),
        expect.objectContaining({ code: "brokenBindingTarget", nodeId: "broken" }),
        expect.objectContaining({ code: "unusedField", fieldId: "unused" }),
        expect.objectContaining({ code: "unusedField", fieldId: "message" }),
      ]),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.message).join(" "))
      .not.toMatch(/\/not\/a\/property|“missing”/u);

    const store = new EditorStore(bulletin({
      elements: [textElement("unlinked", "Please review", { name: "Pastor note" })],
    }), { initialMode: "customizeLayout" });
    expect(store.execute(createSetUnboundContentReviewCommand({
      owner: { kind: "document" },
      nodeId: "unlinked",
      weeklyReview: "everyBulletin",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.elements[0]?.weeklyReview).toBe("everyBulletin");
    store.undo();
    expect(store.getSnapshot().document.elements[0]?.weeklyReview).toBeUndefined();
  });
  it("authors and diagnoses weekly connections on page-level content", () => {
    const source = bulletin({
      elements: [],
      pageElements: [{
        id: "footerPlacement",
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
        element: textElement("footerText", "Weekly footer", { name: "Footer text" }),
      }],
    });
    const original = JSON.stringify(source);
    expect(authorableElements(source, { kind: "document" }).map((element) => element.id))
      .toEqual(["footerText"]);

    const store = new EditorStore(source, { initialMode: "customizeLayout" });
    expect(store.execute(createMakeWeeklyFieldCommand({
      owner: { kind: "document" },
      nodeId: "footerText",
      fieldId: "weeklyFooter",
      field: {
        id: "weeklyFooter",
        label: "Weekly footer",
        type: "text",
        required: false,
      },
      contractId: CONTRACT_A,
      target: "/data/content/text",
      bindingId: "weekly-footer-connection",
    })).status).toBe("applied");

    const authored = store.getSnapshot().document;
    const footer = authored.pageElements?.[0]?.element;
    expect(footer?.type === "text" ? footer.bindings?.[0] : undefined).toMatchObject({
      fieldId: "weeklyFooter",
      target: "/data/content/text",
    });
    expect(templateAuthoringDiagnostics(authored, { kind: "document" }))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "unusedField", fieldId: "weeklyFooter" }),
      ]));

    store.undo();
    expect(JSON.stringify(store.getSnapshot().document)).toBe(original);
  });
  it("visually groups and reorders weekly fields through one undoable command per action", () => {
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("message"), field("service"), field("notes")],
      },
    });
    const store = new EditorStore(document, { initialMode: "weeklyContent" });
    const addServiceGroup = createAddWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      group: { id: "service-details", label: "Service details" },
      contractId: CONTRACT_A,
    });

    expect(store.execute(addServiceGroup)).toMatchObject({
      status: "denied",
      denial: { code: "requiresCustomizeLayout" },
    });
    store.setMode("customizeLayout");
    expect(store.execute(addServiceGroup).status).toBe("applied");
    expect(store.execute(createAddWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      group: { id: "content", label: "Weekly content", description: "What changes" },
      contractId: CONTRACT_A,
    })).status).toBe("applied");
    expect(store.execute(createAssignWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      fieldId: "service",
      groupId: "service-details",
    })).status).toBe("applied");
    expect(store.execute(createAssignWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      fieldId: "message",
      groupId: "content",
    })).status).toBe("applied");
    expect(store.execute(createReorderWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      groupId: "content",
      toIndex: 0,
    })).status).toBe("applied");
    expect(store.execute(createReorderWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "notes",
      toIndex: 0,
    })).status).toBe("applied");
    expect(store.execute(createUpdateWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      groupId: "content",
      group: { id: "content", label: "Content for this week" },
    })).status).toBe("applied");

    expect(store.getSnapshot().document.fieldContract).toMatchObject({
      groups: [
        { id: "content", label: "Content for this week" },
        { id: "service-details", label: "Service details" },
      ],
      fields: [
        { id: "notes" },
        { id: "message", groupId: "content" },
        { id: "service", groupId: "service-details" },
      ],
    });

    expect(store.execute(createRemoveWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      groupId: "content",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.groups?.map((group) => group.id))
      .toEqual(["service-details"]);
    expect(store.getSnapshot().document.fieldContract?.fields[1]?.groupId).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]?.id).toBe("content");
    expect(store.getSnapshot().document.fieldContract?.fields[1]?.groupId).toBe("content");
  });

  it("creates a first empty group and refreshes Saved Section instance pins", () => {
    const blank = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    expect(blank.execute(createAddWeeklyFieldGroupCommand({
      owner: { kind: "document" },
      group: { id: "service", label: "Service" },
      contractId: CONTRACT_A,
    })).status).toBe("applied");
    expect(blank.getSnapshot().document.fieldContract).toMatchObject({
      groups: [{ id: "service", label: "Service" }],
      fields: [],
    });
    blank.undo();
    expect(blank.getSnapshot().document.fieldContract).toBeUndefined();

    const saved = new EditorStore(definitionDocument(), {
      initialMode: "customizeLayout",
    });
    const before = saved.getSnapshot().document.elements[0];
    expect(saved.execute(createAddWeeklyFieldGroupCommand({
      owner: { kind: "savedSection", definitionId: "savedCallout" },
      group: { id: "content", label: "Content" },
      contractId: CONTRACT_B,
    })).status).toBe("applied");
    const definition = saved.getSnapshot().document.customElementDefinitions?.[0];
    const after = saved.getSnapshot().document.elements[0];
    expect(after?.type === "customInstance" ? after.definitionHash : undefined)
      .not.toBe(before?.type === "customInstance" ? before.definitionHash : undefined);
    expect(after?.type === "customInstance" ? after.definitionHash : undefined)
      .toBe(definition?.definitionHash);
  });

  it("maps only compatible field types to the closed Church Profile keys", () => {
    const store = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [
          field("message"),
          field("logo", "assetRef"),
          {
            id: "language",
            label: "Language",
            type: "choice",
            required: false,
            constraints: { choices: [{ id: "en-US", label: "English" }] },
          },
          { id: "enabled", label: "Enabled", type: "boolean", required: false },
        ],
      },
    }), { initialMode: "customizeLayout" });

    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
      profileKey: "churchName",
    })).status).toBe("applied");
    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "logo",
      profileKey: "logo",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.fields.map((entry) => entry.profileKey))
      .toEqual(["churchName", "logo", undefined, undefined]);

    expect(() => store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "enabled",
      profileKey: "phone",
    }))).toThrow(/not compatible/u);
    expect(() => store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
      profileKey: "logo",
    }))).toThrow(/not compatible/u);
    expect(() => store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "logo",
      profileKey: "website",
    }))).toThrow(/not compatible/u);
    expect(() => store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "language",
      profileKey: "churchName",
    }))).toThrow(/not compatible/u);
    for (const removedKey of ["language", "congregationName"] as const) {
      expect(() => store.execute(createSetWeeklyFieldProfileMappingCommand({
        owner: { kind: "document" },
        fieldId: "message",
        profileKey: removedKey as unknown as ChurchProfileFieldKey,
      }))).toThrow(/not compatible/u);
    }

    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
      profileKey: "mailingAddress",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.profileKey)
      .toBe("mailingAddress");
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.profileKey)
      .toBe("churchName");

    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.profileKey).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.profileKey)
      .toBe("churchName");
  });

  it("bumps contract versions for weekly behavior and Profile mapping and clears stale hashes", () => {
    const originalContract = {
      id: CONTRACT_A,
      version: 4,
      name: "Weekly fields",
      fields: [{
        ...field("message"),
        weeklyBehavior: {
          rolloverPolicy: "clear" as const,
          reviewExpectation: "everyBulletin" as const,
        },
      }],
    };
    const document = bulletin({
      fieldContract: {
        ...originalContract,
        contractHash: fieldContractHash(originalContract),
      },
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });

    expect(store.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "message",
      field: {
        ...originalContract.fields[0]!,
        description: "Shown at the beginning.",
      },
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract).toMatchObject({ version: 4 });
    expect(store.getSnapshot().document.fieldContract?.contractHash).toBeUndefined();

    const described = store.getSnapshot().document.fieldContract!.fields[0]!;
    expect(store.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "message",
      field: {
        ...described,
        weeklyBehavior: {
          rolloverPolicy: "keep" as const,
          reviewExpectation: "whenCarried" as const,
        },
      },
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.version).toBe(5);

    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
      profileKey: "churchName",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract).toMatchObject({ version: 6 });
    expect(store.getSnapshot().document.fieldContract?.contractHash).toBeUndefined();
    expect(store.execute(createSetWeeklyFieldProfileMappingCommand({
      owner: { kind: "document" },
      fieldId: "message",
      profileKey: "churchName",
    })).status).toBe("noChange");
    expect(store.getSnapshot().document.fieldContract?.version).toBe(6);
  });

  it("bumps exactly once for every field-meaning edit, preserves exact no-ops, and guards overflow", () => {
    const baseContract = {
      id: CONTRACT_A,
      version: 4,
      name: "Weekly fields",
      fields: [field("message")],
    };
    const hashed = { ...baseContract, contractHash: fieldContractHash(baseContract) };
    const store = new EditorStore(bulletin({
      metadata: { serviceLabel: "Welcome" },
      fieldContract: hashed,
    }), {
      initialMode: "customizeLayout",
    });
    expect(store.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "message",
      field: field("message"),
    })).status).toBe("noChange");
    expect(store.getSnapshot().document.fieldContract).toEqual(hashed);

    const update = (change: Partial<FieldDefinition>): void => {
      const current = store.getSnapshot().document.fieldContract!.fields[0]!;
      expect(store.execute(createUpdateWeeklyFieldCommand({
        owner: { kind: "document" },
        fieldId: "message",
        field: { ...current, ...change },
      })).status).toBe("applied");
    };
    update({ required: true });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(5);
    update({ default: "Welcome" });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(6);
    update({ constraints: { minLength: 2, maxLength: 80 } });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(7);
    update({ semanticRole: "serviceLabel" });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(8);
    update({ description: "Presentation-only help text" });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(8);
    expect(store.getSnapshot().document.fieldContract?.contractHash).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.version).toBe(8);
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.description).toBeUndefined();

    const overflow = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: Number.MAX_SAFE_INTEGER,
        name: "Weekly fields",
        fields: [field("message")],
      },
    }), { initialMode: "customizeLayout" });
    expect(() => overflow.execute(createAddWeeklyFieldCommand({
      owner: { kind: "document" },
      field: field("extra"),
      contractId: CONTRACT_A,
    }))).toThrow(/revision limit/u);
  });

  it("reconciles semantic metadata for field defaults, role assignment, and choice labels", () => {
    const choiceSource = bulletin({
      metadata: { serviceLabel: "Sunday Service" },
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Service fields",
        fields: [{
          id: "serviceKind",
          label: "Service kind",
          type: "choice",
          required: false,
          semanticRole: "serviceLabel",
          constraints: {
            choices: [{ id: "sunday", label: "Sunday Service" }],
          },
        }],
      },
      fieldValues: {
        serviceKind: { value: "sunday", origin: "imported" },
      },
    });
    const choiceStore = new EditorStore(choiceSource, { initialMode: "customizeLayout" });
    const choiceField = choiceSource.fieldContract!.fields[0]!;
    expect(choiceStore.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: choiceField.id,
      field: {
        ...choiceField,
        constraints: {
          choices: [{ id: "sunday", label: "Sunday Divine Service" }],
        },
      },
    })).status).toBe("applied");
    expect(choiceStore.getSnapshot().document.fieldContract?.version).toBe(2);
    expect(choiceStore.getSnapshot().document.metadata?.serviceLabel)
      .toBe("Sunday Divine Service");
    choiceStore.undo();
    expect(choiceStore.getSnapshot().document).toEqual(choiceSource);

    const defaultSource = bulletin({
      metadata: { publicationDate: "2026-07-12" },
      fieldContract: {
        id: CONTRACT_A,
        version: 3,
        name: "Date fields",
        fields: [{
          id: "serviceDate",
          label: "Service date",
          type: "date",
          required: false,
          default: "2026-07-12",
          semanticRole: "publicationDate",
          weeklyBehavior: {
            rolloverPolicy: "clear",
            reviewExpectation: "everyBulletin",
          },
        }],
      },
    });
    const defaultStore = new EditorStore(defaultSource, { initialMode: "customizeLayout" });
    const dateField = defaultSource.fieldContract!.fields[0]!;
    expect(defaultStore.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: dateField.id,
      field: { ...dateField, default: "2026-07-19" },
    })).status).toBe("applied");
    expect(defaultStore.getSnapshot().document).toMatchObject({
      metadata: { publicationDate: "2026-07-19" },
      fieldContract: { version: 4 },
    });

    const roleSource = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Label fields",
        fields: [{
          id: "serviceName",
          label: "Service name",
          type: "text",
          required: false,
          default: "Festival Service",
        }],
      },
    });
    const roleStore = new EditorStore(roleSource, { initialMode: "customizeLayout" });
    const labelField = roleSource.fieldContract!.fields[0]!;
    expect(roleStore.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: labelField.id,
      field: { ...labelField, semanticRole: "serviceLabel" },
    })).status).toBe("applied");
    expect(roleStore.getSnapshot().document.metadata?.serviceLabel).toBe("Festival Service");
    roleStore.undo();
    expect(roleStore.getSnapshot().document).toEqual(roleSource);

    const addStore = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    expect(addStore.execute(createAddWeeklyFieldCommand({
      owner: { kind: "document" },
      contractId: CONTRACT_A,
      field: {
        id: "newServiceName",
        label: "New service name",
        type: "text",
        required: false,
        default: "New Service",
        semanticRole: "serviceLabel",
      },
    })).status).toBe("applied");
    expect(addStore.getSnapshot().document.metadata?.serviceLabel).toBe("New Service");
  });

  it("stores samples separately and rejects test values during reviewed authoring apply", () => {
    const store = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [{ ...field("message"), default: "Template default" }],
      },
    }), { initialMode: "customizeLayout" });
    expect(store.execute(createSetWeeklyFieldSampleValueCommand({
      owner: { kind: "document" },
      fieldId: "message",
      value: "Preview only",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.sampleFieldValues).toEqual({
      message: { value: "Preview only", origin: "manual" },
    });
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.default)
      .toBe("Template default");

    const source = store.getSnapshot().document;
    expect(store.execute(createApplyTemplateAuthoringChangesCommand({
      document: {
        ...source,
        page: { ...source.page, typstWidth: "6.5in" },
      },
    })).status).toBe("applied");
    expect(store.getSnapshot().document.page.typstWidth).toBe("6.5in");
    store.undo();
    expect(store.getSnapshot().document.page.typstWidth).toBe(source.page.typstWidth);

    expect(() => store.execute(createApplyTemplateAuthoringChangesCommand({
      document: {
        ...store.getSnapshot().document,
        fieldValues: { message: { value: "Test ingress", origin: "manual" } },
      },
    }))).toThrow(/Test values and review state cannot be applied/u);

    const savedStore = new EditorStore(definitionDocument(), {
      initialMode: "customizeLayout",
    });
    const savedSource = savedStore.getSnapshot().document;
    const savedInstance = savedSource.elements[0];
    if (savedInstance?.type !== "customInstance") throw new Error("Expected Saved Section instance");
    expect(() => savedStore.execute(createApplyTemplateAuthoringChangesCommand({
      document: {
        ...savedSource,
        elements: [{
          ...savedInstance,
          fieldValues: { message: { value: "Local test ingress", origin: "manual" } },
        }],
      },
    }))).toThrow(/Test values and review state cannot be applied/u);
  });

  it("offers Song source and formatted content as music binding targets", () => {
    const music = {
      id: "song",
      type: "music",
      name: "Opening hymn",
      data: {
        number: "301",
        title: "Amazing Grace",
        source: "Christian Worship",
        richContent: { type: "document", blocks: [{ type: "paragraph", children: [] }] },
        rightsAssociationReview: {
          reviewedSongContentHash: `sha256:${"a".repeat(64)}`,
          reviewedRightsProjectionHash: `sha256:${"b".repeat(64)}`,
          reviewTime: "2026-07-13T12:00:00Z",
        },
        rights: [],
      },
    } as unknown as CbbDocument["elements"][number];
    expect(bindableProperties(music)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: "/data/source",
        label: "Song source",
        acceptedTypes: ["text"],
        currentValue: "Christian Worship",
      }),
      expect.objectContaining({
        target: "/data/richContent",
        label: "Formatted song content",
        acceptedTypes: ["richText"],
      }),
    ]));
  });

  it("gates weekly-field design to Customize Layout and supports undo", () => {
    const store = new EditorStore(bulletin(), { initialMode: "weeklyContent" });
    const command = createAddWeeklyFieldCommand({
      owner: { kind: "document" },
      field: field("message"),
      contractId: CONTRACT_A,
    });

    expect(store.execute(command)).toMatchObject({
      status: "denied",
      denial: { code: "requiresCustomizeLayout" },
    });
    store.setMode("customizeLayout");
    expect(store.execute(command).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.label)
      .toBe("Welcome message");

    store.undo();
    expect(store.getSnapshot().document.fieldContract).toBeUndefined();
  });

  it("creates a field and visible connection atomically, then makes it independent", () => {
    // A value cannot exist before its contract, so begin from a valid document
    // and add it in the same fixture revision used by the editor.
    const valid = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("message")],
      },
      fieldValues: { message: { value: "This Sunday", origin: "manual" } },
    });
    const linked = new EditorStore(valid, { initialMode: "customizeLayout" });

    linked.execute(createMakeWeeklyFieldCommand({
      owner: { kind: "document" },
      nodeId: "heading",
      fieldId: "subtitle",
      field: { ...field("subtitle"), label: "Subtitle" },
      contractId: CONTRACT_A,
      target: "/data/content/text",
      bindingId: "subtitle-connection",
      fallback: "Welcome",
    }));
    const heading = linked.getSnapshot().document.elements[0];
    expect(linked.getSnapshot().document.fieldContract?.fields.map((entry) => entry.id))
      .toEqual(["message", "subtitle"]);
    expect(heading?.type === "text" ? heading.bindings?.[0] : undefined)
      .toMatchObject({ fieldId: "subtitle", target: "/data/content/text" });
    expect(heading?.type === "text" ? heading.data.content : undefined)
      .toEqual({ kind: "plain" });
    expect(linked.getSnapshot().document.fieldContract?.version).toBe(2);

    linked.execute(createMakeIndependentCommand({
      owner: { kind: "document" },
      nodeId: "heading",
      bindingId: "subtitle-connection",
    }));
    const independent = linked.getSnapshot().document.elements[0];
    expect(independent?.type === "text" ? independent.bindings : undefined).toBeUndefined();
    expect(independent?.type === "text" ? independent.data.content : undefined)
      .toEqual({ kind: "plain", text: "Welcome" });
    expect(linked.getSnapshot().document.fieldContract?.version).toBe(3);
    expect(linked.getSnapshot().document.name).toBe("Sunday Bulletin");
    linked.undo();
    const rebound = linked.getSnapshot().document.elements[0];
    expect(rebound?.type === "text" ? rebound.bindings?.[0]?.id : undefined)
      .toBe("subtitle-connection");
    expect(rebound?.type === "text" ? rebound.data.content : undefined)
      .toEqual({ kind: "plain" });
    expect(linked.getSnapshot().document.fieldContract?.version).toBe(2);
  });

  it("links Text, Date, Image, and Hymn targets without persisting competing literals", () => {
    const assetRef = "asset:00000000-0000-4000-8000-000000000001";
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 7,
        name: "Weekly fields",
        fields: [
          field("message"),
          field("otherMessage"),
          field("serviceDate", "date"),
          field("photo", "assetRef"),
          field("hymnTitle"),
        ],
      },
      elements: [
        textElement("linkedText", "Literal text"),
        { id: "linkedDate", type: "date", name: "Date", data: { value: "2026-07-13" } },
        { id: "linkedImage", type: "image", name: "Image", data: { assetRef, fit: "contain" } },
        {
          id: "linkedHymn",
          type: "music",
          name: "Hymn",
          data: {
            title: "Literal hymn",
            rightsAssociationReview: {
              reviewedSongContentHash: `sha256:${"a".repeat(64)}`,
              reviewedRightsProjectionHash: `sha256:${"b".repeat(64)}`,
              reviewTime: "2026-07-13T12:00:00Z",
            },
            rights: [],
          },
        },
      ],
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    for (const input of [
      { nodeId: "linkedText", fieldId: "message", target: "/data/content/text" },
      { nodeId: "linkedDate", fieldId: "serviceDate", target: "/data/value" },
      { nodeId: "linkedImage", fieldId: "photo", target: "/data/assetRef" },
      { nodeId: "linkedHymn", fieldId: "hymnTitle", target: "/data/title" },
    ]) {
      expect(store.execute(createLinkWeeklyFieldCommand({
        owner: { kind: "document" },
        ...input,
        bindingId: `${input.nodeId}-binding`,
      })).status).toBe("applied");
    }
    const [text, date, image, hymn] = store.getSnapshot().document.elements;
    expect(text?.type === "text" ? text.data.content : undefined).toEqual({ kind: "plain" });
    expect(date?.type === "date" ? date.data.value : "present").toBeUndefined();
    expect(image?.type === "image" ? image.data.assetRef : "present").toBeUndefined();
    expect(hymn?.type === "music" ? hymn.data.title : "present").toBeUndefined();
    expect(store.getSnapshot().document.fieldContract?.version).toBe(11);
    expect(() => store.execute(createLinkWeeklyFieldCommand({
      owner: { kind: "document" },
      nodeId: "linkedText",
      fieldId: "otherMessage",
      target: "/data/content",
      bindingId: "overlapping-binding",
    }))).toThrow(/overlaps/u);
    expect(store.getSnapshot().document.fieldContract?.version).toBe(11);
  });

  it("never resurrects stale optional literals and fails closed for missing required targets", () => {
    const assetRef = "asset:00000000-0000-4000-8000-000000000001";
    const optional = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("caption")],
      },
      elements: [{
        id: "photo",
        type: "image",
        name: "Photo",
        data: { assetRef, fit: "contain", alt: "Stale caption" },
        bindings: [{
          id: "caption-binding",
          scope: "document",
          fieldId: "caption",
          target: "/data/alt",
        }],
      }],
    }), { initialMode: "customizeLayout" });
    expect(optional.execute(createMakeIndependentCommand({
      owner: { kind: "document" },
      nodeId: "photo",
      bindingId: "caption-binding",
    })).status).toBe("applied");
    const photo = optional.getSnapshot().document.elements[0];
    expect(photo?.type === "image" ? photo.data.alt : "present").toBeUndefined();

    const removal = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("source")],
      },
      elements: [{
        id: "hymn",
        type: "music",
        name: "Hymn",
        data: {
          title: "A hymn",
          source: "Stale source",
          rightsAssociationReview: {
            reviewedSongContentHash: `sha256:${"c".repeat(64)}`,
            reviewedRightsProjectionHash: `sha256:${"d".repeat(64)}`,
            reviewTime: "2026-07-13T12:00:00Z",
          },
          rights: [],
        },
        bindings: [{
          id: "source-binding",
          scope: "document",
          fieldId: "source",
          target: "/data/source",
        }],
      }],
    }), { initialMode: "customizeLayout" });
    expect(removal.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "source",
    })).status).toBe("applied");
    const hymn = removal.getSnapshot().document.elements[0];
    expect(hymn?.type === "music" ? hymn.data.source : "present").toBeUndefined();

    const required = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [field("message")],
      },
      elements: [textElement("requiredText", "Stale text", {
        bindings: [{
          id: "required-binding",
          scope: "document",
          fieldId: "message",
          target: "/data/content/text",
        }],
      })],
    }), { initialMode: "customizeLayout" });
    expect(() => required.execute(createMakeIndependentCommand({
      owner: { kind: "document" },
      nodeId: "requiredText",
      bindingId: "required-binding",
    }))).toThrow(/current or default value/u);
    const requiredElement = required.getSnapshot().document.elements[0];
    expect(requiredElement?.type === "text"
      ? requiredElement.data.content
      : undefined).toEqual({ kind: "plain", text: "Stale text" });
  });

  it("removes a field together with its value, connection, and optional-section rule", () => {
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [{ id: "show", label: "Show greeting", type: "boolean", required: false }],
      },
      fieldValues: { show: { value: true, origin: "manual" } },
      contentRules: [{
        kind: "conditional",
        id: "showGreeting",
        targetNodeId: "body",
        scope: "document",
        fieldId: "show",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Show greeting",
        inactiveLabel: "Hide greeting",
      }],
      elements: [textElement("heading", "Welcome", {
        bindings: [{
          id: "show-connection",
          scope: "document",
          fieldId: "show",
          target: "/data/content",
          fallback: "Welcome",
        }],
      }), textElement("body", "News")],
    });
    // boolean is incompatible with the text connection, so use a separate
    // valid text field to prove connection cleanup.
    const valid: CbbDocument = {
      ...document,
      fieldContract: {
        ...(document.fieldContract as NonNullable<CbbDocument["fieldContract"]>),
        fields: [
          { id: "show", label: "Show greeting", type: "boolean", required: false },
          field("message"),
        ],
      },
      fieldValues: {
        show: { value: true, origin: "manual" },
        message: { value: "Current weekly welcome", origin: "manual" },
      },
      orphanedFieldValues: {
        [`document:${CONTRACT_A}:message`]: { value: "Older removed value", origin: "manual" },
      },
      elements: [textElement("heading", "Stale pre-binding welcome", {
        bindings: [{
          id: "message-connection",
          scope: "document",
          fieldId: "message",
          target: "/data/content/text",
        }],
      }), textElement("body", "News")],
    };
    const store = new EditorStore(valid, { initialMode: "customizeLayout" });
    store.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "message",
    }));
    expect(store.getSnapshot().document.fieldValues?.["message"]).toBeUndefined();
    const heading = store.getSnapshot().document.elements[0];
    expect(heading?.type === "text" ? heading.bindings : undefined).toBeUndefined();
    expect(heading?.type === "text" ? heading.data.content : undefined)
      .toEqual({ kind: "plain", text: "Current weekly welcome" });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(2);
    expect(store.getSnapshot().document.orphanedFieldValues).toMatchObject({
      [`document:${CONTRACT_A}:message`]: {
        value: "Older removed value",
        origin: "manual",
      },
      [`document:${CONTRACT_A}:message#2`]: {
        value: "Current weekly welcome",
        origin: "manual",
      },
    });
    store.undo();
    expect(store.getSnapshot().document.fieldValues?.["message"]?.value)
      .toBe("Current weekly welcome");
    expect(store.getSnapshot().document.orphanedFieldValues).toEqual({
      [`document:${CONTRACT_A}:message`]: {
        value: "Older removed value",
        origin: "manual",
      },
    });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(1);
    expect(store.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "message",
    })).status).toBe("applied");

    store.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "show",
    }));
    expect(store.getSnapshot().document.contentRules).toBeUndefined();
    expect(store.getSnapshot().document.fieldContract?.version).toBe(3);
  });

  it("builds boolean/choice conditions and bounded repeat rules", () => {
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        fields: [
          { id: "show", label: "Show prayers", type: "boolean", required: false },
          {
            id: "prayers",
            label: "Prayers",
            type: "array",
            required: false,
            constraints: { maxItems: 6 },
            itemField: { id: "prayer", label: "Prayer", type: "text", required: true },
          },
        ],
      },
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    expect(store.execute(createAddConditionalRuleCommand({
      owner: { kind: "document" },
      ruleId: "showPrayers",
      targetNodeId: "body",
      fieldId: "show",
      condition: { kind: "booleanEquals", value: true },
      activateLabel: "Include prayers",
      inactiveLabel: "Leave prayers out",
    })).status).toBe("applied");
    expect(store.execute(createAddRepeatRuleCommand({
      owner: { kind: "document" },
      ruleId: "repeatPrayers",
      prototypeNodeId: "heading",
      fieldId: "prayers",
      maxItems: 6,
      itemLabel: "Prayer",
      addLabel: "Add prayer",
      userReorderable: true,
    })).status).toBe("applied");
    expect(store.getSnapshot().document.contentRules).toEqual([
      expect.objectContaining({ kind: "conditional", targetNodeId: "body" }),
      expect.objectContaining({ kind: "repeat", maxItems: 6, itemLabel: "Prayer" }),
    ]);
  });

  it("saves, pins, inserts, and safely removes reusable sections", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    const ids = idPort();
    expect(store.execute(createSaveAsSavedSectionCommand({
      nodeId: "body",
      definitionId: "savedAnnouncements",
      contractId: CONTRACT_B,
      name: "Announcements",
      idPort: ids,
    })).status).toBe("applied");

    const definition = store.getSnapshot().document.customElementDefinitions?.[0];
    const instance = store.getSnapshot().document.elements[1];
    expect(definition?.name).toBe("Announcements");
    expect(instance).toMatchObject({
      id: "body",
      type: "customInstance",
      definitionId: "savedAnnouncements",
      definitionVersion: definition?.definitionVersion,
      definitionHash: definition?.definitionHash,
    });

    expect(store.execute(createInsertSavedSectionCommand({
      definitionId: "savedAnnouncements",
      instanceId: "anotherAnnouncement",
      index: 0,
    })).status).toBe("applied");
    expect(() => store.execute(createRemoveSavedSectionCommand({
      definitionId: "savedAnnouncements",
    }))).toThrow(/Make every inserted copy independent/u);
  });

  it("refreshes every inserted pin after a local field definition changes", () => {
    const store = new EditorStore(definitionDocument(), { initialMode: "customizeLayout" });
    const before = store.getSnapshot().document.elements[0];
    store.execute(createAddWeeklyFieldCommand({
      owner: { kind: "savedSection", definitionId: "savedCallout" },
      field: field("message"),
      contractId: CONTRACT_B,
    }));
    const after = store.getSnapshot().document.elements[0];
    expect(after?.type === "customInstance" ? after.definitionHash : undefined)
      .not.toBe(before?.type === "customInstance" ? before.definitionHash : undefined);
    expect(after?.type === "customInstance" ? after.definitionHash : undefined)
      .toBe(store.getSnapshot().document.customElementDefinitions?.[0]?.definitionHash);

    store.execute(createUpdateWeeklyFieldCommand({
      owner: { kind: "savedSection", definitionId: "savedCallout" },
      fieldId: "message",
      field: { ...field("message"), description: "Shown in the callout." },
    }));
    expect(store.getSnapshot().document.customElementDefinitions?.[0]?.fieldContract.fields[0]?.description)
      .toBe("Shown in the callout.");
  });

  it("cleans conditional group visibility and review state when removing its field", () => {
    const reviewHash = `sha256:${"a".repeat(64)}`;
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        groups: [{
          id: "seasonal",
          label: "Seasonal content",
          conditionalRuleId: "showSeasonal",
        }],
        fields: [{
          id: "show",
          label: "Include seasonal content",
          type: "boolean",
          required: false,
          groupId: "seasonal",
        }],
      },
      contentRules: [{
        kind: "conditional",
        id: "showSeasonal",
        targetNodeId: "body",
        scope: "document",
        fieldId: "show",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Include",
        inactiveLabel: "Leave out",
      }],
      fieldReview: [{
        target: { scope: "document", fieldId: "show" },
        disposition: "edited",
        reviewHash,
      }],
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    expect(store.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "document" },
      fieldId: "show",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]?.conditionalRuleId)
      .toBeUndefined();
    expect(store.getSnapshot().document.contentRules).toBeUndefined();
    expect(store.getSnapshot().document.fieldReview).toBeUndefined();
  });

  it("clears setup-group visibility when its conditional rule is removed", () => {
    const document = bulletin({
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Weekly fields",
        groups: [{ id: "seasonal", label: "Seasonal", conditionalRuleId: "showSeasonal" }],
        fields: [{ id: "show", label: "Show seasonal", type: "boolean", required: false }],
      },
      contentRules: [{
        kind: "conditional",
        id: "showSeasonal",
        targetNodeId: "body",
        scope: "document",
        fieldId: "show",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Show",
        inactiveLabel: "Hide",
      }],
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    expect(store.execute(createRemoveContentRuleCommand({
      owner: { kind: "document" },
      ruleId: "showSeasonal",
    })).status).toBe("applied");
    expect(store.getSnapshot().document.contentRules).toBeUndefined();
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]?.conditionalRuleId)
      .toBeUndefined();
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]?.conditionalRuleId)
      .toBe("showSeasonal");
  });

  it("removes a local field from its Saved Section, inserted values, reviews, and visible connections", () => {
    const reviewHash = `sha256:${"b".repeat(64)}`;
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "savedNotice",
      name: "Notice",
      fieldContract: {
        id: CONTRACT_B,
        version: 1,
        name: "Notice weekly fields",
        fields: [field("message")],
      },
      elements: [textElement("noticeText", "Fallback", {
        bindings: [{
          id: "notice-message-connection",
          scope: "local",
          fieldId: "message",
          target: "/data/content/text",
        }],
      })],
      sampleFieldValues: { message: { value: "Sample", origin: "manual" } },
    });
    const document = bulletin({
      customElementDefinitions: [definition],
      elements: [customInstanceFixture(definition, {
        id: "noticeInstance",
        type: "customInstance",
        name: "Notice",
        fieldValues: { message: { value: "Current", origin: "manual" } },
      })],
      fieldReview: [{
        target: { scope: "local", ownerNodeId: "noticeInstance", fieldId: "message" },
        disposition: "edited",
        reviewHash,
      }],
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    expect(store.execute(createRemoveWeeklyFieldCommand({
      owner: { kind: "savedSection", definitionId: definition.id },
      fieldId: "message",
    })).status).toBe("applied");

    const nextDefinition = store.getSnapshot().document.customElementDefinitions?.[0];
    expect(nextDefinition?.fieldContract.fields).toEqual([]);
    expect(nextDefinition?.sampleFieldValues).toBeUndefined();
    const source = nextDefinition?.elements[0];
    expect(source?.type === "text" ? source.bindings : undefined).toBeUndefined();
    expect(source?.type === "text" ? source.data.content : undefined)
      .toEqual({ kind: "plain", text: "Sample" });
    expect(nextDefinition?.fieldContract.version).toBe(2);
    const instance = store.getSnapshot().document.elements[0];
    expect(instance?.type === "customInstance" ? instance.fieldValues : undefined).toBeUndefined();
    expect(instance?.type === "customInstance" ? instance.definitionHash : undefined)
      .toBe(nextDefinition?.definitionHash);
    expect(store.getSnapshot().document.fieldReview).toBeUndefined();
    expect(store.getSnapshot().document.orphanedFieldValues).toMatchObject({
      [`local-sample:${definition.id}:message`]: { value: "Sample", origin: "manual" },
      [`local:${definition.id}:noticeInstance:message`]: {
        value: "Current",
        origin: "manual",
      },
    });
    store.undo();
    const restoredInstance = store.getSnapshot().document.elements[0];
    expect(restoredInstance?.type === "customInstance"
      ? restoredInstance.fieldValues?.["message"]?.value
      : undefined).toBe("Current");
    expect(store.getSnapshot().document.orphanedFieldValues).toBeUndefined();
  });

  it("duplicates a Saved Section with fresh visual, connection, and rule identities", () => {
    const source = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "sourceSection",
      name: "Seasonal notice",
      fieldContract: {
        id: CONTRACT_A,
        version: 1,
        name: "Seasonal fields",
        groups: [{ id: "display", label: "Display", conditionalRuleId: "showRule" }],
        fields: [
          { id: "show", label: "Show", type: "boolean", required: false, groupId: "display" },
          field("message"),
        ],
      },
      elements: [textElement("sourceText", "Notice", {
        bindings: [{
          id: "sourceConnection",
          scope: "local",
          fieldId: "message",
          target: "/data/content/text",
        }],
      })],
      contentRules: [{
        kind: "conditional",
        id: "showRule",
        targetNodeId: "sourceText",
        scope: "document",
        fieldId: "show",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Show",
        inactiveLabel: "Hide",
      }],
    });
    const store = new EditorStore(bulletin({ customElementDefinitions: [source] }), {
      initialMode: "customizeLayout",
    });
    expect(store.execute(createDuplicateSavedSectionCommand({
      definitionId: source.id,
      duplicateDefinitionId: "duplicateSection",
      contractId: CONTRACT_B,
      name: "Seasonal notice copy",
      idPort: idPort(),
    })).status).toBe("applied");
    const duplicate = store.getSnapshot().document.customElementDefinitions?.[1];
    expect(duplicate?.name).toBe("Seasonal notice copy");
    expect(duplicate?.elements[0]?.id).not.toBe(source.elements[0]?.id);
    const duplicateText = duplicate?.elements[0];
    expect(duplicateText?.type === "text" ? duplicateText.bindings?.[0]?.id : undefined)
      .not.toBe("sourceConnection");
    expect(duplicate?.contentRules?.[0]?.id).not.toBe("showRule");
    expect(duplicate?.contentRules?.[0]).toMatchObject({ targetNodeId: duplicate?.elements[0]?.id });
    expect(duplicate?.fieldContract.groups?.[0]?.conditionalRuleId)
      .toBe(duplicate?.contentRules?.[0]?.id);
  });

  it("makes a ruled Saved Section independent with its active values materialized", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "ruledSection",
      name: "Prayer list",
      fieldContract: {
        id: CONTRACT_B,
        version: 1,
        name: "Prayer list fields",
        fields: [
          { id: "show-heading", label: "Show heading", type: "boolean", required: false },
          {
            id: "items",
            label: "Prayers",
            type: "array",
            required: false,
            constraints: { maxItems: 4 },
            itemField: { id: "item", label: "Prayer", type: "text", required: true },
          },
        ],
      },
      elements: [
        textElement("optionalHeading", "Prayers"),
        textElement("prayerPrototype", "Prayer"),
      ],
      contentRules: [
        {
          kind: "conditional",
          id: "headingRule",
          targetNodeId: "optionalHeading",
          scope: "document",
          fieldId: "show-heading",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show heading",
          inactiveLabel: "Hide heading",
        },
        {
          kind: "repeat",
          id: "prayerRule",
          fieldId: "items",
          prototypeNodeId: "prayerPrototype",
          itemBindings: [{
            id: "prayerItemConnection",
            itemPath: "",
            targetNodeId: "prayerPrototype",
            target: "/data/content/text",
          }],
          emptyState: { mode: "collapse" },
          maxItems: 4,
          userReorderable: true,
          itemLabel: "Prayer",
          addLabel: "Add prayer",
        },
      ],
    });
    const document = bulletin({
      customElementDefinitions: [definition],
      elements: [customInstanceFixture(definition, {
        id: "prayerList",
        type: "customInstance",
        name: "Prayer list",
        fieldValues: {
          "show-heading": { value: false, origin: "manual" },
          items: {
            value: ["For comfort", "For healing"],
            origin: "manual",
            itemIds: [
              "11111111-1111-4111-8111-111111111111",
              "22222222-2222-4222-8222-222222222222",
            ],
          },
        },
      })],
    });
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    expect(store.execute(createMakeSavedSectionIndependentCommand({
      instanceId: "prayerList",
      idPort: idPort(),
    })).status).toBe("applied");
    const detached = store.getSnapshot().document.elements[0];
    expect(detached?.type).toBe("stack");
    if (detached?.type !== "stack") return;
    expect(detached.fieldContract).toBeUndefined();
    expect(detached.children).toHaveLength(2);
    expect(detached.children.map((wrapper) =>
      wrapper.element.type === "text" && wrapper.element.data.content?.kind === "plain"
        ? wrapper.element.data.content.text
        : undefined)).toEqual(["For comfort", "For healing"]);
  });
});
