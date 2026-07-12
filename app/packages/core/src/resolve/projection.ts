import type {
  CbbDocument,
  PageSetup,
  ScripturePresentationSettings,
} from "../document/types.js";
import type {
  EffectiveScripturePresentation,
  ProjectedElement,
  ProjectedPageElement,
  RenderPageProjection,
  RenderProjection,
  ResolvedElement,
  ResolvedInline,
  ResolvedPageElement,
  ResolvedRenderTree,
  ResolvedRichTextBlock,
  ResolvedRichTextDocument,
  ResolvedRightsContribution,
  ResolvedTextContent,
} from "../document/resolvedTypes.js";
import type { ImageElementData, StyleObject } from "../document/types.js";

/**
 * Materialize the v1 visual defaults at the render-projection boundary.
 *
 * Persisted JSON intentionally permits these fields to be omitted.  The
 * render projection does not: an omitted default and the same explicit value
 * must hash and render identically.
 */
export function materializeResolvedStyle(
  style: Omit<StyleObject, "font"> | undefined,
): Omit<StyleObject, "font"> {
  const rawBorderWidth = style?.borderWidth ?? 0;
  const borderIsZero =
    rawBorderWidth === 0 ||
    (typeof rawBorderWidth === "string" &&
      /^0(?:\.0+)?(?:pt|in|cm|mm|em)$/.test(rawBorderWidth));
  const borderWidth = borderIsZero ? 0 : rawBorderWidth;
  return {
    ...(style?.fontRef !== undefined ? { fontRef: style.fontRef } : {}),
    fontSize: style?.fontSize ?? 11,
    fontWeight: style?.fontWeight ?? "regular",
    fontStyle: style?.fontStyle ?? "normal",
    color: style?.color ?? "#251d18",
    background: style?.background ?? "transparent",
    // Stroke color cannot affect output while the effective stroke is zero.
    borderColor: borderIsZero ? "#d8cdbd" : style?.borderColor ?? "#d8cdbd",
    borderWidth,
    align: style?.align ?? "left",
    verticalAlign: style?.verticalAlign ?? "top",
  };
}

function projectImageData(data: ImageElementData): ImageElementData {
  return {
    assetRef: data.assetRef,
    fit: data.fit,
    // Focal point is output-inert for contain. For cover, the documented
    // center default is made explicit so omitted/explicit defaults coincide.
    ...(data.fit === "cover"
      ? { focalPoint: data.focalPoint ?? { x: 0.5, y: 0.5 } }
      : {}),
    ...(data.alt !== undefined ? { alt: data.alt } : {}),
    decorative: data.decorative ?? false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

export function effectiveScripturePresentation(
  settings: ScripturePresentationSettings | undefined,
): EffectiveScripturePresentation {
  return {
    referencePlacement: settings?.referencePlacement ?? "before",
    verseNumberStyle: settings?.verseNumberStyle ?? "superscript",
    paragraphPolicy: settings?.paragraphPolicy ?? "publisher",
    paragraphSpacing: settings?.paragraphSpacing ?? "6pt",
    translationLabelPlacement:
      settings?.translationLabelPlacement ?? "withReference",
    ...(settings?.typographyPresetSnapshot !== undefined
      ? { typographyPresetSnapshot: settings.typographyPresetSnapshot }
      : {}),
  };
}

function presentationFromOverride(
  value: unknown,
  inherited: EffectiveScripturePresentation,
): EffectiveScripturePresentation {
  if (!isRecord(value)) return inherited;
  const referencePlacement = value.referencePlacement;
  const verseNumberStyle = value.verseNumberStyle;
  const paragraphPolicy = value.paragraphPolicy;
  const paragraphSpacing = value.paragraphSpacing;
  const translationLabelPlacement = value.translationLabelPlacement;
  if (
    (referencePlacement !== "before" && referencePlacement !== "after") ||
    !["inline", "superscript", "hidden"].includes(String(verseNumberStyle)) ||
    (paragraphPolicy !== "publisher" && paragraphPolicy !== "oneVerse") ||
    typeof paragraphSpacing !== "string" ||
    !["withReference", "afterPassage", "hidden"].includes(
      String(translationLabelPlacement),
    )
  ) {
    return inherited;
  }
  return {
    referencePlacement,
    verseNumberStyle: verseNumberStyle as EffectiveScripturePresentation["verseNumberStyle"],
    paragraphPolicy,
    paragraphSpacing,
    translationLabelPlacement:
      translationLabelPlacement as EffectiveScripturePresentation["translationLabelPlacement"],
    ...(isRecord(value.typographyPresetSnapshot)
      ? { typographyPresetSnapshot: value.typographyPresetSnapshot }
      : {}),
  };
}

function resolveInline(value: unknown): ResolvedInline | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "lineBreak") return { type: "lineBreak" };
  if (value.type !== "text" || typeof value.text !== "string") return undefined;
  const marks = Array.isArray(value.marks)
    ? value.marks.filter(
        (mark): mark is "strong" | "emphasis" =>
          mark === "strong" || mark === "emphasis",
      )
    : undefined;
  return {
    type: "text",
    text: value.text,
    ...(marks !== undefined && marks.length > 0 ? { marks } : {}),
  };
}

