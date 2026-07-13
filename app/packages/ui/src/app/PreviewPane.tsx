import { useEffect, useRef, useState } from "react";
import { isIntentionalBlankNavigationResolvedId } from "@cbb/core";
import type { RendererBridge, RendererPreviewNavigationMap } from "../bridge/index.js";
import {
  PdfPreview,
  createBrowserPdfPreviewLoader,
  type PdfPreviewArtifact,
  type PdfPreviewLoader,
  type PdfPreviewPublication,
  type PdfPreviewZoom,
} from "../preview/index.js";

interface PreviewStateDto {
  readonly status?: string;
  readonly state?: string;
  readonly lastSuccessfulBuildId?: string;
  readonly publishedBuildId?: string;
  readonly attemptedBuildId?: string;
  readonly pageCount?: number;
  readonly navigationMap?: RendererPreviewNavigationMap;
  readonly failure?: "couldNotBuild" | "tookTooLong" | "canceled" | "outOfDate";
  readonly message?: string;
}

const unavailableLoader: PdfPreviewLoader = Object.freeze({
  async load() {
    throw new Error("A PDF has not been built for this bulletin yet.");
  },
});

function pages(
  pageCount: number | undefined,
  navigationMap: RendererPreviewNavigationMap | undefined,
) {
  if (!Number.isSafeInteger(pageCount) || pageCount === undefined || pageCount < 1 || pageCount > 10_000) {
    return undefined;
  }
  const intentionalBlanks = new Set(
    navigationMap?.entries
      .filter((entry) =>
        isIntentionalBlankNavigationResolvedId(entry.resolvedId) &&
        Number.isSafeInteger(entry.pageNumber) &&
        entry.pageNumber >= 1 && entry.pageNumber <= pageCount
      )
      .map((entry) => entry.pageNumber) ?? [],
  );
  return Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    return intentionalBlanks.has(pageNumber)
      ? {
          pageNumber,
          label: `Page ${pageNumber} — intentionally blank`,
          summary: "This compiled PDF page is intentionally blank.",
          status: "blank" as const,
        }
      : { pageNumber, label: `Page ${pageNumber}` };
  });
}

function artifact(
  localResourceId: string,
  buildId: string | undefined,
  pageCount?: number,
  navigationMap?: RendererPreviewNavigationMap,
): PdfPreviewArtifact | undefined {
  if (buildId === undefined || buildId.length === 0) return undefined;
  const metadata = pages(pageCount, navigationMap);
  return {
    bulletinLocalResourceId: localResourceId,
    buildId,
    ...(metadata === undefined ? {} : { pages: metadata }),
    ...(navigationMap === undefined ? {} : { navigationMap }),
  };
}

function failureMessage(state: PreviewStateDto, fallback: string): string {
  switch (state.failure) {
    case "couldNotBuild": return "The PDF preview could not be prepared.";
    case "tookTooLong": return "The PDF preview took too long to prepare.";
    case "canceled": return "The PDF preview was canceled.";
    case "outOfDate": return "The displayed PDF does not include every current change.";
    default: return fallback;
  }
}

function technicalMessage(state: PreviewStateDto, plainMessage: string): {
  readonly technicalMessage?: string;
} {
  const value = state.message?.trim();
  return value === undefined || value.length === 0 || value === plainMessage
    ? {}
    : { technicalMessage: value };
}

function errorTechnicalMessage(error: unknown): { readonly technicalMessage?: string } {
  return error instanceof Error && error.message.trim().length > 0
    ? { technicalMessage: error.message }
    : {};
}

function mapPublication(
  localResourceId: string,
  state: PreviewStateDto,
  previous: PdfPreviewArtifact | undefined,
): PdfPreviewPublication {
  const status = state.status ?? state.state ?? "idle";
  const successful = artifact(
    localResourceId,
    state.lastSuccessfulBuildId ?? state.publishedBuildId,
    state.pageCount,
    state.navigationMap,
  ) ?? previous;
  switch (status) {
    case "current":
    case "succeeded":
      return successful === undefined
        ? { status: "updating", message: "The first PDF preview is still being prepared." }
        : { status: "current", artifact: successful };
    case "outOfDate":
    case "stale": {
      const message = failureMessage(
        state,
        "The displayed PDF does not include every current change.",
      );
      return {
        status: "stale",
        ...(successful === undefined ? {} : { artifact: successful }),
        ...(state.attemptedBuildId === undefined ? {} : { attemptedBuildId: state.attemptedBuildId }),
        message,
        ...technicalMessage(state, message),
      };
    }
    case "failed":
    case "timedOut":
    case "canceled":
    case "unavailable":
    case "idle": {
      const message = failureMessage(state, "The PDF preview is unavailable right now.");
      return {
        status: "failed",
        ...(successful === undefined ? {} : { artifact: successful }),
        ...(state.attemptedBuildId === undefined ? {} : { attemptedBuildId: state.attemptedBuildId }),
        message,
        ...technicalMessage(state, message),
      };
    }
    case "updating":
    case "enqueued":
    case "running":
    case "queued":
    case "building":
    default: {
      const message = "The PDF preview is updating.";
      return {
        status: "updating",
        ...(successful === undefined ? {} : { artifact: successful }),
        ...(state.attemptedBuildId === undefined ? {} : { pendingBuildId: state.attemptedBuildId }),
        message,
        ...technicalMessage(state, message),
      };
    }
  }
}

