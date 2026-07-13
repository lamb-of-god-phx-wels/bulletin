import { useSyncExternalStore } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeSequentialIdPort,
  type CbbDocument,
  type IdPort,
} from "@cbb/core";
import { EditorStore } from "../store/editorStore.js";
import { bulletin, textElement } from "../store/testFixtures.js";
import {
  TemplateAuthoringPanel,
  type TemplateAuthoringPanelProps,
} from "./TemplateAuthoringPanel.js";

afterEach(cleanup);

const CONTRACT = "11111111-1111-4111-8111-111111111111";

function Harness(props: {
  readonly store: EditorStore;
  readonly idPort?: IdPort;
  readonly selectedNodeId?: string;
  readonly panelProps?: Partial<TemplateAuthoringPanelProps>;
}) {
  const snapshot = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  return (
    <TemplateAuthoringPanel
      document={snapshot.document}
      store={props.store}
      mode={snapshot.mode}
      selectedNodeId={props.selectedNodeId}
      idPort={props.idPort ?? makeSequentialIdPort(10)}
      confirmAction={() => true}
      {...props.panelProps}
    />
  );
}

function fieldDocument(): CbbDocument {
  return bulletin({
    fieldContract: {
      id: CONTRACT,
      version: 1,
      name: "Weekly fields",
      fields: [
        {
          id: "message",
          label: "Welcome message",
          type: "text",
          required: false,
          default: "Welcome",
        },
        { id: "show-prayers", label: "Include prayers", type: "boolean", required: false },
        {
          id: "prayers",
          label: "Prayers",
          type: "array",
          required: false,
          constraints: { maxItems: 8 },
          itemField: { id: "prayer", label: "Prayer", type: "text", required: true },
        },
        { id: "logo", label: "Bulletin logo", type: "assetRef", required: false },
      ],
    },
    elements: [
      textElement("heading", "Welcome", { name: "Welcome heading" }),
      textElement("prayerSection", "Prayers", { name: "Prayer section" }),
      textElement("emptyPrayers", "No prayer requests", { name: "No prayers message" }),
    ],
  });
}