function sanitizeRightsContribution(
  value: unknown,
  firstAppearance: number,
  governedTextRendered: boolean,
): ResolvedRightsContribution | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.creditKey !== "string" ||
    typeof value.creditProjectionHash !== "string" ||
    ![
      "text",
      "tune",
      "arrangement",
      "translation",
      "setting",
      "recording",
      "scriptureTranslation",
      "other",
    ].includes(String(value.component)) ||
    !["copyrighted", "publicDomain", "unknown"].includes(String(value.status)) ||
    !["always", "renderedText", "never"].includes(String(value.creditRequiredWhen))
  ) {
    return undefined;
  }
  const license = isRecord(value.publicationLicenseDisplay)
    ? value.publicationLicenseDisplay
    : undefined;
  const usagePolicy = isRecord(value.usagePolicySnapshot)
    ? value.usagePolicySnapshot
    : undefined;
  return {
    firstAppearance,
    creditKey: value.creditKey,
    creditProjectionHash: value.creditProjectionHash,
    component: value.component as ResolvedRightsContribution["component"],
    status: value.status as ResolvedRightsContribution["status"],
    ...(value.status === "publicDomain" && optionalString(value, "workTitle") !== undefined
      ? { workTitle: optionalString(value, "workTitle") as string }
      : {}),
    creditRequiredWhen:
      value.creditRequiredWhen as ResolvedRightsContribution["creditRequiredWhen"],
    requiredCreditLineApplies:
      value.creditRequiredWhen === "always" ||
      (value.creditRequiredWhen === "renderedText" && governedTextRendered),
    ...(optionalString(value, "requiredCreditLine") !== undefined
      ? { requiredCreditLine: optionalString(value, "requiredCreditLine") as string }
      : {}),
    ...(usagePolicy !== undefined &&
    typeof usagePolicy.requiredPublicationDisclosureLine === "string"
      ? {
          usagePolicyDisclosureLine:
            usagePolicy.requiredPublicationDisclosureLine,
        }
      : {}),
    ...(license !== undefined &&
    typeof license.displayLine === "string" &&
    typeof license.sourceDisplayRevisionHash === "string"
      ? {
          publicationLicenseDisplay: {
            displayLine: license.displayLine,
            sourceDisplayRevisionHash: license.sourceDisplayRevisionHash,
          },
        }
      : {}),
  };
}