export interface PreviewPaneProps {
  readonly bridge: RendererBridge;
  readonly localResourceId: string;
  readonly refreshToken: number;
  readonly enabled: boolean;
  readonly zoom: PdfPreviewZoom;
  readonly showTechnicalDetails?: boolean;
  readonly selectedSourceElementId?: string | undefined;
  readonly createLoader?: ((bridge: RendererBridge) => Promise<PdfPreviewLoader>) | undefined;
}

export function PreviewPane({
  bridge,
  localResourceId,
  refreshToken,
  enabled,
  zoom,
  showTechnicalDetails = false,
  selectedSourceElementId,
  createLoader = createBrowserPdfPreviewLoader,
}: PreviewPaneProps) {
  const sequence = useRef(0);
  const lastArtifact = useRef<PdfPreviewArtifact | undefined>(undefined);
  const [loader, setLoader] = useState<PdfPreviewLoader>();
  const loaderFailed = useRef(false);
  const [publication, setPublication] = useState<PdfPreviewPublication>({
    status: "failed",
    message: "The PDF preview is unavailable right now. You can keep editing in Page View.",
  });

  useEffect(() => {
    if (publication.artifact === undefined || loader !== undefined || loaderFailed.current) return;
    let active = true;
    void createLoader(bridge).then((next) => {
      if (active) setLoader(next);
    }).catch((error: unknown) => {
      if (active) {
        loaderFailed.current = true;
        setPublication({
          status: "failed",
          message: "The PDF viewer could not start. The editable Page View remains available.",
          ...errorTechnicalMessage(error),
        });
      }
    });
    return () => { active = false; };
  }, [bridge, createLoader, loader, publication.artifact]);

  useEffect(() => {
    if (!enabled) {
      setPublication({
        status: "stale",
        ...(lastArtifact.current === undefined ? {} : { artifact: lastArtifact.current }),
        message: "Live PDF preview is turned off in Settings.",
      });
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const requestSequence = ++sequence.current;
    setPublication({
      status: "updating",
      ...(lastArtifact.current === undefined ? {} : { artifact: lastArtifact.current }),
      message: "The PDF preview is updating.",
    });

    const poll = async (): Promise<void> => {
      if (!active) return;
      try {
        const state = await bridge.getPreviewState(localResourceId);
        if (!active || requestSequence !== sequence.current) return;
        const next = mapPublication(localResourceId, state, lastArtifact.current);
        if (next.artifact !== undefined) lastArtifact.current = next.artifact;
        setPublication(next);
        if (next.status === "updating") timer = setTimeout(() => { void poll(); }, 400);
      } catch (error) {
        if (!active) return;
        setPublication({
          status: "failed",
          ...(lastArtifact.current === undefined ? {} : { artifact: lastArtifact.current }),
          message: "The preview status could not be checked. You can keep editing in Page View.",
          ...errorTechnicalMessage(error),
        });
      }
    };

    void bridge.requestPreview({ localResourceId, requestSequence }).then(() => poll()).catch((error: unknown) => {
      if (!active) return;
      setPublication({
        status: "failed",
        ...(lastArtifact.current === undefined ? {} : { artifact: lastArtifact.current }),
        message: "The PDF preview could not be started. You can keep editing in Page View.",
        ...errorTechnicalMessage(error),
      });
    });
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [bridge, enabled, localResourceId, refreshToken]);

  return (
    <PdfPreview
      loader={loader ?? unavailableLoader}
      publication={publication.artifact !== undefined && loader === undefined
        ? {
            status: "updating",
            message: "Opening the latest successful PDF preview.",
          }
        : publication}
      initialZoom={zoom}
      showTechnicalDetails={showTechnicalDetails}
      {...(selectedSourceElementId === undefined ? {} : { selectedSourceElementId })}
    />
  );
}
