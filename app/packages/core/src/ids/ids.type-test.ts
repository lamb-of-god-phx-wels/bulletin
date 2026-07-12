/**
 * Compile-time cross-assignment tests for branded id types.
 *
 * This file uses @ts-expect-error to assert that assigning one id type to
 * another is a compile-time error.  If the branding is broken (all ids
 * accidentally reduce to the same type), TypeScript will report that
 * @ts-expect-error is "unused" — which is itself a compile error under
 * `--strict`.
 *
 * This file is NOT a vitest test file; it is included in the TypeScript
 * compilation to prove the type-system invariants.
 */

import type {
  AiExchangeId,
  BundleId,
  DocumentElementId,
  LocalResourceId,
  PortableAssetId,
  PortableAssetRef,
  PortableFontRef,
  PortableSongWorkRef,
  RightsCreditRef,
  ScriptureTranslationRef,
  WorkspaceId,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helper: accept a value only if it has the exact branded type.
// ---------------------------------------------------------------------------

function acceptWorkspaceId(_id: WorkspaceId): void { /* type check only */ }
function acceptLocalResourceId(_id: LocalResourceId): void { /* type check only */ }
function acceptPortableAssetRef(_id: PortableAssetRef): void { /* type check only */ }
function acceptPortableFontRef(_id: PortableFontRef): void { /* type check only */ }
function acceptPortableSongWorkRef(_id: PortableSongWorkRef): void { /* type check only */ }
function acceptScriptureTranslationRef(_id: ScriptureTranslationRef): void { /* type check only */ }
function acceptRightsCreditRef(_id: RightsCreditRef): void { /* type check only */ }
function acceptBundleId(_id: BundleId): void { /* type check only */ }
function acceptDocumentElementId(_id: DocumentElementId): void { /* type check only */ }
function acceptPortableAssetId(_id: PortableAssetId): void { /* type check only */ }
function acceptAiExchangeId(_id: AiExchangeId): void { /* type check only */ }

// ---------------------------------------------------------------------------
// Cross-assignment is a compile error.
// ---------------------------------------------------------------------------

declare const ws: WorkspaceId;
declare const lr: LocalResourceId;
declare const par: PortableAssetRef;
declare const pfr: PortableFontRef;
declare const pswr: PortableSongWorkRef;
declare const str: ScriptureTranslationRef;
declare const rcr: RightsCreditRef;
declare const bid: BundleId;
declare const dei: DocumentElementId;
declare const pai: PortableAssetId;
declare const aei: AiExchangeId;
declare const plainStr: string;

// WorkspaceId cannot be used where LocalResourceId is expected.
// @ts-expect-error WorkspaceId is not LocalResourceId
acceptLocalResourceId(ws);

// LocalResourceId cannot be used where WorkspaceId is expected.
// @ts-expect-error LocalResourceId is not WorkspaceId
acceptWorkspaceId(lr);

// PortableAssetRef cannot be used where PortableFontRef is expected.
// @ts-expect-error PortableAssetRef is not PortableFontRef
acceptPortableFontRef(par);

// PortableFontRef cannot be used where PortableAssetRef is expected.
// @ts-expect-error PortableFontRef is not PortableAssetRef
acceptPortableAssetRef(pfr);

// PortableSongWorkRef cannot be used where ScriptureTranslationRef is expected.
// @ts-expect-error PortableSongWorkRef is not ScriptureTranslationRef
acceptScriptureTranslationRef(pswr);

// ScriptureTranslationRef cannot be used where RightsCreditRef is expected.
// @ts-expect-error ScriptureTranslationRef is not RightsCreditRef
acceptRightsCreditRef(str);

// RightsCreditRef cannot be used where PortableSongWorkRef is expected.
// @ts-expect-error RightsCreditRef is not PortableSongWorkRef
acceptPortableSongWorkRef(rcr);

// BundleId cannot be used where WorkspaceId is expected.
// @ts-expect-error BundleId is not WorkspaceId
acceptWorkspaceId(bid);

// DocumentElementId cannot be used where BundleId is expected.
// @ts-expect-error DocumentElementId is not BundleId
acceptBundleId(dei);

// PortableAssetId (bare UUID) cannot be used where PortableAssetRef is expected.
// @ts-expect-error PortableAssetId is not PortableAssetRef
acceptPortableAssetRef(pai);

// PortableAssetRef cannot be used where PortableAssetId is expected.
// @ts-expect-error PortableAssetRef is not PortableAssetId
acceptPortableAssetId(par);

// AiExchangeId cannot be used where DocumentElementId is expected.
// @ts-expect-error AiExchangeId is not DocumentElementId
acceptDocumentElementId(aei);

// Plain string cannot be used where any branded id is expected.
// @ts-expect-error string is not WorkspaceId
acceptWorkspaceId(plainStr);

// @ts-expect-error string is not LocalResourceId
acceptLocalResourceId(plainStr);

// @ts-expect-error string is not PortableAssetRef
acceptPortableAssetRef(plainStr);

// @ts-expect-error string is not AiExchangeId
acceptAiExchangeId(plainStr);