function resolveBlock(
  value: unknown,
  inheritedPresentation: EffectiveScripturePresentation,
  contributions: ResolvedRightsContribution[],
): ResolvedRichTextBlock | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "scripture") {
    const presentation = presentationFromOverride(
      value.formattingOverride,
      inheritedPresentation,
    );
    const reference = typeof value.reference === "string" ? value.reference : "";
    const translationLabel =
      typeof value.translationLabel === "string" ? value.translationLabel : "";
    if (value.structureKind === "verseStructured") {
      const verses = (Array.isArray(value.verses) ? value.verses : []).flatMap(
        (verse): readonly {
          verseId: string;
          label: string;
          paragraphStart: boolean;
          children: readonly ResolvedInline[];
        }[] => {
          if (
            !isRecord(verse) ||
            typeof verse.verseId !== "string" ||
            typeof verse.label !== "string" ||
            typeof verse.paragraphStart !== "boolean"
          ) {
            return [];
          }
          const children = (Array.isArray(verse.children) ? verse.children : []).flatMap(
            (child) => {
              const resolved = resolveInline(child);
              return resolved === undefined ? [] : [resolved];
            },
          );
          return [{
            verseId: verse.verseId,
            label: verse.label,
            paragraphStart: verse.paragraphStart,
            children,
          }];
        },
      );
      collectRights(
        value.rights,
        contributions,
        verses.some((verse) => verse.children.some(
          (child) => child.type === "text" && child.text.length > 0,
        )),
      );
      return {
        type: "scripture",
        structureKind: "verseStructured",
        reference,
        canonicalReference:
          typeof value.canonicalReference === "string" ? value.canonicalReference : "",
        translationLabel,
        verses,
        presentation,
      };
    }
    const paragraphs = (Array.isArray(value.paragraphs) ? value.paragraphs : []).flatMap(
      (paragraph) => {
        if (!isRecord(paragraph)) return [];
        const children = (Array.isArray(paragraph.children) ? paragraph.children : []).flatMap(
          (child) => {
            const resolved = resolveInline(child);
            return resolved === undefined ? [] : [resolved];
          },
        );
        return [{ type: "paragraph" as const, children }];
      },
    );
    collectRights(
      value.rights,
      contributions,
      paragraphs.some((paragraph) => paragraph.children.some(
        (child) => child.type === "text" && child.text.length > 0,
      )),
    );
    return {
      type: "scripture",
      structureKind: "paragraphOnly",
      reference,
      ...(typeof value.canonicalReference === "string"
        ? { canonicalReference: value.canonicalReference }
        : {}),
      translationLabel,
      paragraphs,
      presentation,
    };
  }

  if (value.type === "paragraph") {
    const children = (Array.isArray(value.children) ? value.children : []).flatMap(
      (child) => {
        const inline = resolveInline(child);
        return inline === undefined ? [] : [inline];
      },
    );
    return { type: "paragraph", children };
  }
  if (
    value.type === "heading" &&
    typeof value.level === "number" &&
    Number.isInteger(value.level) &&
    value.level >= 1 &&
    value.level <= 6
  ) {
    const children = (Array.isArray(value.children) ? value.children : []).flatMap(
      (child) => {
        const inline = resolveInline(child);
        return inline === undefined ? [] : [inline];
      },
    );
    return {
      type: "heading",
      level: value.level as 1 | 2 | 3 | 4 | 5 | 6,
      children,
    };
  }
  if (
    value.type === "bulletList" ||
    value.type === "orderedList" ||
    value.type === "blockquote" ||
    value.type === "listItem"
  ) {
    const children = (Array.isArray(value.children) ? value.children : []).flatMap(
      (child) => {
        const block = resolveBlock(child, inheritedPresentation, contributions);
        return block === undefined ? [] : [block];
      },
    );
    return {
      type: value.type,
      ...(typeof value.start === "number" ? { start: value.start } : {}),
      children,
    };
  }
  return undefined;
}

export function resolveRichTextDocument(
  value: unknown,
  presentation: EffectiveScripturePresentation,
  contributions: ResolvedRightsContribution[],
): ResolvedRichTextDocument {
  const blocks = isRecord(value) && Array.isArray(value.blocks) ? value.blocks : [];
  return {
    type: "document",
    blocks: blocks.flatMap((block) => {
      const resolved = resolveBlock(block, presentation, contributions);
      return resolved === undefined ? [] : [resolved];
    }),
  };
}

