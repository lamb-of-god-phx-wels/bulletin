// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeSequentialIdPort,
  validateDocumentSemantics,
  type CbbDocument,
} from "@cbb/core";
import { findStarter } from "../onboarding/index.js";
import { DEFAULT_UI_SETTINGS } from "../settings/index.js";
import {
  customInstanceFixture,
  finalizedCustomDefinitionFixture,
} from "../store/testFixtures.js";
import { DocumentWorkspace } from "./DocumentWorkspace.js";
import {
  createBulletinFromStarter,
  createBulletinFromTemplateDocument,
} from "./documentFactory.js";
import { MemoryRendererBridge } from "./testBridge.js";

afterEach(() => cleanup());

describe("DocumentWorkspace renderer integration", () => {
  it("persists canonical spelling words in Church Profile and reloads them for later editor sessions", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000029";
    const bulletinDocument: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Spelling bulletin",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [{
        id: "spelling-text",
        type: "text",
        name: "Spelling text",
        data: { content: { kind: "plain", text: "Kyrie eleison" } },
      }],
    };
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: bulletinDocument.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document: bulletinDocument,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const props = {
      bridge,
      workspaceAccess: "readWrite" as const,
      loaded,
      settings: DEFAULT_UI_SETTINGS,
      idPort: makeSequentialIdPort(80),
      onBack: () => undefined,
      onCreateResource: async () => undefined,
      onViewSettingsChange: () => undefined,
    };
    const first = render(<DocumentWorkspace {...props} />);
    const direct = (await screen.findAllByLabelText(/Editable text\. Press Enter or F2/u))[0];
    if (direct === undefined) throw new Error("Expected editable text");
    fireEvent.keyDown(direct, { key: "F2" });
    const editor = screen.getByRole("textbox", { name: "Text content" });
    const node = editor.firstChild;
    if (node?.nodeType !== Node.TEXT_NODE) throw new Error("Expected plain text node");
    const range = window.document.createRange();
    range.setStart(node, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(screen.getByRole("button", { name: "Word review" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Church Profile dictionary" }));
    await waitFor(() => expect(bridge.churchProfile?.spellingDictionary).toEqual(["kyrie"]));

    first.unmount();
    const second = render(<DocumentWorkspace {...props} idPort={makeSequentialIdPort(81)} />);
    const reopened = (await screen.findAllByLabelText(/Editable text\. Press Enter or F2/u))[0];
    if (reopened === undefined) throw new Error("Expected reopened text");
    fireEvent.keyDown(reopened, { key: "F2" });
    await waitFor(() => expect(second.container.querySelectorAll("[data-cbb-spelling-exclusion='kyrie']")).toHaveLength(1));
  });

  it("restores buffers before mounting, persists invalid text, and immediately autosaves a valid edit", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000030";
    const protectedDocument = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(91),
      publicationDate: "2026-07-13",
      displayName: "Practice bulletin",
    });
    const { authoringPolicy: _authoringPolicy, ...document } = protectedDocument;
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(90)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    await screen.findByRole("button", { name: "Customize Layout" });
    await waitFor(() => expect(window.document.activeElement).toBe(
      screen.getByRole("heading", { name: "Practice bulletin", level: 1 }),
    ));
    fireEvent.click(screen.getByRole("button", { name: "Customize Layout" }));
    const width = screen.getByLabelText("Width");
    fireEvent.change(width, { target: { value: "not a length" } });
    fireEvent.blur(width);
    expect(await screen.findByText(/Use a physical length/u)).toBeTruthy();
    await waitFor(() => expect(bridge.buffers.size).toBe(2));

    fireEvent.change(width, { target: { value: "8in" } });
    fireEvent.blur(width);
    await waitFor(() => expect(bridge.saveCount).toBe(1));
    await waitFor(() => expect(bridge.saveStates.map((entry) => entry.state)).toEqual(
      expect.arrayContaining(["dirty", "saving", "clean"]),
    ));
    await waitFor(() => expect(bridge.buffers.size).toBe(0));
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(screen.getByText("The PDF preview is unavailable right now.")).toBeTruthy();
    expect(screen.queryByText(/test library/u)).toBeNull();
  });

  it("keeps the editor open and visibly reports a failed final autosave", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000035";
    const protectedDocument = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(111),
      publicationDate: "2026-07-13",
      displayName: "Conflicted bulletin",
    });
    const { authoringPolicy: _authoringPolicy, ...document } = protectedDocument;
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    vi.spyOn(bridge, "saveDocument").mockResolvedValue({
      status: "conflicted",
      message: "The saved bulletin changed elsewhere.",
    });
    const onBack = vi.fn();
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(110)}
        onBack={onBack}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    const width = screen.getByLabelText("Width");
    fireEvent.change(width, { target: { value: "8in" } });
    fireEvent.blur(width);
    await screen.findByText("The saved bulletin changed elsewhere.", { selector: ".cbb-save-status" });

    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));

    await waitFor(() => expect(onBack).not.toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Conflicted bulletin", level: 1 })).toBeTruthy();
    const leaveAlert = await screen.findByText(
      "Your changes are still open here. The saved bulletin changed elsewhere.",
      { selector: "p[role='alert']" },
    );
    expect(leaveAlert).toBeTruthy();
    expect((screen.getByRole("button", { name: "Back to library" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("renders a visibly read-only workspace with no document mutation controls", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000031";
    const document = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(121),
      publicationDate: "2026-07-13",
      displayName: "Locked bulletin",
    });
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const { container } = render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readOnly"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(120)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
      />,
    );

    expect(await screen.findByText(/open read-only/u)).toBeTruthy();
    await waitFor(() => expect(window.document.activeElement).toBe(
      screen.getByRole("heading", { name: "Locked bulletin", level: 1 }),
    ));
    expect(screen.getByText("Read-only", { selector: ".cbb-mode-badge" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customize Layout" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to library" })).toBeTruthy();
    expect(bridge.saveCount).toBe(0);
    expect(bridge.buffers.size).toBe(0);
    expect(bridge.saveStates).toEqual([]);
    const report = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(report.violations).toEqual([]);
  });

  it("imports and inserts the first managed image from an empty library", async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:cbb-imported") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    try {
    const localResourceId = "10000000-0000-4000-8000-000000000033";
    const document = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(136),
      publicationDate: "2026-07-13",
      displayName: "No-image bulletin",
    });
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const imported = {
      localAssetId: "30000000-0000-4000-8000-000000000033",
      assetRef: "asset:40000000-0000-4000-8000-000000000033",
      displayName: "Imported logo",
      mediaType: "image/png" as const,
      byteSize: 8,
      pixelWidth: 640,
      pixelHeight: 480,
      importedAt: "2026-07-13T05:00:00.000Z",
    };
    bridge.importImageAsset = vi.fn(async () => {
      bridge.imageAssets.push(imported);
      bridge.imageAssetBytes.set(imported.assetRef, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      return { status: "imported" as const, asset: imported };
    });

    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(135)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    fireEvent.click(screen.getByLabelText("Protect layout"));
    const imageButton = screen.getByRole("button", { name: "Image" });
    expect((imageButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(imageButton);
    expect(await screen.findByText("No validated images are installed yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import image" }));
    await waitFor(() => expect(bridge.importImageAsset).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose an installed image" })).toBeNull());
    expect(await screen.findByText("New image added")).toBeTruthy();
    await waitFor(() => expect(bridge.saveCount).toBeGreaterThan(0));
    expect(bridge.records.get(localResourceId)?.document.elements.some((element) =>
      element.type === "image" && element.data.assetRef === imported.assetRef
    )).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Choose an installed image" })).toBeNull();
    } finally {
      if (originalCreate === undefined) delete (URL as { createObjectURL?: unknown }).createObjectURL;
      else Object.defineProperty(URL, "createObjectURL", originalCreate);
      if (originalRevoke === undefined) delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      else Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    }
  });

  it("displays validated image bytes and replaces the immutable asset reference through the chooser", async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:cbb-first")
      .mockReturnValueOnce("blob:cbb-replacement");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    try {
      const localResourceId = "10000000-0000-4000-8000-000000000032";
      const firstRef = "asset:40000000-0000-4000-8000-000000000041";
      const replacementRef = "asset:40000000-0000-4000-8000-000000000042";
      const document: CbbDocument = {
        version: 2,
        kind: "bulletin",
        name: "Image bulletin",
        page: {
          typstWidth: "8.5in",
          typstHeight: "11in",
          margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
        },
        fieldContract: {
          id: "00000000-0000-4000-8000-000000000043",
          version: 1,
          name: "Image crop fields",
          fields: [
            { id: "imageFocalX", label: "Image focal X", type: "number", required: false },
            { id: "imageFocalY", label: "Image focal Y", type: "number", required: false },
          ],
        },
        fieldValues: {
          imageFocalX: { value: 0.27, origin: "imported" },
          imageFocalY: { value: 0.73, origin: "imported" },
        },
        elements: [{
          id: "church-photo",
          type: "image",
          name: "Church photo",
          width: "4in",
          height: "2in",
          data: {
            assetRef: firstRef,
            fit: "cover",
            focalPoint: { x: 0.15, y: 0.85 },
            alt: "Church exterior",
            decorative: false,
          },
          bindings: [
            {
              id: "image-focal-x-binding",
              scope: "document",
              fieldId: "imageFocalX",
              target: "/data/focalPoint/x",
            },
            {
              id: "image-focal-y-binding",
              scope: "document",
              fieldId: "imageFocalY",
              target: "/data/focalPoint/y",
            },
          ],
        }],
      };
      const loaded = {
        localResourceId,
        resourceKind: "bulletin" as const,
        displayName: document.name,
        modifiedAt: "2026-07-13T05:00:00.000Z",
        revisionToken: `sha256:${"0".repeat(64)}`,
        document,
      };
      const bridge = new MemoryRendererBridge([loaded]);
      bridge.imageAssets.push(
        {
          localAssetId: "30000000-0000-4000-8000-000000000041",
          assetRef: firstRef,
          displayName: "Original church photo",
          mediaType: "image/png",
          byteSize: 4,
          pixelWidth: 1200,
          pixelHeight: 600,
          importedAt: "2026-07-13T05:00:00.000Z",
        },
        {
          localAssetId: "30000000-0000-4000-8000-000000000042",
          assetRef: replacementRef,
          displayName: "Replacement church photo",
          mediaType: "image/png",
          byteSize: 4,
          pixelWidth: 1600,
          pixelHeight: 800,
          importedAt: "2026-07-13T05:01:00.000Z",
        },
      );
      bridge.imageAssetBytes.set(firstRef, new Uint8Array([137, 80, 78, 71]));
      bridge.imageAssetBytes.set(replacementRef, new Uint8Array([137, 80, 78, 72]));

      render(
        <DocumentWorkspace
          bridge={bridge}
          workspaceAccess="readWrite"
          loaded={loaded}
          settings={DEFAULT_UI_SETTINGS}
          idPort={makeSequentialIdPort(150)}
          onBack={() => undefined}
          onCreateResource={async () => undefined}
          onViewSettingsChange={() => undefined}
          confirmAction={() => true}
        />,
      );

      const image = await screen.findByRole("img", { name: "Church exterior" });
      expect(image.getAttribute("src")).toBe("blob:cbb-first");
      fireEvent.click(image);
      fireEvent.click(await screen.findByRole("button", { name: "Replace image" }));
      expect(await screen.findByRole("dialog", { name: "Choose an installed image" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Replacement church photo/u }));

      const review = await screen.findByRole("dialog", { name: "Review replacement image" });
      expect(screen.getByRole("img", { name: "Replacement image crop preview" })).toBeTruthy();
      expect((screen.getByRole("radio", { name: "Start this image at the center" }) as HTMLInputElement).checked)
        .toBe(true);
      expect(screen.getByText("Current description: Church exterior")).toBeTruthy();
      expect(bridge.records.get(localResourceId)?.document.elements[0]).toMatchObject({
        data: { assetRef: firstRef, focalPoint: { x: 0.15, y: 0.85 } },
      });
      fireEvent.click(screen.getByRole("radio", { name: "Keep current crop point" }));
      fireEvent.click(screen.getByRole("button", { name: "Apply replacement" }));
      await waitFor(() => expect(review.isConnected).toBe(false));

      await waitFor(() => {
        const saved = bridge.records.get(localResourceId)?.document.elements[0];
        expect(saved?.type === "image" ? saved.data.assetRef : undefined).toBe(replacementRef);
        expect(saved?.type === "image" ? saved.data.focalPoint : undefined).toBeUndefined();
        expect(saved?.type === "image" ? saved.data.alt : undefined).toBe("Church exterior");
        expect(bridge.records.get(localResourceId)?.document.fieldValues).toMatchObject({
          imageFocalX: { value: 0.27, origin: "manual" },
          imageFocalY: { value: 0.73, origin: "manual" },
        });
      });
      expect(screen.getByText("Image replaced. Review its description for accuracy.")).toBeTruthy();
      expect((await screen.findByRole("img", { name: "Church exterior" })).getAttribute("src"))
        .toBe("blob:cbb-replacement");
      expect(screen.queryByRole("dialog", { name: "Choose an installed image" })).toBeNull();
      expect(createObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      cleanup();
      if (originalCreate === undefined) delete (URL as { createObjectURL?: unknown }).createObjectURL;
      else Object.defineProperty(URL, "createObjectURL", originalCreate);
      if (originalRevoke === undefined) delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      else Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    }
  });

  it("reviews bulletin-specific values before saving a reusable template", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000033";
    const createdBulletin = createBulletinFromStarter({
      starterId: "simple-service",
      idPort: makeSequentialIdPort(181),
      publicationDate: "2026-07-13",
      displayName: "Template review bulletin",
    });
    const document: CbbDocument = {
      ...createdBulletin,
      fieldValues: {
        ...createdBulletin.fieldValues,
        serviceName: { value: "Weekly gathering", origin: "manual" },
      },
    };
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const creations: Array<{ readonly document: CbbDocument; readonly kind: "bulletin" | "template" }> = [];
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(180)}
        onBack={() => undefined}
        onCreateResource={async (created, kind) => {
          creations.push({ document: created, kind });
          return undefined;
        }}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this bulletin as a template" }));

    expect(await screen.findByRole("dialog", { name: "Review weekly values" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Use Service or gathering title in the template as"), {
      target: { value: "default" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(creations).toHaveLength(1));
    expect(creations[0]?.kind).toBe("template");
    expect(creations[0]?.document.kind).toBe("template");
    expect(creations[0]?.document.fieldContract?.fields.find((field) => field.id === "serviceName")?.default)
      .toBe("Weekly gathering");
    expect(creations[0]?.document.sampleFieldValues).toBeUndefined();
  });

  it("reviews a shared Saved Section field once and clears every conflicting copy", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000036";
    const definition = finalizedCustomDefinitionFixture({
      version: 1,
      kind: "customElementDefinition",
      id: "sharedWorkspaceNotice",
      name: "Shared notice",
      fieldContract: {
        id: "96000000-0000-4000-8000-000000000001",
        version: 4,
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
      elements: [{
        id: "sharedWorkspaceNoticeText",
        type: "text",
        name: "Notice text",
        data: { content: { kind: "plain", text: "Fallback" } },
      }],
    });
    const document: CbbDocument = {
      version: 2,
      kind: "bulletin",
      name: "Shared Saved Section bulletin",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      customElementDefinitions: [definition],
      elements: ["First", "Second"].map((value, index) => customInstanceFixture(definition, {
        id: `workspaceNotice${index}`,
        type: "customInstance",
        name: `${value} notice`,
        fieldValues: { message: { value, origin: "manual" } },
      })),
    };
    const loaded = {
      localResourceId,
      resourceKind: "bulletin" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const creations: CbbDocument[] = [];
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(190)}
        onBack={() => undefined}
        onCreateResource={async (created) => {
          creations.push(created);
          return undefined;
        }}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save this bulletin as a template" }));

    expect(await screen.findByText("2 inserted copies have different current values.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(creations).toHaveLength(1));
    const template = creations[0];
    const reviewedDefinition = template?.customElementDefinitions?.[0];
    expect(reviewedDefinition?.fieldContract.version).toBe(5);
    expect(reviewedDefinition?.fieldContract.fields[0]?.default).toBeUndefined();
    expect(reviewedDefinition?.fieldContract.fields[0]?.profileKey).toBeUndefined();
    expect(reviewedDefinition?.sampleFieldValues).toBeUndefined();
    expect(template?.elements.every((element) =>
      element.type === "customInstance" && element.fieldValues === undefined)).toBe(true);
    expect(template === undefined ? undefined : validateDocumentSemantics(template))
      .toEqual({ valid: true, findings: [] });
  });

  it("reviews every source-template change and saves only a new template revision", async () => {
    const templateLocalResourceId = "10000000-0000-4000-8000-000000000093";
    const bulletinLocalResourceId = "10000000-0000-4000-8000-000000000094";
    const siblingLocalResourceId = "10000000-0000-4000-8000-000000000095";
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Source template",
      metadata: { title: "Source template" },
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      fieldContract: {
        id: "97000000-0000-4000-8000-000000000001",
        version: 1,
        name: "Weekly fields",
        fields: [{
          id: "serviceName",
          label: "Service name",
          type: "text",
          required: false,
        }],
      },
      sampleFieldValues: {
        serviceName: { value: "Old source sample", origin: "manual" },
      },
      elements: [{
        id: "source-text",
        type: "text",
        name: "Welcome",
        data: { content: { kind: "plain", text: "Welcome" } },
      }],
    };
    const created = createBulletinFromTemplateDocument(source, {
      idPort: makeSequentialIdPort(221),
      displayName: "Linked bulletin",
      publicationDate: "2026-07-13",
    });
    const createdText = created.elements[0];
    if (createdText?.type !== "text") throw new Error("Expected copied welcome text");
    const bulletin: CbbDocument = {
      ...created,
      authoringPolicy: { layoutLocked: true },
      fieldValues: {
        ...created.fieldValues,
        serviceName: { value: "This week only", origin: "manual" },
      },
      elements: [{
        ...createdText,
        data: { content: { kind: "plain", text: "A reviewed welcome" } },
      }],
    };
    const sibling = { ...bulletin, name: "Existing sibling bulletin" };
    const loaded = {
      localResourceId: bulletinLocalResourceId,
      resourceKind: "bulletin" as const,
      displayName: bulletin.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"2".repeat(64)}`,
      document: bulletin,
    };
    const bridge = new MemoryRendererBridge([
      {
        localResourceId: templateLocalResourceId,
        resourceKind: "template",
        displayName: source.name,
        modifiedAt: "2026-07-13T05:00:00.000Z",
        revisionToken: `sha256:${"1".repeat(64)}`,
        document: source,
      },
      loaded,
      {
        localResourceId: siblingLocalResourceId,
        resourceKind: "bulletin",
        displayName: sibling.name,
        modifiedAt: "2026-07-13T05:00:00.000Z",
        revisionToken: `sha256:${"3".repeat(64)}`,
        document: sibling,
      },
    ]);

    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(220)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        sourceTemplateLocalResourceId={templateLocalResourceId}
        onOpenSourceTemplate={async () => undefined}
        onChangeOnlyThisBulletin={async () => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes for the source template" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue to change review" }));

    const sourceReviewDialog = await screen.findByRole("dialog", { name: "Review source template changes" });
    expect(sourceReviewDialog).toBeTruthy();
    expect(screen.getByText("Changed bulletin flow and content.")).toBeTruthy();
    expect(screen.getByText("Changed lock policy for “Whole template”.")).toBeTruthy();
    expect(screen.getByText(/every other existing bulletin stay unchanged/u)).toBeTruthy();
    expect((await axe.run(sourceReviewDialog, {
      rules: { "color-contrast": { enabled: false } },
    })).violations).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Update template for future bulletins" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review source template changes" })).toBeNull());

    const updatedSource = bridge.records.get(templateLocalResourceId)?.document;
    expect(updatedSource?.kind).toBe("template");
    expect(updatedSource?.authoringPolicy).toEqual({ layoutLocked: true });
    expect(updatedSource?.elements[0]?.type === "text"
      ? updatedSource.elements[0].data.content
      : undefined).toEqual({ kind: "plain", text: "A reviewed welcome" });
    expect(updatedSource?.sampleFieldValues).toBeUndefined();
    expect(bridge.records.get(bulletinLocalResourceId)?.document).toEqual(bulletin);
    expect(bridge.records.get(siblingLocalResourceId)?.document).toEqual(sibling);
    expect(await screen.findByText(/new saved revision for future bulletins/u)).toBeTruthy();
  });

  it("keeps a reviewed source update open when optimistic concurrency detects a conflict", async () => {
    const templateLocalResourceId = "10000000-0000-4000-8000-000000000096";
    const bulletinLocalResourceId = "10000000-0000-4000-8000-000000000097";
    const source: CbbDocument = {
      version: 2,
      kind: "template",
      name: "Conflicted source",
      page: { typstWidth: "8.5in", typstHeight: "11in" },
      elements: [],
    };
    const bulletin: CbbDocument = {
      ...createBulletinFromTemplateDocument(source, {
        idPort: makeSequentialIdPort(231),
        displayName: "Changed bulletin",
      }),
      authoringPolicy: { contentLocked: true },
    };
    const loaded = {
      localResourceId: bulletinLocalResourceId,
      resourceKind: "bulletin" as const,
      displayName: bulletin.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"2".repeat(64)}`,
      document: bulletin,
    };
    class ConflictingTemplateBridge extends MemoryRendererBridge {
      override async saveDocument(input: Parameters<MemoryRendererBridge["saveDocument"]>[0]) {
        if (input.localResourceId === templateLocalResourceId) {
          return { status: "conflicted" as const, message: "The item changed elsewhere." };
        }
        return super.saveDocument(input);
      }
    }
    const bridge = new ConflictingTemplateBridge([{
      localResourceId: templateLocalResourceId,
      resourceKind: "template",
      displayName: source.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"1".repeat(64)}`,
      document: source,
    }, loaded]);

    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(230)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        sourceTemplateLocalResourceId={templateLocalResourceId}
        onOpenSourceTemplate={async () => undefined}
        onChangeOnlyThisBulletin={async () => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Customize Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Review changes for the source template" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue to change review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Update template for future bulletins" }));

    expect((await screen.findByText(/changed while you were reviewing.*not overwritten/u)).textContent)
      .toMatch(/changed while you were reviewing.*not overwritten/u);
    expect(screen.getByRole("dialog", { name: "Review source template changes" })).toBeTruthy();
    expect(bridge.records.get(templateLocalResourceId)?.document).toEqual(source);
  });

  it("tests the weekly workflow in a disposable sandbox without creating a library bulletin", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000034";
    const document = findStarter("simple-service").document;
    const loaded = {
      localResourceId,
      resourceKind: "template" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    const createResource = vi.fn(async () => undefined);
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(210)}
        onBack={() => undefined}
        onCreateResource={createResource}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Test weekly workflow" }));

    expect(await screen.findByRole("heading", { name: "Test weekly workflow", level: 1 })).toBeTruthy();
    expect(screen.getByText("Test mode — changes are discarded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset test values" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit test" }));

    expect(await screen.findByRole("heading", { name: document.name, level: 1 })).toBeTruthy();
    expect(createResource).not.toHaveBeenCalled();
    expect(bridge.records.size).toBe(1);
  });

  it("reviews and applies sandbox authoring changes without importing test values", async () => {
    const localResourceId = "10000000-0000-4000-8000-000000000035";
    const document = findStarter("simple-service").document;
    const loaded = {
      localResourceId,
      resourceKind: "template" as const,
      displayName: document.name,
      modifiedAt: "2026-07-13T05:00:00.000Z",
      revisionToken: `sha256:${"0".repeat(64)}`,
      document,
    };
    const bridge = new MemoryRendererBridge([loaded]);
    render(
      <DocumentWorkspace
        bridge={bridge}
        workspaceAccess="readWrite"
        loaded={loaded}
        settings={DEFAULT_UI_SETTINGS}
        idPort={makeSequentialIdPort(230)}
        onBack={() => undefined}
        onCreateResource={async () => undefined}
        onViewSettingsChange={() => undefined}
        confirmAction={() => true}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Template tools" }));
    fireEvent.click(screen.getByRole("tab", { name: "Template actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Test weekly workflow" }));
    expect(await screen.findByRole("heading", { name: "Test weekly workflow", level: 1 })).toBeTruthy();
    const review = screen.getByRole("button", { name: "Review authoring changes" }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);

    const testValue = screen.getByLabelText("Service or gathering title (required)");
    fireEvent.change(testValue, { target: { value: "Disposable festival title" } });
    fireEvent.click(screen.getByRole("button", { name: "Customize Layout" }));
    expect(screen.getByRole("button", { name: "Customize Layout" }).getAttribute("aria-pressed"))
      .toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Page setup" }));
    fireEvent.click(screen.getByRole("tab", { name: "Accessibility" }));
    fireEvent.click(screen.getByLabelText("Protect layout"));
    fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
    const pageSize = screen.getByLabelText("Common size") as HTMLSelectElement;
    expect(pageSize.disabled).toBe(false);
    fireEvent.change(pageSize, { target: { value: "a4" } });
    await waitFor(() => expect((screen.getByLabelText("Width") as HTMLInputElement).value)
      .toBe("210mm"));
    await waitFor(() => expect((screen.getByRole(
      "button",
      { name: "Review authoring changes" },
    ) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Review authoring changes" }));
    const dialog = screen.getByRole("dialog", { name: "Review authoring changes" });
    expect(dialog.textContent).toMatch(/Only these template-authoring changes/u);
    expect(dialog.textContent).toMatch(/Page setup/u);
    expect(dialog.textContent).toMatch(/Test bulletin values and review state are always excluded/u);
    fireEvent.click(screen.getByRole("button", { name: "Apply changes to template" }));

    expect(await screen.findByRole("heading", { name: document.name, level: 1 })).toBeTruthy();
    expect(screen.getByText(/authoring changes applied.*test values.*discarded/iu)).toBeTruthy();
    await waitFor(() => {
      const saved = bridge.records.get(localResourceId)?.document;
      expect(saved?.page).toMatchObject({ typstWidth: "210mm", typstHeight: "297mm" });
      expect(saved?.fieldValues).toBeUndefined();
      expect(saved?.sampleFieldValues).toEqual(document.sampleFieldValues);
    });
  });
});
