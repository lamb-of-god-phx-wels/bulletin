// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { makeSequentialIdPort, type CbbDocument } from "@cbb/core";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
  textElement,
} from "../store/testFixtures.js";
import { DEFAULT_UI_SETTINGS } from "../settings/index.js";
import { findStarter } from "../onboarding/index.js";
import {
  reviewedSandboxAuthoringDocument,
  WeeklyWorkflowSandbox,
} from "./WeeklyWorkflowSandbox.js";

afterEach(cleanup);

describe("WeeklyWorkflowSandbox", () => {
  it("edits and resets disposable values without mutating the source or exposing persistence", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    const source = findStarter("simple-service").document;
    const originalSource = JSON.stringify(source);
    render(
      <WeeklyWorkflowSandbox
        source={source}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(700)}
        now={() => new Date(2026, 6, 13)}
        onExit={onExit}
      />,
    );
    expect(screen.getByRole("heading", { name: "Test weekly workflow" })).toBeTruthy();
    expect(screen.getByText(/never creates a bulletin/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Weekly Content" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /save|export/i })).toBeNull();

    const serviceName = screen.getByLabelText(
      "Service or gathering title (required)",
    ) as HTMLInputElement;
    expect(serviceName.value).toBe("Weekly gathering");
    await user.clear(serviceName);
    await user.type(serviceName, "Festival worship");
    expect((screen.getByLabelText(
      "Service or gathering title (required)",
    ) as HTMLInputElement).value).toBe("Festival worship");
    expect(JSON.stringify(source)).toBe(originalSource);

    await user.click(screen.getByRole("button", { name: "Reset test values" }));
    expect((screen.getByLabelText(
      "Service or gathering title (required)",
    ) as HTMLInputElement).value).toBe("Weekly gathering");
    expect(JSON.stringify(source)).toBe(originalSource);

    await user.click(screen.getByRole("button", { name: "Exit test" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("renders the ordered grouped setup contract and drives bindings and conditional groups live", async () => {
    const user = userEvent.setup();
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Conditional workflow",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "10000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Weekly setup",
        groups: [
          {
            id: "service",
            label: "Service details",
            description: "Start with this week’s service information.",
          },
          {
            id: "seasonal",
            label: "Seasonal details",
            conditionalRuleId: "show-seasonal",
          },
        ],
        fields: [
          {
            id: "showSeasonal",
            label: "Show seasonal section",
            type: "boolean",
            required: false,
            groupId: "service",
            default: false,
          },
          {
            id: "welcome",
            label: "Welcome message",
            type: "text",
            required: true,
            groupId: "service",
            description: "This appears at the beginning of the bulletin.",
            default: "Welcome default",
          },
          {
            id: "serviceDate",
            label: "Service date",
            type: "date",
            required: true,
            groupId: "service",
          },
          {
            id: "attendance",
            label: "Expected attendance",
            type: "number",
            required: false,
            groupId: "service",
            default: 25,
            constraints: { minimum: 0, maximum: 500 },
          },
          {
            id: "theme",
            label: "Service theme",
            type: "choice",
            required: false,
            groupId: "service",
            default: "grace",
            constraints: {
              choices: [
                { id: "grace", label: "Grace" },
                { id: "hope", label: "Hope" },
              ],
            },
          },
          {
            id: "formattedNotes",
            label: "Formatted notes",
            type: "richText",
            required: false,
            groupId: "service",
          },
          {
            id: "coverImage",
            label: "Cover image",
            type: "assetRef",
            required: false,
            groupId: "service",
          },
          {
            id: "announcements",
            label: "Announcements",
            type: "array",
            required: false,
            groupId: "service",
            constraints: { maxItems: 4 },
            itemField: { id: "announcement", label: "Announcement", type: "text", required: true },
          },
          {
            id: "structuredItems",
            label: "Structured items",
            type: "array",
            required: false,
            groupId: "service",
            itemField: {
              id: "structuredItem",
              label: "Structured item",
              type: "object",
              required: true,
              childFields: [{ id: "title", label: "Title", type: "text", required: true }],
            },
          },
          {
            id: "contact",
            label: "Contact details",
            type: "object",
            required: false,
            groupId: "service",
            childFields: [{ id: "name", label: "Name", type: "text", required: true }],
          },
          {
            id: "seasonalNote",
            label: "Seasonal note",
            type: "text",
            required: false,
            groupId: "seasonal",
            default: "A seasonal note",
          },
        ],
      },
      sampleFieldValues: {
        announcements: {
          value: ["First announcement", "Second announcement"],
          origin: "manual",
          itemIds: [
            "20000000-0000-4000-8000-000000000001",
            "20000000-0000-4000-8000-000000000002",
          ],
        },
      },
      contentRules: [
        {
          kind: "conditional",
          id: "show-seasonal",
          targetNodeId: "seasonalContent",
          scope: "document",
          fieldId: "showSeasonal",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show seasonal section",
          inactiveLabel: "Hide seasonal section",
        },
        {
          kind: "repeat",
          id: "repeat-announcements",
          fieldId: "announcements",
          prototypeNodeId: "announcementPrototype",
          itemBindings: [{
            id: "announcement-item-binding",
            itemPath: "",
            targetNodeId: "announcementPrototype",
            target: "/data/content/text",
          }],
          emptyState: { mode: "collapse" },
          maxItems: 3,
          userReorderable: true,
          itemLabel: "Announcement",
          addLabel: "Add announcement",
        },
      ],
      elements: [
        {
          id: "welcomeContent",
          type: "text",
          name: "Welcome",
          bindings: [{
            id: "welcome-binding",
            scope: "document",
            fieldId: "welcome",
            target: "/data/content/text",
          }],
          data: { content: { kind: "plain", text: "Stale welcome" } },
        },
        {
          id: "seasonalContent",
          type: "text",
          name: "Seasonal content",
          data: { content: { kind: "plain", text: "Seasonal preview content" } },
        },
        {
          id: "announcementPrototype",
          type: "text",
          name: "Announcement row",
          data: { content: { kind: "plain", text: "Announcement" } },
        },
      ],
    };
    const { container } = render(
      <WeeklyWorkflowSandbox
        source={source}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(800)}
        now={() => new Date(2026, 6, 13)}
        onExit={() => undefined}
      />,
    );

    expect(screen.getByRole("group", { name: "Service details" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Seasonal details" })).toBeNull();
    expect([...container.querySelectorAll<HTMLElement>(".cbb-weekly-field")]
      .map((row) => row.dataset["fieldId"])).toEqual([
        "showSeasonal",
        "welcome",
        "serviceDate",
        "attendance",
        "theme",
        "formattedNotes",
        "coverImage",
        "announcements",
        "structuredItems",
        "contact",
      ]);

    expect((screen.getByLabelText("Service date (required)") as HTMLInputElement).type)
      .toBe("date");
    expect(screen.getByLabelText("Service date (required)").getAttribute("aria-invalid"))
      .toBe("true");
    expect(screen.getByText("Required value is missing.")).toBeTruthy();
    expect((screen.getByLabelText("Expected attendance (optional)") as HTMLInputElement).type)
      .toBe("number");
    expect(screen.getByLabelText("Service theme (optional)").tagName).toBe("SELECT");
    expect(screen.getByText("Template default: 25")).toBeTruthy();
    expect(screen.getByText(/formatted content directly in the bulletin editor/u)).toBeTruthy();
    expect(screen.getByText(/bulletin editor’s image controls/u)).toBeTruthy();
    expect(screen.getByRole("group", { name: "New Structured item" })).toBeTruthy();
    const contact = container.querySelector<HTMLElement>("[data-field-id='contact']");
    if (contact === null) throw new Error("Expected structured contact field");
    await user.type(within(contact).getByLabelText("Name (required)"), "Grace Church");
    expect((within(contact).getByLabelText("Name (required)") as HTMLInputElement).value)
      .toBe("Grace Church");
    expect(screen.getByText(/Sample\/test starting value/u)).toBeTruthy();

    const newStructured = screen.getByRole("group", { name: "New Structured item" });
    await user.type(within(newStructured).getByLabelText("Title (required)"), "Structured title");
    await user.click(screen.getByRole("button", { name: "Add Structured item" }));
    const structured = screen.getByRole("group", { name: "Structured item 1" });
    expect((within(structured).getByLabelText("Title (required)") as HTMLInputElement).value)
      .toBe("Structured title");

    const surface = container.querySelector<HTMLElement>(".cbb-editor-surface");
    if (surface === null) throw new Error("Expected editor surface");
    expect(within(surface).getByText("Welcome default")).toBeTruthy();
    expect(within(surface).queryByText("Seasonal preview content")).toBeNull();
    expect(within(surface).getByText("First announcement")).toBeTruthy();
    expect(within(surface).getByText("Second announcement")).toBeTruthy();

    const welcome = screen.getByLabelText("Welcome message (required)") as HTMLInputElement;
    await user.clear(welcome);
    await user.type(welcome, "Live greeting");
    expect(within(surface).getByText("Live greeting")).toBeTruthy();

    const conditional = screen.getByLabelText(
      "Show seasonal section (optional)",
    ) as HTMLInputElement;
    await user.click(conditional);
    expect(screen.getByRole("group", { name: "Seasonal details" })).toBeTruthy();
    expect(within(surface).getByText("Seasonal preview content")).toBeTruthy();
    await user.click(conditional);
    expect(screen.queryByRole("group", { name: "Seasonal details" })).toBeNull();
    expect(within(surface).queryByText("Seasonal preview content")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Move Announcement 2 up" }));
    expect(within(surface).getAllByText(/announcement$/u).map((node) => node.textContent))
      .toEqual(["Second announcement", "First announcement"]);
    const firstItem = screen.getByLabelText("Announcement 1") as HTMLInputElement;
    await user.clear(firstItem);
    await user.type(firstItem, "Edited announcement");
    await user.tab();
    expect(within(surface).getByText("Edited announcement")).toBeTruthy();

    await user.type(screen.getByLabelText("New Announcement"), "Third announcement");
    await user.click(screen.getByRole("button", { name: "Add announcement" }));
    expect(within(surface).getByText("Third announcement")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add announcement" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText(/maximum of 3 items/u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove Announcement 2" }));
    expect(within(surface).queryByText("First announcement")).toBeNull();
    expect((screen.getByRole("button", { name: "Add announcement" }) as HTMLButtonElement).disabled)
      .toBe(false);

    const report = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(report.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious"
    )).toEqual([]);
  }, 15_000);

  it("edits conditional and structured repeated fields owned by a Saved section", async () => {
    const user = userEvent.setup();
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "savedAgenda",
      name: "Weekly agenda",
      fieldContract: {
        id: "30000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Agenda setup",
        groups: [
          { id: "agenda", label: "Agenda" },
          { id: "details", label: "Extra details", conditionalRuleId: "show-details-rule" },
        ],
        fields: [
          {
            id: "showDetails",
            label: "Show details",
            type: "boolean",
            required: false,
            default: false,
            groupId: "agenda",
          },
          {
            id: "agendaItems",
            label: "Agenda items",
            type: "array",
            required: false,
            groupId: "agenda",
            constraints: { maxItems: 2 },
            itemField: {
              id: "agendaItem",
              label: "Agenda item",
              type: "object",
              required: true,
              childFields: [{ id: "title", label: "Title", type: "text", required: true }],
            },
          },
          {
            id: "details",
            label: "Details",
            type: "text",
            required: false,
            default: "Saved-section detail",
            groupId: "details",
          },
        ],
      },
      sampleFieldValues: {
        agendaItems: {
          value: [{ title: "Opening hymn" }],
          origin: "manual",
          itemIds: ["40000000-0000-4000-8000-000000000001"],
        },
      },
      contentRules: [
        {
          kind: "conditional",
          id: "show-details-rule",
          targetNodeId: "detailText",
          scope: "document",
          fieldId: "showDetails",
          condition: { kind: "booleanEquals", value: true },
          activateLabel: "Show details",
          inactiveLabel: "Hide details",
        },
        {
          kind: "repeat",
          id: "agenda-repeat",
          fieldId: "agendaItems",
          prototypeNodeId: "agendaRow",
          itemBindings: [{
            id: "agenda-title-binding",
            itemPath: "/title",
            targetNodeId: "agendaRow",
            target: "/data/content/text",
          }],
          emptyState: { mode: "collapse" },
          maxItems: 2,
          userReorderable: true,
          itemLabel: "Agenda item",
          addLabel: "Add agenda item",
        },
      ],
      elements: [
        {
          id: "detailText",
          type: "text",
          name: "Details",
          bindings: [{
            id: "details-binding",
            scope: "local",
            fieldId: "details",
            target: "/data/content/text",
          }],
          data: { content: { kind: "plain", text: "Fallback details" } },
        },
        {
          id: "agendaRow",
          type: "text",
          name: "Agenda row",
          data: { content: { kind: "plain", text: "Agenda item" } },
        },
      ],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Saved section workflow",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition],
      elements: [customInstanceFixture(definition, {
        id: "agendaInstance",
        type: "customInstance",
        name: "Sunday agenda",
      })],
    };
    const original = JSON.stringify(source);
    const { container } = render(
      <WeeklyWorkflowSandbox
        source={source}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(900)}
        now={() => new Date(2026, 6, 13)}
        onExit={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Saved section: Sunday agenda" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Extra details" })).toBeNull();
    const surface = container.querySelector<HTMLElement>(".cbb-editor-surface");
    if (surface === null) throw new Error("Expected editor surface");
    expect(within(surface).getByText("Opening hymn")).toBeTruthy();

    const firstItem = screen.getByRole("group", { name: "Agenda item 1" });
    const firstTitle = within(firstItem).getByLabelText("Title (required)") as HTMLInputElement;
    await user.clear(firstTitle);
    await user.type(firstTitle, "Gathering song");
    expect(within(surface).getByText("Gathering song")).toBeTruthy();

    const newItem = screen.getByRole("group", { name: "New Agenda item" });
    await user.type(within(newItem).getByLabelText("Title (required)"), "Prayer of the day");
    await user.click(screen.getByRole("button", { name: "Add agenda item" }));
    const secondItem = screen.getByRole("group", { name: "Agenda item 2" });
    expect((within(secondItem).getByLabelText("Title (required)") as HTMLInputElement).value)
      .toBe("Prayer of the day");
    expect((screen.getByRole("button", { name: "Add agenda item" }) as HTMLButtonElement).disabled)
      .toBe(true);
    await user.click(screen.getByRole("button", { name: "Move Agenda item 2 up" }));
    expect(within(surface).getByText("Prayer of the day")).toBeTruthy();

    await user.click(screen.getByLabelText(
      "Show details (optional) — Saved section: Sunday agenda",
    ));
    expect(screen.getByRole("group", { name: "Extra details" })).toBeTruthy();
    expect(within(surface).getByText("Saved-section detail")).toBeTruthy();
    expect(JSON.stringify(source)).toBe(original);

    await user.click(screen.getByRole("button", { name: "Reset test values" }));
    const resetSurface = container.querySelector<HTMLElement>(".cbb-editor-surface");
    if (resetSurface === null) throw new Error("Expected reset editor surface");
    expect(within(resetSurface).queryByText("Gathering song")).toBeNull();
    expect(JSON.stringify(source)).toBe(original);
  }, 15_000);

  it("exposes one reachable shared nested Saved Section owner and never applies its test values", async () => {
    const user = userEvent.setup();
    const inner = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "nestedWeeklyDefinition",
      name: "Nested weekly definition",
      fieldContract: {
        id: "71000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Nested weekly fields",
        fields: [
          { id: "nestedNotice", label: "Nested notice", type: "text", required: false },
          {
            id: "nestedItems",
            label: "Nested items",
            type: "array",
            required: false,
            constraints: { maxItems: 2 },
            itemField: { id: "nestedItem", label: "Item", type: "text", required: true },
          },
        ],
      },
      sampleFieldValues: {
        nestedNotice: { value: "Nested sample", origin: "manual" },
        nestedItems: {
          value: ["First nested item"],
          origin: "manual",
          itemIds: ["72000000-0000-4000-8000-000000000001"],
        },
      },
      contentRules: [{
        kind: "repeat",
        id: "repeatNestedItems",
        fieldId: "nestedItems",
        prototypeNodeId: "nestedItemText",
        itemBindings: [{
          id: "nestedItemBinding",
          itemPath: "",
          targetNodeId: "nestedItemText",
          target: "/data/content/text",
        }],
        emptyState: { mode: "collapse" },
        maxItems: 2,
        userReorderable: true,
        itemLabel: "Item",
        addLabel: "Add nested item",
      }],
      elements: [
        {
          id: "nestedNoticeText",
          type: "text",
          name: "Nested notice text",
          bindings: [{
            id: "nestedNoticeBinding",
            scope: "local",
            fieldId: "nestedNotice",
            target: "/data/content/text",
          }],
          data: { content: { kind: "plain", text: "Fallback notice" } },
        },
        {
          id: "nestedItemText",
          type: "text",
          name: "Nested item text",
          data: { content: { kind: "plain", text: "Fallback item" } },
        },
      ],
    });
    const outer = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "outerWeeklyDefinition",
      name: "Outer section",
      fieldContract: {
        id: "71000000-0000-4000-8000-000000000002",
        version: 1,
        name: "Outer fields",
        fields: [],
      },
      elements: [customInstanceFixture(inner, {
        id: "sharedNestedOwner",
        type: "customInstance",
        name: "Nested weekly content",
      })],
    });
    const orphan = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "orphanWeeklyDefinition",
      name: "Orphan definition",
      fieldContract: {
        id: "71000000-0000-4000-8000-000000000003",
        version: 1,
        name: "Orphan fields",
        fields: [{ id: "orphanValue", label: "Orphan weekly value", type: "text", required: false }],
      },
      sampleFieldValues: { orphanValue: { value: "Never visible", origin: "manual" } },
      elements: [],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Nested Saved Section workflow",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [inner, outer, orphan],
      elements: [customInstanceFixture(outer, {
        id: "outerFirstOccurrence",
        type: "customInstance",
        name: "Outer first occurrence",
      }), customInstanceFixture(outer, {
        id: "outerSecondOccurrence",
        type: "customInstance",
        name: "Outer second occurrence",
      })],
    };
    const original = JSON.stringify(source);
    const onApplyAuthoringChanges = vi.fn();
    const { container } = render(
      <WeeklyWorkflowSandbox
        source={source}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(1600)}
        now={() => new Date(2026, 6, 13)}
        onExit={() => undefined}
        onApplyAuthoringChanges={onApplyAuthoringChanges}
      />,
    );

    const sharedOwnerName = "Saved section: Nested weekly content — shared inside Outer section";
    expect(screen.getAllByRole("heading", { name: sharedOwnerName })).toHaveLength(1);
    expect(screen.queryByLabelText(/Orphan weekly value/u)).toBeNull();
    const surface = container.querySelector<HTMLElement>(".cbb-editor-surface");
    if (surface === null) throw new Error("Expected editor surface");
    expect(within(surface).getAllByText("Nested sample")).toHaveLength(2);

    const notice = screen.getByLabelText(
      `Nested notice (optional) — ${sharedOwnerName}`,
    ) as HTMLInputElement;
    await user.clear(notice);
    await user.type(notice, "Edited nested notice");
    expect(within(surface).getAllByText("Edited nested notice")).toHaveLength(2);

    await user.type(screen.getByLabelText("New Item"), "Second nested item");
    await user.click(screen.getByRole("button", { name: "Add nested item" }));
    expect((screen.getByLabelText("Item 2") as HTMLInputElement).value).toBe("Second nested item");
    expect(within(surface).getAllByText("Second nested item")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Customize Layout" }));
    await user.click(screen.getByRole("button", { name: "Page setup" }));
    await user.selectOptions(screen.getByLabelText("Common size"), "a4");
    await waitFor(() => expect((screen.getByRole(
      "button",
      { name: "Review authoring changes" },
    ) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Review authoring changes" }));
    await user.click(screen.getByRole("button", { name: "Apply changes to template" }));

    expect(onApplyAuthoringChanges).toHaveBeenCalledOnce();
    const applied = onApplyAuthoringChanges.mock.calls[0]?.[0] as CbbDocument;
    const appliedOuter = applied.customElementDefinitions?.find((entry) => entry.id === outer.id);
    const appliedNested = appliedOuter?.elements[0];
    expect(appliedNested?.type === "customInstance" ? appliedNested.fieldValues : undefined)
      .toBeUndefined();
    expect(applied.customElementDefinitions?.find((entry) => entry.id === inner.id)?.sampleFieldValues)
      .toEqual(inner.sampleFieldValues);
    expect(applied.page).toMatchObject({ typstWidth: "210mm", typstHeight: "297mm" });
    expect(JSON.stringify(source)).toBe(original);
  }, 20_000);

  it("projects only reviewed authoring changes and restores every test value", () => {
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "savedDefinition",
      name: "Saved content",
      fieldContract: {
        id: "73000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Saved fields",
        fields: [{ id: "message", label: "Message", type: "text", required: false }],
      },
      elements: [textElement("savedText", "Saved")],
    });
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Reviewed template",
      metadata: { title: "Reviewed template" },
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldValues: { heading: { value: "Source value", origin: "manual" } },
      fieldReview: [],
      customElementDefinitions: [definition],
      elements: [customInstanceFixture(definition, {
        id: "savedInstance",
        type: "customInstance",
        name: "Saved content",
        fieldValues: { message: { value: "Source local value", origin: "manual" } },
      })],
    };
    const sandbox: CbbDocument = {
      ...source,
      kind: "bulletin",
      name: "Disposable test",
      metadata: { title: "Disposable test", publicationDate: "2026-07-13" },
      page: { typstWidth: "7in", typstHeight: "10in" },
      fieldValues: { heading: { value: "Test value", origin: "manual" } },
      fieldReview: [{
        target: { scope: "document", fieldId: "heading" },
        disposition: "edited",
        reviewHash: `sha256:${"a".repeat(64)}`,
      }],
      elements: [{
        ...(source.elements[0] as Extract<CbbDocument["elements"][number], { type: "customInstance" }>),
        fieldValues: { message: { value: "Test local value", origin: "manual" } },
      }],
    };

    const reviewed = reviewedSandboxAuthoringDocument(source, sandbox);
    expect(reviewed).toMatchObject({
      kind: "template",
      name: "Reviewed template",
      metadata: { title: "Reviewed template" },
      page: { typstWidth: "7in", typstHeight: "10in" },
      fieldValues: { heading: { value: "Source value", origin: "manual" } },
      fieldReview: [],
    });
    const instance = reviewed.elements[0];
    expect(instance?.type === "customInstance" ? instance.fieldValues : undefined)
      .toEqual({ message: { value: "Source local value", origin: "manual" } });
  });
});