/** True when resolved rich content contains a governed text leaf. */
export function resolvedRichTextHasRenderedText(
  document: ResolvedRichTextDocument,
): boolean {
  const pending = [...document.blocks];
  while (pending.length > 0) {
    const block = pending.pop();
    if (block === undefined) continue;
    if (block.type === "scripture") {
      const passages = block.structureKind === "verseStructured"
        ? block.verses
        : block.paragraphs;
      if (passages.some((passage) => passage.children.some(
        (child) => child.type === "text" && child.text.length > 0,
      ))) return true;
      continue;
    }
    if (block.type === "paragraph" || block.type === "heading") {
      if (block.children.some(
        (child) => child.type === "text" && child.text.length > 0,
      )) return true;
      continue;
    }
    pending.push(...block.children);
  }
  return false;
}

export function resolveTextContent(
  value: unknown,
  presentation: EffectiveScripturePresentation,
  contributions: ResolvedRightsContribution[],
): ResolvedTextContent {
  if (isRecord(value) && value.kind === "richText") {
    return {
      kind: "richText",
      document: resolveRichTextDocument(value.document, presentation, contributions),
    };
  }
  return {
    kind: "plain",
    text:
      isRecord(value) && value.kind === "plain" && typeof value.text === "string"
        ? value.text
        : "",
  };
}

function collectRights(
  rawRights: unknown,
  contributions: ResolvedRightsContribution[],
  governedTextRendered: boolean,
): void {
  const firstAppearance = contributions.length;
  for (const right of Array.isArray(rawRights) ? rawRights : []) {
    const contribution = sanitizeRightsContribution(
      right,
      firstAppearance,
      governedTextRendered,
    );
    if (contribution !== undefined) contributions.push(contribution);
  }
}

export function collectMusicRights(
  rawRights: unknown,
  contributions: ResolvedRightsContribution[],
  governedTextRendered: boolean,
): void {
  collectRights(rawRights, contributions, governedTextRendered);
}

/** Remove transient ids/provenance from one resolved element recursively. */
export function projectResolvedElement(element: ResolvedElement): ProjectedElement {
  const style = materializeResolvedStyle(element.style);
  const common = {
    breakPolicy: element.breakPolicy ?? "auto" as const,
    margin: element.margin ?? 0,
    padding: element.padding ?? 0,
    style,
  };
  if (element.type === "grid") {
    const rowGap = element.data.rowGap ?? element.data.cellPadding ?? 0;
    const columnGap = element.data.columnGap ?? element.data.cellPadding ?? 0;
    return {
      ...element,
      ...common,
      data: {
        rows: element.data.rows,
        columns: element.data.columns,
        rowGap,
        columnGap,
        ...(element.data.rowTracks !== undefined
          ? { rowTracks: element.data.rowTracks }
          : {}),
        ...(element.data.columnTracks !== undefined
          ? { columnTracks: element.data.columnTracks }
          : {}),
        semanticRole: element.data.semanticRole ?? "layout",
        ...(element.data.tableSemantics !== undefined
          ? { tableSemantics: element.data.tableSemantics }
          : {}),
      },
      children: element.children.map((child) => ({
        row: child.row,
        column: child.column,
        element: projectResolvedElement(child.element.element),
      })),
    };
  }
  if (element.type === "stack") {
    return {
      ...element,
      ...common,
      children: element.children.map((child) => ({
        index: child.index,
        element: projectResolvedElement(child.element.element),
      })),
    };
  }
  if (element.type === "canvas") {
    return {
      type: "canvas",
      ...common,
      width: element.width ?? "100%",
      height: element.height ?? "auto",
      children: element.children.map((child) => ({
        x: child.x,
        y: child.y,
        ...(child.semanticOrder !== undefined
          ? { semanticOrder: child.semanticOrder }
          : {}),
        element: projectResolvedElement(child.element.element),
      })),
    };
  }
  if (element.type === "image") {
    return { ...element, ...common, data: projectImageData(element.data) };
  }
  if (element.type === "date") {
    return {
      ...element,
      ...common,
      data: {
        value: element.data.value,
        format: element.data.format ?? "MMMM D, YYYY",
        ...(element.data.locale !== undefined ? { locale: element.data.locale } : {}),
        prefix: element.data.prefix ?? "",
        suffix: element.data.suffix ?? "",
      },
    };
  }
  if (element.type === "pageBreak") {
    return {
      type: "pageBreak",
      data: { intent: element.data.intent ?? "flowBreak" },
    };
  }
  if (element.type === "rightsAttribution") {
    return {
      ...element,
      ...common,
      data: {
        ...(element.data.heading !== undefined
          ? { heading: element.data.heading }
          : {}),
        ...(element.data.introText !== undefined
          ? { introText: element.data.introText }
          : {}),
        groupOrder: element.data.groupOrder,
        sortPolicy: element.data.sortPolicy ?? "firstAppearance",
        includePublicDomainLines:
          element.data.includePublicDomainLines ?? false,
      },
    };
  }
  return { ...element, ...common };
}

