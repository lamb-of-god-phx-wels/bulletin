// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalRevisionToken,
  fieldContractHash,
  makeSequentialIdPort,
  type CbbDocument,
} from "@cbb/core";
import { RendererApplication } from "./RendererApplication.js";
import {
  createBulletinFromStarter,
  createBulletinFromTemplateDocument,
} from "./documentFactory.js";
import { STARTER_CATALOG } from "../onboarding/index.js";
import { MemoryRendererBridge } from "./testBridge.js";

afterEach(() => cleanup());

describe("RendererApplication", () => {
  it("surfaces the host read-only capability before offering an editing workspace", async () => {
    const bridge = new MemoryRendererBridge();
    bridge.bootstrapState = { workspaceAccess: "readOnly" };
    render(<RendererApplication bridge={bridge} browserDemo={false} />);

    expect(await screen.findByText("Read-only library")).toBeTruthy();
    expect(screen.getByText(/creating, duplicating, editing, and saving are disabled/u)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Set up your bulletin library" })).toBeNull();
  });

  it("plainly labels the browser demo as temporary", async () => {
    render(
      <RendererApplication
        bridge={new MemoryRendererBridge()}
        idPort={makeSequentialIdPort(10)}
        browserDemo
      />,
    );

    expect(await screen.findByText("Browser demo")).toBeTruthy();
    expect(screen.getByText(/last only until you reload the page/u)).toBeTruthy();
  });

  it("makes an empty first launch skippable and creates a valid starter bulletin", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(20)}
        browserDemo={false}
        now={() => new Date(2026, 6, 13, 10)}
        confirmAction={() => true}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Set up your bulletin library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use a starter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start blank" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip setup" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    expect(screen.getByRole("button", { name: "Start blank" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import bulletin or template" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Use a starter" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    await user.click(screen.getByRole("radio", { name: /Announcements and news/u }));
    await user.click(screen.getByRole("button", { name: "Create and open" }));

    expect(await screen.findByRole("heading", { name: "Announcements and news — 2026-07-13" })).toBeTruthy();
    expect(bridge.records.size).toBe(1);
    expect([...bridge.records.values()][0]?.document.kind).toBe("bulletin");
    expect(await screen.findByText("Community News")).toBeTruthy();
  });

  it("starts a blank accessible bulletin directly from the first-launch entry", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(25)}
        browserDemo={false}
        now={() => new Date(2026, 6, 13, 10)}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Start blank" }));
    expect(await screen.findByRole("heading", { name: "Blank accessible layout — 2026-07-13" })).toBeTruthy();
    expect(bridge.workspaceSettings.firstRun).toMatchObject({ disposition: "skipped" });
    expect([...bridge.records.values()][0]?.document.kind).toBe("bulletin");
  });

  it("persists a skipped setup so it does not reappear after a restart", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    const first = render(<RendererApplication bridge={bridge} browserDemo={false} />);

    await user.click(await screen.findByRole("button", { name: "Skip setup" }));
    await screen.findByRole("heading", { name: "This Week", level: 1 });
    expect(bridge.workspaceSettings.firstRun).toEqual({
      version: 1,
      disposition: "skipped",
      tourCompleted: true,
    });

    first.unmount();
    render(<RendererApplication bridge={bridge} browserDemo={false} />);
    expect(await screen.findByRole("heading", { name: "This Week", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Set up your bulletin library" })).toBeNull();
  });

  it("uses the path-free desktop location action and reports its closed outcome", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    bridge.chooseWorkspaceLocation = vi.fn(async () => ({ status: "restarting" as const }));
    render(<RendererApplication bridge={bridge} browserDemo={false} />);

    await user.click(await screen.findByText("Advanced"));
    await user.click(screen.getByRole("button", { name: "Choose another location" }));
    expect(bridge.chooseWorkspaceLocation).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Restarting with the chosen bulletin-library location/u)).toBeTruthy();
  });

  it("resumes the current setup step and answers after a restart", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    const first = render(<RendererApplication bridge={bridge} browserDemo={false} />);

    await user.type(
      await screen.findByLabelText("Church or congregation name (optional)"),
      "Lamb of God",
    );
    await user.click(screen.getByText("Contact details (optional)"));
    await user.type(screen.getByLabelText("Mailing address"), "2210 E. Indian School Road");
    await user.type(screen.getByLabelText("Phone"), "602-555-0100");
    await user.type(screen.getByLabelText("Email"), "office@example.test");
    await user.type(screen.getByLabelText("Website"), "https://example.test");
    await user.click(screen.getByRole("radio", { name: "Folded booklet" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("radio", { name: /Folded letter booklet/u }));
    await waitFor(() => expect(bridge.workspaceSettings.firstRun).toMatchObject({
      disposition: "inProgress",
      step: 1,
      churchName: "Lamb of God",
      mailingAddress: "2210 E. Indian School Road",
      phone: "602-555-0100",
      email: "office@example.test",
      website: "https://example.test",
      preferredOutput: "foldedBooklet",
      starterId: "folded-letter",
      createPracticeBulletin: true,
    }));

    first.unmount();
    render(<RendererApplication bridge={bridge} browserDemo={false} />);
    expect(await screen.findByRole("heading", { name: "Choose a starter" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Folded letter booklet/u })).toHaveProperty("checked", true);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Church or congregation name (optional)")).toHaveProperty("value", "Lamb of God");
    expect(screen.getByLabelText("Mailing address")).toHaveProperty("value", "2210 E. Indian School Road");
  });

  it("imports a managed first-run logo and saves its portable identity in Church Profile", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    const asset = {
      localAssetId: "30000000-0000-4000-8000-000000000003",
      assetRef: "asset:40000000-0000-4000-8000-000000000004",
      displayName: "Church mark",
      mediaType: "image/svg+xml" as const,
      byteSize: 42,
      importedAt: "2026-07-13T05:00:00.000Z",
    };
    bridge.imageImportOutcome = { status: "imported", asset };
    render(<RendererApplication bridge={bridge} browserDemo={false} />);

    await user.click(await screen.findByRole("button", { name: "Import logo" }));
    expect(await screen.findByText("Church mark is selected for Church Profile.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("checkbox", { name: /Create a practice bulletin/u }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(bridge.churchProfile?.logo).toBe(asset.assetRef));
    expect(bridge.workspaceSettings.firstRun).toMatchObject({ disposition: "completed" });
  });

  it("creates and opens a real template from a built-in starter", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    bridge.workspaceSettings = {
      ...bridge.workspaceSettings,
      firstRun: { version: 1, disposition: "skipped", tourCompleted: true },
    };
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(30)}
        browserDemo={false}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Templates" }));
    await user.click((await screen.findAllByRole("button", { name: "Use this starter" }))[0]!);

    expect(await screen.findByRole("heading", { name: "Simple service", level: 1 })).toBeTruthy();
    const created = [...bridge.records.values()][0];
    expect(created?.resourceKind).toBe("template");
    expect(created?.document.kind).toBe("template");
  });

  it("creates, persists, and opens an independent bulletin from a saved template", async () => {
    const user = userEvent.setup();
    const starter = STARTER_CATALOG[0]!.document;
    if (starter.fieldContract === undefined) throw new Error("starter contract missing");
    const savedContract = {
      ...starter.fieldContract,
      fields: starter.fieldContract.fields.map((field) =>
        field.id === "serviceName" ? { ...field, default: "Sunday Worship" } : field
      ),
    };
    const savedTemplate: CbbDocument = {
      ...starter,
      name: "Saved Sunday template",
      metadata: { ...starter.metadata, title: "Saved Sunday template" },
      fieldContract: savedContract,
    };
    const templateLocalResourceId = "10000000-0000-4000-8000-000000000097";
    const bridge = new MemoryRendererBridge([{
      localResourceId: templateLocalResourceId,
      resourceKind: "template",
      displayName: savedTemplate.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document: savedTemplate,
    }]);
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(35)}
        browserDemo={false}
        now={() => new Date(2026, 6, 13, 10)}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Templates" }));
    expect(await screen.findByRole("button", { name: "Edit template" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create bulletin" }));

    expect(await screen.findByRole("heading", {
      name: "Saved Sunday template — 2026-07-13",
      level: 1,
    })).toBeTruthy();
    const created = [...bridge.records.values()].find((record) =>
      record.resourceKind === "bulletin"
    );
    expect(created?.document.kind).toBe("bulletin");
    expect(created?.document.sampleFieldValues).toBeUndefined();
    expect(created?.document.fieldValues?.["serviceName"]).toBeUndefined();
    expect(created?.document.fieldContract?.fields.find((field) =>
      field.id === "serviceName"
    )?.default).toBe("Sunday Worship");
    expect(created?.document.sourceTemplate).toEqual({
      contractId: savedContract.id,
      contractVersion: savedContract.version,
      contractHash: fieldContractHash(savedContract),
      sourceDocumentHash: canonicalRevisionToken(savedTemplate),
      sourceDisplayName: "Saved Sunday template",
    });
    expect(JSON.stringify(created?.document)).not.toContain(templateLocalResourceId);
    expect(bridge.workspaceSettings.sourceTemplateLinks).toEqual([{
      bulletinLocalResourceId: created?.localResourceId,
      templateLocalResourceId,
    }]);

    await user.click(screen.getByRole("button", { name: "Back to library" }));
    const createAgain = await screen.findByRole("button", { name: "Create bulletin" });
    await waitFor(() => expect(document.activeElement).toBe(createAgain));
  });

  it("restores a local source-template shortcut after restart and can remove only that shortcut", async () => {
    const user = userEvent.setup();
    const templateLocalResourceId = "10000000-0000-4000-8000-000000000091";
    const bulletinLocalResourceId = "10000000-0000-4000-8000-000000000092";
    const source: CbbDocument = {
      ...STARTER_CATALOG[0]!.document,
      name: "Restart source template",
      metadata: { ...STARTER_CATALOG[0]!.document.metadata, title: "Restart source template" },
    };
    const bulletin = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(41),
      publicationDate: "2026-07-13",
      displayName: "Restart bulletin",
    });
    const bridge = new MemoryRendererBridge([
      {
        localResourceId: templateLocalResourceId,
        resourceKind: "template",
        displayName: source.name,
        modifiedAt: "2026-07-13T05:00:00.000Z",
        revisionToken: `sha256:${"1".repeat(64)}`,
        document: source,
      },
      {
        localResourceId: bulletinLocalResourceId,
        resourceKind: "bulletin",
        displayName: bulletin.name,
        modifiedAt: "2026-07-13T05:00:00.000Z",
        revisionToken: `sha256:${"2".repeat(64)}`,
        document: bulletin,
      },
    ]);
    bridge.workspaceSettings = {
      ...bridge.workspaceSettings,
      firstRun: { version: 1, disposition: "skipped", tourCompleted: true },
      sourceTemplateLinks: [{ bulletinLocalResourceId, templateLocalResourceId }],
    };

    render(
      <RendererApplication
        bridge={bridge}
        browserDemo={false}
        confirmAction={() => true}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Bulletins" }));
    await user.click(await screen.findByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Customize Layout" }));
    await user.click(screen.getByRole("button", { name: "Template tools" }));
    await user.click(screen.getByRole("tab", { name: "Template actions" }));
    expect(screen.getByRole("button", { name: "Open source template" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Open source template" }));
    expect(await screen.findByRole("heading", { name: "Restart source template", level: 1 })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Back to library" }));
    await user.click(await screen.findByRole("button", { name: "Open" }));
    await user.click(await screen.findByRole("button", { name: "Customize Layout" }));
    await user.click(screen.getByRole("button", { name: "Template tools" }));
    await user.click(screen.getByRole("tab", { name: "Template actions" }));
    await user.click(screen.getByRole("button", { name: "Change only this bulletin" }));

    await waitFor(() => expect(bridge.workspaceSettings.sourceTemplateLinks).toBeUndefined());
    expect(screen.queryByRole("button", { name: "Open source template" })).toBeNull();
    expect(bridge.records.get(bulletinLocalResourceId)?.document).toEqual(bulletin);
    expect(bridge.records.get(templateLocalResourceId)?.document).toEqual(source);
  });

  it("creates the optional practice bulletin, resumes its tour, and durably completes it", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(40)}
        browserDemo={false}
        now={() => new Date(2026, 6, 13, 10)}
      />,
    );

    await user.type(await screen.findByLabelText("Church or congregation name (optional)"), "St. John’s");
    await user.click(screen.getByText("Contact details (optional)"));
    await user.type(screen.getByLabelText("Mailing address"), "100 Church Street");
    await user.type(screen.getByLabelText("Worship location address"), "200 Chapel Avenue");
    await user.type(screen.getByLabelText("Phone"), "602-555-0100");
    await user.type(screen.getByLabelText("Email"), "office@stjohns.example");
    await user.type(screen.getByLabelText("Website"), "https://stjohns.example");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(await screen.findByRole("heading", { name: "St. John’s — 2026-07-13", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("dialog", { name: "Fill this week’s content" })).toBeTruthy();
    expect(bridge.workspaceSettings.firstRun).toMatchObject({
      disposition: "completed",
      tourCompleted: false,
    });
    expect(bridge.churchProfile).toMatchObject({
      kind: "churchProfile",
      churchName: "St. John’s",
      mailingAddress: "100 Church Street",
      locationAddress: "200 Chapel Avenue",
      phone: "602-555-0100",
      email: "office@stjohns.example",
      website: "https://stjohns.example",
    });
    expect(bridge.churchProfile?.congregationName).toBeUndefined();

    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Fill this week’s content" })).toBeNull());
    expect(bridge.workspaceSettings.firstRun).toMatchObject({
      disposition: "completed",
      tourCompleted: true,
    });
  });

  it("navigates the real shell routes, saves complete settings, and passes an accessibility smoke check", async () => {
    const user = userEvent.setup();
    const bridge = new MemoryRendererBridge();
    bridge.appSettings = {
      version: 1,
      kind: "globalSettings",
      theme: "system",
      defaultLanguage: "en-US",
      viewMode: "page",
      livePreview: true,
    };
    bridge.workspaceSettings = {
      version: 1,
      kind: "workspaceSettings",
      viewMode: "contiguous",
      pagePresentation: "single",
      previewZoom: 125,
      marginGuides: false,
      livePreview: false,
      technicalPdfDetails: true,
      canvasSnap: false,
      snapGridSize: "0.25in",
      exportFilenamePattern: "Sunday {name}.pdf",
      offlineSpellcheck: false,
      displayTimeZone: "America/Phoenix",
      defaultExportFormat: "bookletTwoUp",
      previewResolution: 200,
    };
    render(
      <RendererApplication
        bridge={bridge}
        idPort={makeSequentialIdPort(50)}
        browserDemo={false}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Skip setup" }));
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("heading", { name: "Help", level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("main")));
    expect((screen.getByLabelText("Default editor view") as HTMLSelectElement).value).toBe("contiguous");
    expect((screen.getByLabelText("Page presentation") as HTMLSelectElement).value).toBe("single");
    expect((screen.getByLabelText("Default PDF zoom") as HTMLSelectElement).value).toBe("125");
    expect((screen.getByLabelText("Update PDF preview while editing") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("PDF filename pattern") as HTMLInputElement).value).toBe("Sunday {name}.pdf");
    await user.selectOptions(screen.getByLabelText("App theme"), "dark");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(bridge.appSettings).toMatchObject({
      kind: "globalSettings",
      theme: "dark",
      defaultLanguage: "en-US",
      viewMode: "page",
      livePreview: true,
    }));
    await waitFor(() => expect(bridge.workspaceSettings).toMatchObject({
      kind: "workspaceSettings",
      scope: "workspace",
      viewMode: "contiguous",
      pagePresentation: "single",
      previewZoom: 125,
      marginGuides: false,
      livePreview: false,
      technicalPdfDetails: true,
      canvasSnap: false,
      snapGridSize: "0.25in",
      exportFilenamePattern: "Sunday {name}.pdf",
      offlineSpellcheck: false,
      displayTimeZone: "America/Phoenix",
      defaultExportFormat: "bookletTwoUp",
      previewResolution: 200,
    }));

    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });

  it("persists editor-toolbar view preferences to workspace settings immediately", async () => {
    const user = userEvent.setup();
    const documentValue = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(51),
      publicationDate: "2026-07-13",
      displayName: "View preference bulletin",
    });
    const bridge = new MemoryRendererBridge([{
      localResourceId: "10000000-0000-4000-8000-000000000098",
      resourceKind: "bulletin",
      displayName: documentValue.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document: documentValue,
    }]);
    bridge.workspaceSettings = {
      ...bridge.workspaceSettings,
      viewMode: "page",
    };
    render(<RendererApplication bridge={bridge} browserDemo={false} />);

    await user.click(await screen.findByRole("button", { name: "Open bulletin" }));
    await user.click(await screen.findByRole("button", { name: "Contiguous" }));

    await waitFor(() => expect(bridge.workspaceSettings.viewMode).toBe("contiguous"));
  });

  it("focuses an opened document and restores focus to its library action on return", async () => {
    const user = userEvent.setup();
    const documentValue = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(52),
      publicationDate: "2026-07-13",
      displayName: "Focus restoration bulletin",
    });
    const localResourceId = "10000000-0000-4000-8000-000000000099";
    const bridge = new MemoryRendererBridge([{
      localResourceId,
      resourceKind: "bulletin",
      displayName: documentValue.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document: documentValue,
    }]);
    render(<RendererApplication bridge={bridge} browserDemo={false} />);

    const open = await screen.findByRole("button", { name: "Open bulletin" });
    expect(open.dataset["resourceOpenId"]).toBe(localResourceId);
    await user.click(open);
    const heading = await screen.findByRole("heading", { name: "Focus restoration bulletin", level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    await user.click(screen.getByRole("button", { name: "Back to library" }));
    const restoredOpen = await screen.findByRole("button", { name: "Open bulletin" });
    await waitFor(() => expect(document.activeElement).toBe(restoredOpen));
  });
});
