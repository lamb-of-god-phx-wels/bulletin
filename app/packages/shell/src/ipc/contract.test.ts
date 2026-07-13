import { describe, expect, it } from "vitest";
import {
  M4ContractError,
  M4_IPC_LIMITS,
  assertBoundedJson,
  assertM4PreviewState,
  parseM4IpcRequest,
} from "./contract.js";

const ID = "10000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "10000000-0000-4000-8000-000000000002";
const BUILD = "20000000-0000-4000-8000-000000000001";
const ASSET_ID = "30000000-0000-4000-8000-000000000001";
const ASSET_REF = "asset:40000000-0000-4000-8000-000000000001";
const REVISION = `sha256:${"a".repeat(64)}`;

describe("M4 renderer IPC contract", () => {
  it("accepts only the closed, versioned path-free request union", () => {
    const requests = [
      { version: 1, operation: "bootstrap.read", payload: {} },
      { version: 1, operation: "workspace.chooseLocation", payload: {} },
      { version: 1, operation: "documents.list", payload: { filter: "all" } },
      { version: 1, operation: "documents.load", payload: { localResourceId: ID } },
      {
        version: 1,
        operation: "documents.save",
        payload: {
          localResourceId: ID,
          resourceKind: "bulletin",
          displayName: "Sunday Worship",
          document: { version: 1, kind: "bulletin", name: "Sunday Worship", page: { typstWidth: "8.5in", typstHeight: "11in" }, elements: [] },
          baseRevisionToken: REVISION,
        },
      },
      { version: 1, operation: "documents.saveState", payload: { localResourceId: ID, state: "dirty" } },
      { version: 1, operation: "editBuffer.read", payload: { localResourceId: ID, bufferKey: "inspector.margin.top" } },
      { version: 1, operation: "editBuffer.write", payload: { localResourceId: ID, bufferKey: "inspector.margin.top", value: "not parsed yet" } },
      { version: 1, operation: "editBuffer.delete", payload: { localResourceId: ID, bufferKey: "inspector.margin.top" } },
      { version: 1, operation: "editBuffer.saveState", payload: { localResourceId: ID, state: "pending" } },
      { version: 1, operation: "appSettings.read", payload: {} },
      { version: 1, operation: "appSettings.write", payload: { value: { version: 1, theme: "dark" } } },
      { version: 1, operation: "workspaceSettings.read", payload: {} },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            scope: "workspace",
            viewMode: "contiguous",
            pagePresentation: "facing",
            previewZoom: 125,
            marginGuides: true,
            livePreview: false,
            technicalPdfDetails: false,
            canvasSnap: true,
            snapGridSize: "0.125in",
            exportFilenamePattern: "{date:YYYY-MM-DD} {name}.pdf",
            offlineSpellcheck: true,
            displayTimeZone: "America/Phoenix",
            defaultExportFormat: "bookletTwoUp",
            previewResolution: 144,
            sourceTemplateLinks: [{
              bulletinLocalResourceId: ID,
              templateLocalResourceId: TEMPLATE_ID,
            }],
            firstRun: {
              version: 1,
              disposition: "completed",
              preferredOutput: "foldedBooklet",
              starterId: "folded-letter",
              tourCompleted: false,
              tourBulletinLocalResourceId: ID,
            },
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            firstRun: {
              version: 1,
              disposition: "inProgress",
              step: 1,
              churchName: "Lamb of God",
              mailingAddress: "2210 E. Indian School Road",
              locationAddress: "2210 E. Indian School Road",
              phone: "602-555-0100",
              email: "office@example.test",
              website: "https://example.test",
              logo: ASSET_REF,
              preferredOutput: "foldedBooklet",
              starterId: "folded-letter",
              createPracticeBulletin: true,
            },
          },
          baseRevisionToken: REVISION,
        },
      },
      { version: 1, operation: "churchProfile.read", payload: {} },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            churchName: "Lamb of God",
            mailingAddress: "2210 E. Indian School Road",
            locationAddress: "2210 E. Indian School Road",
            phone: "602-555-0100",
            email: "office@example.test",
            website: "https://example.test",
            defaultServiceLabel: "Sunday worship",
            logo: ASSET_REF,
            language: "en-US",
            defaultPublicationContexts: [
              "printedNonsalableChurchBulletin",
              "digitalNonsalableChurchBulletin",
            ],
            defaultUnknownRightsPolicy: "review",
            spellingDictionary: ["amen", "kyrie", "zion"],
            schedules: [{
              id: "50000000-0000-4000-8000-000000000001",
              label: "Sunday worship",
              enabled: true,
              dayOfWeek: 0,
            }],
          },
          baseRevisionToken: null,
        },
      },
      { version: 1, operation: "assets.images.list", payload: {} },
      { version: 1, operation: "assets.image.import", payload: {} },
      {
        version: 1,
        operation: "assets.image.read",
        payload: { localAssetId: ASSET_ID, assetRef: ASSET_REF },
      },
      { version: 1, operation: "preview.request", payload: { localResourceId: ID, requestSequence: 1 } },
      { version: 1, operation: "preview.state", payload: { localResourceId: ID } },
      { version: 1, operation: "preview.cancel", payload: { buildId: BUILD } },
      { version: 1, operation: "pdf.read", payload: { bulletinLocalResourceId: ID, buildId: BUILD } },
    ];
    for (const request of requests) {
      expect(parseM4IpcRequest(request).operation).toBe(request.operation);
    }
  });

  it("rejects extra keys, path-shaped values, wrong versions, and mismatched kinds", () => {
    const invalid = [
      { version: 2, operation: "documents.list", payload: { filter: "all" } },
      { version: 1, operation: "documents.list", payload: { filter: "all", path: "/tmp" } },
      { version: 1, operation: "documents.load", payload: { localResourceId: "../../etc/passwd" } },
      { version: 1, operation: "pdf.read", payload: { bulletinLocalResourceId: ID, buildId: "/tmp/a.pdf" } },
      {
        version: 1,
        operation: "documents.save",
        payload: {
          localResourceId: ID,
          resourceKind: "template",
          displayName: "Mismatch",
          document: { version: 1, kind: "bulletin" },
          baseRevisionToken: null,
        },
      },
      { version: 1, operation: "appSettings.read", payload: { arbitrary: true } },
      { version: 1, operation: "workspace.chooseLocation", payload: { path: "/tmp/library" } },
      { version: 1, operation: "assets.image.import", payload: { path: "/tmp/logo.png" } },
      { version: 1, operation: "documents.saveState", payload: { localResourceId: ID, state: "saved" } },
      { version: 1, operation: "editBuffer.saveState", payload: { localResourceId: ID, state: "dirty" } },
      {
        version: 1,
        operation: "assets.image.read",
        payload: { localAssetId: "/tmp/image", assetRef: ASSET_REF },
      },
      {
        version: 1,
        operation: "assets.image.read",
        payload: { localAssetId: ASSET_ID, assetRef: "file:///tmp/image.png" },
      },
      { version: 1, operation: "preview.request", payload: { localResourceId: ID, requestSequence: 0 } },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: { version: 1, kind: "workspaceSettings", storagePath: "/tmp/settings" },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            firstRun: { version: 1, disposition: "completed", step: 2, churchName: "Not a draft" },
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: { version: 1, kind: "workspaceSettings", snapGridSize: "0in" },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: { version: 1, kind: "workspaceSettings", exportFilenamePattern: "../bulletin.pdf" },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: { version: 1, kind: "workspaceSettings", previewZoom: 201 },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: { version: 1, kind: "workspaceSettings", displayTimeZone: "Not/AZone" },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            sourceTemplateLinks: [{
              bulletinLocalResourceId: ID,
              templateLocalResourceId: "/tmp/source-template",
            }],
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            sourceTemplateLinks: [
              { bulletinLocalResourceId: TEMPLATE_ID, templateLocalResourceId: ID },
              { bulletinLocalResourceId: ID, templateLocalResourceId: TEMPLATE_ID },
            ],
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            firstRun: { version: 1, disposition: "completed", starterId: "custom-starter" },
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "workspaceSettings.write",
        payload: {
          value: {
            version: 1,
            kind: "workspaceSettings",
            firstRun: { version: 1, disposition: "skipped", workspacePath: "/tmp/library" },
          },
          baseRevisionToken: REVISION,
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: { version: 1, kind: "churchProfile", congregationName: "/tmp/profile" },
          baseRevisionToken: null,
          storagePath: "/tmp/church-profile.json",
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            defaultPublicationContexts: [
              "printedNonsalableChurchBulletin",
              "printedNonsalableChurchBulletin",
            ],
          },
          baseRevisionToken: null,
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            spellingDictionary: ["zion", "amen"],
          },
          baseRevisionToken: null,
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            spellingDictionary: ["Kyrie"],
          },
          baseRevisionToken: null,
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            spellingDictionary: ["two words"],
          },
          baseRevisionToken: null,
        },
      },
      {
        version: 1,
        operation: "churchProfile.write",
        payload: {
          value: {
            version: 1,
            kind: "churchProfile",
            schedules: [{ id: "not-an-id", label: "Sunday", enabled: true }],
          },
          baseRevisionToken: null,
        },
      },
    ];
    for (const request of invalid) {
      expect(() => parseM4IpcRequest(request)).toThrow(M4ContractError);
    }
  });

  it("rejects hostile labels, keys, and one-over edit buffers", () => {
    expect(() => parseM4IpcRequest({
      version: 1,
      operation: "documents.save",
      payload: {
        localResourceId: ID,
        resourceKind: "bulletin",
        displayName: "  padded  ",
        document: { version: 1, kind: "bulletin" },
        baseRevisionToken: null,
      },
    })).toThrow(M4ContractError);
    expect(() => parseM4IpcRequest({
      version: 1,
      operation: "editBuffer.read",
      payload: { localResourceId: ID, bufferKey: "../../settings" },
    })).toThrow(M4ContractError);
    expect(() => parseM4IpcRequest({
      version: 1,
      operation: "editBuffer.write",
      payload: {
        localResourceId: ID,
        bufferKey: "field",
        value: "x".repeat(M4_IPC_LIMITS.editBufferBytes + 1),
      },
    })).toThrow(M4ContractError);
  });

  it("bounds JSON graphs independently of JSON.stringify", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => assertBoundedJson(cycle, 1024)).toThrow(M4ContractError);

    let deep: unknown = null;
    for (let index = 0; index <= M4_IPC_LIMITS.maximumJsonDepth; index += 1) deep = [deep];
    expect(() => assertBoundedJson(deep, 1024 * 1024)).toThrow(M4ContractError);
    expect(() => assertBoundedJson({ amount: Number.POSITIVE_INFINITY }, 1024)).toThrow(M4ContractError);
    expect(() => assertBoundedJson(Object.create({ inherited: true }), 1024)).toThrow(M4ContractError);
  });

  it("strictly bounds build-specific preview navigation maps", () => {
    expect(() => assertM4PreviewState({
      status: "current",
      lastSuccessfulBuildId: BUILD,
      pageCount: 2,
      navigationMap: {
        version: 1,
        entries: [{
          resolvedId: "resolved-title",
          sourceElementId: "title",
          pageNumber: 2,
          region: "body",
        }],
      },
    })).not.toThrow();
    for (const entry of [
      { resolvedId: "resolved-title", sourceElementId: "../title", pageNumber: 1, region: "body" },
      { resolvedId: "resolved-title", sourceElementId: "title", pageNumber: 3, region: "body" },
      { resolvedId: "resolved-title", sourceElementId: "title", pageNumber: 1, region: "other" },
    ]) {
      expect(() => assertM4PreviewState({
        status: "current",
        lastSuccessfulBuildId: BUILD,
        pageCount: 2,
        navigationMap: { version: 1, entries: [entry] },
      })).toThrow(M4ContractError);
    }
  });
});