/** Remove transient ids/provenance from one resolved page placement. */
export function projectResolvedPageElement(
  value: ResolvedPageElement,
): ProjectedPageElement {
  return {
    purpose: value.purpose,
    target: value.target,
    layer: value.layer,
    region: value.region,
    anchor: value.anchor,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    zIndex: value.zIndex,
    clipToRegion: value.clipToRegion,
    semantic: value.semantic,
    element: projectResolvedElement(value.element.element),
  };
}

/**
 * Project the tree-owned output data. A generator can compare this with the
 * hashed projection and reject a tree/projection pair from different
 * resolution runs.
 */
export function projectResolvedTree(tree: ResolvedRenderTree): {
  readonly elements: readonly ProjectedElement[];
  readonly pageElements: readonly ProjectedPageElement[];
} {
  return {
    elements: tree.elements.map((node) => projectResolvedElement(node.element)),
    pageElements: tree.pageElements.map(projectResolvedPageElement),
  };
}

function renderPage(page: PageSetup): RenderPageProjection {
  const marginMode = page.marginMode ?? "fixed";
  const margins = page.margins;
  return {
    typstWidth: page.typstWidth,
    typstHeight: page.typstHeight,
    background: page.background ?? "#ffffff",
    marginMode,
    binding: page.binding ?? "left",
    margins: {
      top: margins?.top ?? "0pt",
      bottom: margins?.bottom ?? "0pt",
      ...(marginMode === "mirrored"
        ? {
            inner: margins?.inner ?? "0pt",
            outer: margins?.outer ?? "0pt",
          }
        : {
            left: margins?.left ?? "0pt",
            right: margins?.right ?? "0pt",
          }),
    },
  };
}

function visitProjectedElement(
  element: ProjectedElement,
  fonts: Set<string>,
  assets: Set<string>,
): void {
  if (element.style?.fontRef !== undefined) fonts.add(element.style.fontRef);
  if (element.type === "image") assets.add(element.data.assetRef);
  if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
    for (const child of element.children) visitProjectedElement(child.element, fonts, assets);
  }
}

export function makeRenderProjection(
  document: CbbDocument,
  tree: ResolvedRenderTree,
  locale: string,
  presentation: EffectiveScripturePresentation,
  rightsContributions: readonly ResolvedRightsContribution[],
): RenderProjection {
  const { elements, pageElements } = projectResolvedTree(tree);
  const fonts = new Set<string>(document.fontFallbackRefs ?? []);
  const assets = new Set<string>();
  for (const element of elements) visitProjectedElement(element, fonts, assets);
  for (const pageElement of pageElements) {
    visitProjectedElement(pageElement.element, fonts, assets);
  }
  return {
    version: 1,
    title: document.metadata?.title ?? document.name,
    locale,
    page: renderPage(document.page),
    scripturePresentation: presentation,
    fontFallbackRefs: [...(document.fontFallbackRefs ?? [])],
    elements,
    pageElements,
    rightsContributions: [...rightsContributions],
    referencedFonts: [...fonts].sort().map((fontRef) => ({ fontRef })),
    referencedAssets: [...assets].sort().map((assetRef) => ({ assetRef })),
  };
}
