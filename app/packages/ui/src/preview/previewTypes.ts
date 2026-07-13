import type { PdfPreviewArtifactRef } from "./pdfLoader.js";

export type PdfPreviewZoom = "fitPage" | "fitWidth" | number;

export type PdfPreviewPageStatus = "ready" | "blank" | "hasFindings";

/** Optional, renderer-owned labels and review state for a PDF page. */
export interface PdfPreviewPageMetadata {
  /** One-based PDF page number. */
  readonly pageNumber: number;
  /** A short outline label, such as "Cover" or "Announcements". */
  readonly label?: string;
  readonly summary?: string;
  readonly status?: PdfPreviewPageStatus;
  readonly findingCount?: number;
}

export type PdfPreviewSourceRegion = "body" | "page-background" | "page-foreground";

/**
 * A trusted, build-specific source-to-PDF mapping.
 *
 * This is deliberately not the generated Typst line map: PDF page numbers
 * must be derived by the build pipeline after layout. Repeated content keeps
 * both its resolved occurrence id and its editable source element id.
 */
export interface PdfPreviewNavigationEntry {
  readonly resolvedId: string;
  readonly sourceElementId: string;
  /** One-based PDF page number. */
  readonly pageNumber: number;
  readonly region: PdfPreviewSourceRegion;
}

export interface PdfPreviewNavigationMap {
  readonly version: 1;
  readonly entries: readonly PdfPreviewNavigationEntry[];
}

export interface PdfPreviewArtifact extends PdfPreviewArtifactRef {
  readonly pages?: readonly PdfPreviewPageMetadata[];
  readonly navigationMap?: PdfPreviewNavigationMap;
}

/**
 * Publication state supplied by the build controller. For non-current states,
 * `artifact` is the last successfully published PDF, when one exists.
 */
export type PdfPreviewPublication =
  | {
      readonly status: "current";
      readonly artifact: PdfPreviewArtifact;
    }
  | {
      readonly status: "updating";
      readonly artifact?: PdfPreviewArtifact;
      readonly pendingBuildId?: string;
      readonly message?: string;
      /** Optional bounded diagnostic detail, shown only when the user enables it. */
      readonly technicalMessage?: string;
    }
  | {
      readonly status: "stale";
      readonly artifact?: PdfPreviewArtifact;
      readonly attemptedBuildId?: string;
      readonly message: string;
      /** Optional bounded diagnostic detail, shown only when the user enables it. */
      readonly technicalMessage?: string;
    }
  | {
      readonly status: "failed";
      readonly artifact?: PdfPreviewArtifact;
      readonly attemptedBuildId?: string;
      readonly message: string;
      /** Optional bounded diagnostic detail, shown only when the user enables it. */
      readonly technicalMessage?: string;
    };

export type PdfPreviewNavigationReason =
  | "previous"
  | "next"
  | "thumbnail"
  | "outline"
  | "keyboard"
  | "source"
  | "programmatic";

export interface PdfPreviewPageChange {
  readonly reason: PdfPreviewNavigationReason;
  readonly pageNumber: number;
  readonly sourceElementIds: readonly string[];
  readonly resolvedIds: readonly string[];
}

export interface PdfPreviewHandle {
  goToPage(pageNumber: number): boolean;
  /** Navigate to the occurrence nearest the page currently being viewed. */
  goToSource(sourceElementId: string): boolean;
  goToResolvedSource(resolvedId: string): boolean;
}

export interface PdfPreviewViewportSize {
  readonly width: number;
  readonly height: number;
}

export function pageForSource(
  map: PdfPreviewNavigationMap | undefined,
  sourceElementId: string,
  currentPage = 1,
): number | undefined {
  if (map === undefined) return undefined;
  const matches = map.entries.filter((entry) => entry.sourceElementId === sourceElementId);
  return nearestPage(matches, currentPage);
}

export function pageForResolvedSource(
  map: PdfPreviewNavigationMap | undefined,
  resolvedId: string,
  currentPage = 1,
): number | undefined {
  if (map === undefined) return undefined;
  const matches = map.entries.filter((entry) => entry.resolvedId === resolvedId);
  return nearestPage(matches, currentPage);
}

function nearestPage(
  entries: readonly PdfPreviewNavigationEntry[],
  currentPage: number,
): number | undefined {
  let nearest: PdfPreviewNavigationEntry | undefined;
  for (const entry of entries) {
    if (!validPageNumber(entry.pageNumber)) continue;
    if (
      nearest === undefined ||
      Math.abs(entry.pageNumber - currentPage) < Math.abs(nearest.pageNumber - currentPage) ||
      (
        Math.abs(entry.pageNumber - currentPage) === Math.abs(nearest.pageNumber - currentPage) &&
        entry.pageNumber < nearest.pageNumber
      )
    ) {
      nearest = entry;
    }
  }
  return nearest?.pageNumber;
}

export function validPageNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}