describe("TemplateAuthoringPanel", () => {
  it("is keyboard navigable, explains the mode gate, and has no serious accessibility violations", async () => {
    const store = new EditorStore(bulletin(), { initialMode: "weeklyContent" });
    const { container } = render(<Harness store={store} />);

    expect(screen.getByText(/can only be designed in Customize Layout/u)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add weekly field" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const fieldsTab = screen.getByRole("tab", { name: "Weekly fields" });
    fieldsTab.focus();
    fireEvent.keyDown(fieldsTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Section rules" }).getAttribute("aria-selected"))
      .toBe("true");

    const report = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(report.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious"))
      .toEqual([]);
  });

  it("creates, edits, and removes a weekly field through plain-language controls", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Add weekly field" }));
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "Include sermon notes" } });
    fireEvent.change(screen.getByLabelText("What volunteers enter"), { target: { value: "boolean" } });
    fireEvent.change(screen.getByLabelText("Help text"), {
      target: { value: "Turn this on when notes are ready." },
    });
    fireEvent.change(screen.getByLabelText("Template default (optional)"), {
      target: { value: "true" },
    });
    const form = screen.getByLabelText("Field name").closest("form");
    if (form === null) throw new Error("Expected field form");
    fireEvent.click(within(form).getByRole("button", { name: "Add weekly field" }));

    expect(store.getSnapshot().document.fieldContract?.fields[0]).toMatchObject({
      label: "Include sermon notes",
      type: "boolean",
      description: "Turn this on when notes are ready.",
      default: true,
      weeklyBehavior: { rolloverPolicy: "clear", reviewExpectation: "everyBulletin" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Help text"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Template default (optional)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save field changes" }));
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.description).toBeUndefined();
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.default).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(store.getSnapshot().document.fieldContract?.fields).toEqual([]);
  });

  it("renames and reorders choice labels without breaking their hidden weekly identities", () => {
    const store = new EditorStore(bulletin({
      fieldContract: {
        id: CONTRACT,
        version: 1,
        name: "Weekly fields",
        fields: [{
          id: "season",
          label: "Season",
          type: "choice",
          required: false,
          default: "ordinary",
          constraints: {
            choices: [
              { id: "ordinary", label: "Ordinary" },
              { id: "festival", label: "Festival" },
            ],
          },
        }],
      },
      fieldValues: { season: { value: "ordinary", origin: "manual" } },
      sampleFieldValues: { season: { value: "festival", origin: "manual" } },
      contentRules: [{
        kind: "conditional",
        id: "ordinaryNews",
        targetNodeId: "body",
        scope: "document",
        fieldId: "season",
        condition: { kind: "choiceEquals", choiceId: "ordinary" },
        activateLabel: "Include ordinary-time news",
        inactiveLabel: "Leave ordinary-time news out",
      }],
    }), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "Festival\nOrdinary Time" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save field changes" }));

    const field = store.getSnapshot().document.fieldContract?.fields[0];
    expect(field?.constraints?.choices).toEqual([
      { id: "festival", label: "Festival" },
      { id: "ordinary", label: "Ordinary Time" },
    ]);
    expect(field?.default).toBe("ordinary");
    expect(store.getSnapshot().document.fieldValues?.["season"]?.value).toBe("ordinary");
    expect(store.getSnapshot().document.sampleFieldValues?.["season"]?.value).toBe("festival");
    expect(store.getSnapshot().document.contentRules?.[0]).toMatchObject({
      condition: { kind: "choiceEquals", choiceId: "ordinary" },
    });
    expect(store.getSnapshot().document.fieldContract?.version).toBe(2);
    store.undo();
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.constraints?.choices)
      .toEqual([
        { id: "ordinary", label: "Ordinary" },
        { id: "festival", label: "Festival" },
      ]);
  });

  it("designs grouped setup-form order and compatible Church Profile suggestions", () => {
    const store = new EditorStore(fieldDocument(), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Add setup-form group" }));
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Service details" },
    });
    fireEvent.change(screen.getByLabelText("Group help text (optional)"), {
      target: { value: "Start here each week" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]).toMatchObject({
      id: "service-details",
      label: "Service details",
      description: "Start here each week",
    });

    fireEvent.change(screen.getByLabelText("Form group for Welcome message"), {
      target: { value: "service-details" },
    });
    fireEvent.change(screen.getByLabelText("Form group for Include prayers"), {
      target: { value: "service-details" },
    });
    const textProfile = screen.getByLabelText(
      "Church Profile value for Welcome message",
    ) as HTMLSelectElement;
    expect(within(textProfile).getAllByRole("option").map((option) => option.getAttribute("value")))
      .toEqual([
        "",
        "churchName",
        "mailingAddress",
        "locationAddress",
        "phone",
        "email",
        "website",
        "defaultServiceLabel",
      ]);
    expect(within(textProfile).queryByRole("option", { name: /language/u })).toBeNull();
    fireEvent.change(textProfile, {
      target: { value: "churchName" },
    });
    expect(store.getSnapshot().document.fieldContract?.fields[0]).toMatchObject({
      groupId: "service-details",
      profileKey: "churchName",
    });
    const logoProfile = screen.getByLabelText(
      "Church Profile value for Bulletin logo",
    ) as HTMLSelectElement;
    expect(within(logoProfile).getAllByRole("option").map((option) => option.getAttribute("value")))
      .toEqual(["", "logo"]);
    fireEvent.change(logoProfile, { target: { value: "logo" } });
    expect(store.getSnapshot().document.fieldContract?.fields[3]?.profileKey).toBe("logo");
    expect((screen.getByLabelText(
      "Church Profile value for Include prayers",
    ) as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", {
      name: "Move Include prayers field up",
    }));
    expect(store.getSnapshot().document.fieldContract?.fields.map((field) => field.id))
      .toEqual(["show-prayers", "message", "prayers", "logo"]);

    fireEvent.click(screen.getByRole("button", { name: "Add setup-form group" }));
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Optional content" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    fireEvent.click(screen.getByRole("button", {
      name: "Move Optional content group up",
    }));
    expect(store.getSnapshot().document.fieldContract?.groups?.map((group) => group.id))
      .toEqual(["optional-content", "service-details"]);

    fireEvent.click(screen.getByRole("button", {
      name: "Rename Service details group",
    }));
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Sunday details" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save group changes" }));
    expect(store.getSnapshot().document.fieldContract?.groups?.[1]?.label)
      .toBe("Sunday details");

    fireEvent.click(screen.getByRole("button", {
      name: "Remove Sunday details group",
    }));
    expect(store.getSnapshot().document.fieldContract?.groups?.map((group) => group.id))
      .toEqual(["optional-content"]);
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.groupId).toBeUndefined();
    expect(store.getSnapshot().document.fieldContract?.fields[1]?.groupId).toBeUndefined();
  });

  it("connects visible content to a weekly field and makes it independent", () => {
    const store = new EditorStore(fieldDocument(), { initialMode: "customizeLayout" });
    render(<Harness store={store} selectedNodeId="heading" />);

    fireEvent.change(screen.getByLabelText("Existing weekly field"), {
      target: { value: "message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect field" }));
    const heading = store.getSnapshot().document.elements[0];
    expect(heading?.type === "text" ? heading.bindings?.[0] : undefined)
      .toMatchObject({ fieldId: "message", target: "/data/content/text" });
    expect(screen.getByText(/Linked weekly field: Welcome message/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Make independent" }));
    const independent = store.getSnapshot().document.elements[0];
    expect(independent?.type === "text" ? independent.bindings : undefined).toBeUndefined();
    expect(independent?.type === "text" ? independent.data.content : undefined)
      .toEqual({ kind: "plain", text: "Welcome" });
  });

  it("makes visible content weekly through one complete undoable dialog action", () => {
    const source = fieldDocument();
    const document: CbbDocument = {
      ...source,
      fieldContract: {
        ...(source.fieldContract as NonNullable<CbbDocument["fieldContract"]>),
        groups: [{ id: "service", label: "Service details" }],
      },
    };
    const store = new EditorStore(document, { initialMode: "customizeLayout" });
    render(<Harness store={store} selectedNodeId="heading" />);

    fireEvent.click(screen.getByRole("button", { name: "Make this a weekly field" }));
    expect(screen.getByRole("heading", { name: "Make Welcome heading a weekly field" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "Weekly welcome" } });
    fireEvent.change(screen.getByLabelText("Help text"), { target: { value: "Use this week’s greeting." } });
    fireEvent.change(screen.getByLabelText("Template default (optional)"), { target: { value: "Welcome, friends" } });
    fireEvent.change(screen.getByLabelText("Setup-form group"), { target: { value: "service" } });
    fireEvent.change(screen.getByLabelText("Church Profile suggestion (optional)"), {
      target: { value: "churchName" },
    });
    fireEvent.change(screen.getByLabelText("Next week"), { target: { value: "keep" } });
    fireEvent.change(screen.getByLabelText("Weekly review"), { target: { value: "whenCarried" } });
    fireEvent.click(screen.getByLabelText("Required before creating the PDF"));
    fireEvent.click(screen.getByRole("button", { name: "Create and connect weekly field" }));

    const created = store.getSnapshot().document.fieldContract?.fields.find(
      (field) => field.label === "Weekly welcome",
    );
    expect(created).toMatchObject({
      type: "text",
      description: "Use this week’s greeting.",
      required: true,
      groupId: "service",
      default: "Welcome, friends",
      profileKey: "churchName",
      weeklyBehavior: { rolloverPolicy: "keep", reviewExpectation: "whenCarried" },
    });
    const heading = store.getSnapshot().document.elements[0];
    expect(heading?.type === "text" ? heading.bindings?.at(-1) : undefined)
      .toMatchObject({ fieldId: created?.id, target: "/data/content/text" });

    store.undo();
    expect(store.getSnapshot().document.fieldContract?.fields.some(
      (field) => field.label === "Weekly welcome",
    )).toBe(false);
    const restoredHeading = store.getSnapshot().document.elements[0];
    expect(restoredHeading?.type === "text"
      ? restoredHeading.bindings
      : undefined).toBeUndefined();
  });

  it("authors structured repeat item fields and maps each field into a prototype", () => {
    const store = new EditorStore(bulletin({
      elements: [{
        id: "event",
        type: "stack",
        name: "Event row",
        data: { direction: "vertical", gap: "4pt" },
        children: [
          { id: "event-title-wrap", index: 0, element: textElement("title", "Title", { name: "Event title" }) },
          {
            id: "event-day-wrap",
            index: 1,
            element: {
              id: "day",
              type: "date",
              name: "Event day",
              data: { value: "2026-07-13" },
            },
          },
        ],
      }],
    }), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Add weekly field" }));
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "Events" } });
    fireEvent.change(screen.getByLabelText("What volunteers enter"), { target: { value: "array" } });
    fireEvent.change(screen.getByLabelText("Item fields"), { target: { value: "structured" } });
    fireEvent.change(screen.getByLabelText("Maximum items"), { target: { value: "5" } });
    const itemFieldNames = screen.getAllByLabelText("Field name");
    fireEvent.change(itemFieldNames[1] as HTMLInputElement, { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Add item field" }));
    const updatedNames = screen.getAllByLabelText("Field name");
    fireEvent.change(updatedNames[2] as HTMLInputElement, { target: { value: "Day" } });
    const valueTypes = screen.getAllByLabelText("Value type");
    fireEvent.change(valueTypes[1] as HTMLSelectElement, { target: { value: "date" } });
    const fieldForm = screen.getAllByLabelText("Field name")[0]?.closest("form");
    if (fieldForm === null || fieldForm === undefined) throw new Error("Expected weekly field form");
    fireEvent.click(within(fieldForm).getByRole("button", { name: "Add weekly field" }));

    expect(store.getSnapshot().document.fieldContract?.fields[0]).toMatchObject({
      type: "array",
      constraints: { maxItems: 5 },
      itemField: {
        type: "object",
        childFields: [
          { label: "Title", type: "text" },
          { label: "Day", type: "date" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Section rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow more than one" }));
    fireEvent.change(screen.getByLabelText("Section used as each item"), { target: { value: "event" } });
    fireEvent.change(screen.getByLabelText("Repeatable weekly field"), { target: { value: "events" } });
    fireEvent.change(screen.getByLabelText("Content for Title"), {
      target: { value: "title:/data/content/text" },
    });
    fireEvent.change(screen.getByLabelText("Content for Day"), {
      target: { value: "day:/data/value" },
    });
    fireEvent.click(screen.getByLabelText("Empty"));
    fireEvent.click(screen.getByRole("button", { name: "Add repeated-section rule" }));
    expect(store.getSnapshot().document.contentRules?.[0]).toMatchObject({
      kind: "repeat",
      fieldId: "events",
      prototypeNodeId: "event",
      itemBindings: [
        { itemPath: "/item-title", targetNodeId: "title" },
        { itemPath: "/day-2", targetNodeId: "day" },
      ],
    });
  });

  it("keeps sample/test values visibly separate from defaults", () => {
    const store = new EditorStore(fieldDocument(), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);
    const sample = screen.getByLabelText("Sample/test value for Welcome message");
    fireEvent.change(sample, { target: { value: "Preview greeting" } });
    const samplePanel = sample.closest<HTMLElement>(".cbb-template-sample");
    if (samplePanel === null) throw new Error("Expected sample panel");
    fireEvent.click(within(samplePanel).getByRole("button", { name: "Save sample/test value" }));
    expect(store.getSnapshot().document.sampleFieldValues?.["message"]?.value)
      .toBe("Preview greeting");
    expect(store.getSnapshot().document.fieldContract?.fields[0]?.default).toBe("Welcome");
    expect(within(samplePanel).getByText(/separate from the template default/u)).toBeTruthy();
  });

  it("creates, previews, edits, and removes optional and repeated section rules", () => {
    const store = new EditorStore(fieldDocument(), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);
    fireEvent.click(screen.getByRole("tab", { name: "Section rules" }));

    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "prayerSection" } });
    fireEvent.change(screen.getByLabelText("Weekly field"), { target: { value: "show-prayers" } });
    expect((screen.getByRole("button", { name: "Add optional-section rule" }) as HTMLButtonElement).disabled)
      .toBe(true);
    fireEvent.click(screen.getByLabelText("Active"));
    fireEvent.click(screen.getByLabelText("Inactive"));
    expect(screen.getByText("The section is left out.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add optional-section rule" }));
    expect(store.getSnapshot().document.contentRules?.[0]).toMatchObject({
      kind: "conditional",
      targetNodeId: "prayerSection",
      fieldId: "show-prayers",
    });

    const ruleList = screen.getByRole("list", { name: "Section rules" });
    fireEvent.click(within(ruleList).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Action when active"), { target: { value: "Show prayers" } });
    fireEvent.click(screen.getByLabelText("Active"));
    fireEvent.click(screen.getByLabelText("Inactive"));
    fireEvent.click(screen.getByRole("button", { name: "Save rule changes" }));
    expect(store.getSnapshot().document.contentRules?.[0]).toMatchObject({ activateLabel: "Show prayers" });

    fireEvent.click(screen.getByRole("button", { name: "Allow more than one" }));
    fireEvent.change(screen.getByLabelText("Section used as each item"), { target: { value: "heading" } });
    fireEvent.change(screen.getByLabelText("Repeatable weekly field"), { target: { value: "prayers" } });
    fireEvent.change(screen.getByLabelText("Content filled by each item"), {
      target: { value: "heading:/data/content/text" },
    });
    fireEvent.change(screen.getByLabelText("Maximum items"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("With items"));
    fireEvent.click(screen.getByLabelText("Empty"));
    expect(screen.getByText("The repeated section is hidden.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add repeated-section rule" }));
    expect(store.getSnapshot().document.contentRules?.[1]).toMatchObject({
      kind: "repeat",
      fieldId: "prayers",
      maxItems: 6,
      userReorderable: true,
      itemBindings: [expect.objectContaining({
        itemPath: "",
        targetNodeId: "heading",
        target: "/data/content/text",
      })],
    });

    const updatedRuleList = screen.getByRole("list", { name: "Section rules" });
    const rows = within(updatedRuleList).getAllByRole("listitem");
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(store.getSnapshot().document.contentRules).toHaveLength(1);
  });

  it("authors conditional setup-form group visibility only after both states are previewed", () => {
    const document = fieldDocument();
    const store = new EditorStore({
      ...document,
      contentRules: [{
        kind: "conditional",
        id: "show-prayers-rule",
        targetNodeId: "prayerSection",
        scope: "document",
        fieldId: "show-prayers",
        condition: { kind: "booleanEquals", value: true },
        activateLabel: "Include prayers",
        inactiveLabel: "Leave prayers out",
      }],
    }, { initialMode: "customizeLayout" });
    render(<Harness store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Add setup-form group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Prayer details" } });
    fireEvent.change(screen.getByLabelText("Show this section when"), {
      target: { value: "show-prayers-rule" },
    });
    expect((screen.getByRole("button", { name: "Add group" }) as HTMLButtonElement).disabled)
      .toBe(true);
    const groupForm = screen.getByLabelText("Group name").closest("form");
    if (groupForm === null) throw new Error("Expected group form");
    fireEvent.click(within(groupForm).getByLabelText("Inactive"));
    expect(screen.getByText(/stays hidden/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add group" }));
    expect(store.getSnapshot().document.fieldContract?.groups?.[0]).toMatchObject({
      label: "Prayer details",
      conditionalRuleId: "show-prayers-rule",
    });
    expect(screen.getByText(/Show this section when: Include prayers/u)).toBeTruthy();
  });

  it("shows concrete template checks and controls review reminders for unlinked content", () => {
    const store = new EditorStore(fieldDocument(), { initialMode: "customizeLayout" });
    render(<Harness store={store} />);
    const checks = screen.getByRole("list", { name: "Template connection checks" });
    expect(within(checks).getByText(/Weekly field “Welcome message” is unused/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Review reminder for Welcome heading"), {
      target: { value: "everyBulletin" },
    });
    expect(store.getSnapshot().document.elements[0]?.weeklyReview).toBe("everyBulletin");
  });

  it("saves, inserts, renames, and makes a Saved Section copy independent", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    render(<Harness store={store} selectedNodeId="body" />);
    fireEvent.click(screen.getByRole("tab", { name: "Saved Sections" }));

    fireEvent.change(screen.getByLabelText("Saved section name"), { target: { value: "Announcements" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), { target: { value: "Weekly news block" } });
    fireEvent.click(screen.getByRole("button", { name: "Save section for reuse" }));
    expect(store.getSnapshot().document.customElementDefinitions?.[0]).toMatchObject({
      name: "Announcements",
      description: "Weekly news block",
    });
    expect(store.getSnapshot().document.elements[1]?.type).toBe("customInstance");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("New Saved section name"), { target: { value: "Church announcements" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(store.getSnapshot().document.customElementDefinitions?.[0]?.name).toBe("Church announcements");

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(store.getSnapshot().document.elements.filter((element) => element.type === "customInstance"))
      .toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Make independent" }));
    expect(store.getSnapshot().document.elements[1]?.type).toBe("stack");
    expect(store.getSnapshot().document.customElementDefinitions).toHaveLength(1);
  });

  it("exposes truthful lifecycle actions and hides update controls without a source link", () => {
    const store = new EditorStore(bulletin(), { initialMode: "customizeLayout" });
    const onSaveAsTemplate = vi.fn();
    const onTestWeeklyWorkflow = vi.fn();
    const onUpdateTemplateForFutureBulletins = vi.fn();
    render(<Harness store={store} panelProps={{
      onSaveAsTemplate,
      onTestWeeklyWorkflow,
      onUpdateTemplateForFutureBulletins,
    }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this bulletin as a template" }));
    fireEvent.click(screen.getByRole("button", { name: "Test weekly workflow" }));
    expect(onSaveAsTemplate).toHaveBeenCalledWith(store.getSnapshot().document);
    expect(onTestWeeklyWorkflow).toHaveBeenCalledWith(store.getSnapshot().document);
    expect(screen.queryByRole("button", { name: /source template|future bulletins/u })).toBeNull();
    expect(onUpdateTemplateForFutureBulletins).not.toHaveBeenCalled();
  });
});
