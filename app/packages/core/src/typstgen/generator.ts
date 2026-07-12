import type {
  EffectiveScripturePresentation,
  RenderPageProjection,
  ResolvedElement,
  ResolvedNode,
  ResolvedPageElement,
  ResolvedRichTextBlock,
  ResolvedRichTextDocument,
  ResolvedRightsAttributionElement,
} from "../document/resolvedTypes.js";
import { canonicalStringify } from "../canonical/index.js";
import {
  classifyBreakBehavior,
  type BreakMatrixSubject,
} from "../layout/index.js";
import {
  materializeResolvedStyle,
  projectResolvedTree,
} from "../resolve/projection.js";
import { formatIsoDate } from "./date.js";
import {
  MANDATORY_BUNDLED_FONTS,
  assertMaterializedMandatoryBundledFonts,
} from "./bundledFonts.js";
import { assertSafeBuildRelativePath, typstStringLiteral } from "./escape.js";
import { renderRichTextDocument } from "./richText.js";
import {
  generateRightsBlock,
  type GeneratedRightsBlock,
} from "./rights.js";
import {
  TypstSourceBuilder,
  type SourceRegion,
} from "./sourceBuilder.js";
import {
  TYPST_GENERATOR_VERSION,
  type TypstGenerationFinding,
  type TypstGenerationInput,
  type TypstGenerationOptions,
  type TypstGenerationResult,
} from "./types.js";
import { typstColor, typstFontSize, typstLength } from "./values.js";

interface EmitContext {
  readonly input: TypstGenerationInput;
  readonly options: TypstGenerationOptions;
  readonly builder: TypstSourceBuilder;
  readonly findings: TypstGenerationFinding[];
  readonly generatedRights: Map<string, GeneratedRightsBlock>;
  rightsBlockCount: number;
}

interface NodeEmitOptions {
  /** Fill an authoritative containing placement box on this axis. */
  readonly fillWidth?: boolean;
  readonly fillHeight?: boolean;
  /** Page-level content cannot participate in pagination. */
  readonly forceUnbreakable?: boolean;
  /** Render the app-owned logical page number using the wrapped node's style. */
  readonly generatedPageNumber?: boolean;
}

function addFinding(
  context: EmitContext,
  finding: TypstGenerationFinding
): void {
  context.findings.push(finding);
}

function safeFamilyName(value: string): string {
  if (value.trim().length === 0 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new TypeError("Font family name contains unsafe characters");
  }
  return value;
}

interface TypstTextLocale {
  readonly language: string;
  readonly region?: string;
}

/**
 * Map the deterministic Typst-supported BCP 47 subset. Typst exposes ISO 639
 * language plus an optional ISO 3166-1 alpha-2 region; script, variant,
 * extension, and private-use subtags cannot be represented faithfully.
 */
function typstTextLocale(value: string): TypstTextLocale | undefined {
  const match = /^([A-Za-z]{2,3})(?:-([A-Za-z]{2}))?$/.exec(value);
  const language = match?.[1];
  const region = match?.[2];
  if (language === undefined) return undefined;
  return {
    language: language.toLowerCase(),
    ...(region !== undefined ? { region: region.toUpperCase() } : {}),
  };
}

function fontFamilies(
  context: EmitContext,
  style: ResolvedElement["style"],
  resolvedId: string
): readonly string[] {
  const families: string[] = [];
  const addRef = (fontRef: string): void => {
    const binding = context.options.fonts?.[fontRef];
    if (binding === undefined) {
      addFinding(context, {
        code: "CBB-FONT-0001",
        severity: "error",
        kind: "missingFont",
        message: `No verified build font binding exists for ${fontRef}.`,
        resolvedId,
      });
      return;
    }
    const family = safeFamilyName(binding.familyName);
    if (!families.includes(family)) families.push(family);
  };

  if (style?.fontRef !== undefined) addRef(style.fontRef);
  for (const fontRef of context.input.projection.fontFallbackRefs) addRef(fontRef);
  return families;
}

function mandatoryBundledFontFamilies(
  options: TypstGenerationOptions,
): readonly string[] {
  return MANDATORY_BUNDLED_FONTS.map(({ fontRef, familyName }) => {
    const binding = options.fonts?.[fontRef];
    if (binding === undefined) {
      throw new TypeError(
        `generateTypst: no verified build font binding exists for mandatory ${fontRef}`,
      );
    }
    const boundFamily = safeFamilyName(binding.familyName);
    if (boundFamily !== familyName) {
      throw new TypeError(
        `generateTypst: mandatory ${fontRef} must bind to ${familyName}`,
      );
    }
    return boundFamily;
  });
}

function textStyleSet(
  context: EmitContext,
  style: ResolvedElement["style"],
  resolvedId: string
): string {
  const effective = materializeResolvedStyle(style);
  const args: string[] = [];
  const families = fontFamilies(context, effective, resolvedId);
  args.push(
    `font: (${families.map(typstStringLiteral).join(", ")}${
      families.length === 1 ? "," : ""
    })`
  );
  args.push(`size: ${typstFontSize(effective.fontSize)}`);
  if (effective.fontWeight !== undefined) {
    const weight = {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    }[effective.fontWeight];
    args.push(`weight: ${weight}`);
  }
  if (effective.fontStyle !== undefined) {
    args.push(`style: ${typstStringLiteral(effective.fontStyle)}`);
  }
  args.push(`fill: ${typstColor(effective.color ?? "#251d18")}`);
  return `#set text(${args.join(", ")})\n`;
}

function blockArguments(
  element: ResolvedElement,
  breakable: boolean,
  options: NodeEmitOptions = {},
): string[] {
  const effective = materializeResolvedStyle(element.style);
  const args: string[] = [`breakable: ${breakable ? "true" : "false"}`];
  if (options.fillWidth === true) {
    args.push("width: 100%");
  } else if (element.width !== undefined) {
    args.push(`width: ${typstLength(element.width, "element-size")}`);
  } else if (element.type === "canvas") {
    args.push("width: 100%");
  }
  if (options.fillHeight === true) {
    args.push("height: 100%");
  } else if (element.height !== undefined) {
    args.push(`height: ${typstLength(element.height, "element-size")}`);
  } else if (element.type === "canvas") {
    args.push("height: auto");
  }
  args.push(`inset: ${typstLength(element.padding ?? 0, "spacing")}`);
  const margin = typstLength(element.margin ?? 0, "spacing");
  // A zero CBB margin means no additional element spacing. Explicitly setting
  // Typst block spacing to zero is not equivalent to leaving it automatic: it
  // can collapse the measured extent of a trailing structural child and let
  // the following block overlap it. Preserve Typst's intrinsic structural
  // spacing for the zero/default case; nonzero CBB margins remain explicit.
  if (margin !== "0pt") args.push(`above: ${margin}`, `below: ${margin}`);
  args.push(`fill: ${typstColor(effective.background ?? "transparent")}`);
  const borderWidth = effective.borderWidth;
  if (borderWidth !== undefined) {
    const width = typstLength(borderWidth, "border-width");
    if (width !== "0pt") {
      const color = typstColor(effective.borderColor ?? "#d8cdbd");
      args.push(`stroke: ${width} + ${color}`);
    }
  }
  return args;
}

function naturallyBreakable(element: ResolvedElement): boolean {
  const subject: BreakMatrixSubject = (() => {
    switch (element.type) {
      case "text":
        return { kind: "text" };
      case "image":
        return { kind: "image" };
      case "date":
        return { kind: "date" };
      case "music":
        return {
          kind: "music",
          hasRichContent: element.data.richContent !== undefined,
        };
      case "rightsAttribution":
        // The generated-entry count changes empty output into a breakable
        // block, but never changes its legal break location.
        return { kind: "rightsAttribution", entryCount: 1 };
      case "grid":
        return { kind: "grid", rowCount: element.data.rows };
      case "stack":
        return { kind: "stack", direction: element.data.direction };
      case "canvas":
        return { kind: "canvas" };
      case "pageBreak":
        return {
          kind: "pageBreak",
          intent: element.data.intent ?? "flowBreak",
        };
    }
  })();
  const classification = classifyBreakBehavior(subject, {
    fixedHeight: element.height !== undefined && element.height !== "auto",
  });
  return classification.mode === "breakable";
}

function emitStyledBody(
  context: EmitContext,
  node: ResolvedNode,
  fixedHeight: boolean,
  emitBody: () => void
): void {
  const { element } = node;
  const style = materializeResolvedStyle(element.style);
  // A scoped set rule styles nested structural content without converting
  // headings, grids, quotes, and blocks into an inline `text(...)` sequence.
  context.builder.append(textStyleSet(context, style, node.resolvedId));
  const horizontal = style.align === "center"
    ? "center"
    : style.align === "right"
      ? "right"
      : "left";
  const vertical = fixedHeight
    ? { top: "", center: " + horizon", bottom: " + bottom" }[
        style.verticalAlign ?? "top"
      ]
    : "";
  let alignmentWrapperOpen = false;
  if (style.align === "justify") {
    context.builder.append("#set par(justify: true)\n");
  }
  // Keep ordinary left/top flow as ordinary flow. Non-default alignment still
  // needs an explicit wrapper, including vertical alignment in a fixed-height
  // box. Justification controls paragraph line layout independently, so a
  // justified fixed box may still need this vertical wrapper.
  if (horizontal !== "left" || vertical !== "") {
    context.builder.append(`#align(${horizontal}${vertical})[`);
    alignmentWrapperOpen = true;
  }
  emitBody();
  if (alignmentWrapperOpen) context.builder.append("]");
}

function emitImage(
  context: EmitContext,
  node: ResolvedNode,
  options: NodeEmitOptions,
): void {
  if (node.element.type !== "image") return;
  const { data } = node.element;
  const binding = context.options.assets?.[data.assetRef];
  if (data.decorative !== true && (data.alt === undefined || data.alt.trim() === "")) {
    addFinding(context, {
      code: "CBB-PDF-0002",
      severity: "warning",
      kind: "missingAltText",
      message:
        "A non-decorative image is missing alternative text; preview and non-accessible output may continue, but accessible finalization must block.",
      resolvedId: node.resolvedId,
    });
  }
  if (binding === undefined) {
    addFinding(context, {
      code: "CBB-ASSET-0001",
      severity: "error",
      kind: "missingAsset",
      message: `No verified build asset binding exists for ${data.assetRef}.`,
      resolvedId: node.resolvedId,
    });
    const placeholderHeight =
      options.fillHeight === true ||
      (node.element.height !== undefined && node.element.height !== "auto")
        ? "100%"
        : "48pt";
    context.builder.append(
      `#rect(width: 100%, height: ${placeholderHeight}, fill: luma(235), stroke: 1pt + luma(160))[#align(center + horizon)[#text(${typstStringLiteral("Missing image")})]]`
    );
    return;
  }
  assertSafeBuildRelativePath(binding.relativePath);
  const args = [typstStringLiteral(binding.relativePath)];
  args.push(`fit: ${typstStringLiteral(data.fit)}`);
  const fillWidth =
    options.fillWidth === true ||
    (node.element.width !== undefined && node.element.width !== "auto");
  const fillHeight =
    options.fillHeight === true ||
    (node.element.height !== undefined && node.element.height !== "auto");
  if (fillWidth) args.push("width: 100%");
  if (fillHeight) args.push("height: 100%");
  if (
    data.fit === "cover" &&
    data.focalPoint !== undefined &&
    (data.focalPoint.x !== 0.5 || data.focalPoint.y !== 0.5)
  ) {
    // Typst's image element supports centered cover cropping but exposes no
    // crop-position parameter. Do not silently produce the wrong crop.
    addFinding(context, {
      code: "CBB-LAYOUT-0003",
      severity: "error",
      kind: "unsupportedImageFocalPoint",
      message:
        "This Typst version cannot honor a non-centered cover focal point.",
      resolvedId: node.resolvedId,
    });
  }
  args.push(
    data.decorative === true
      ? "alt: none"
      : `alt: ${typstStringLiteral(data.alt ?? "")}`
  );
  context.builder.append(`#image(${args.join(", ")})`);
}

function emitDate(context: EmitContext, node: ResolvedNode): void {
  if (node.element.type !== "date") return;
  const { data } = node.element;
  let text = data.value;
  try {
    const formatted = formatIsoDate(
      data.value,
      data.format,
      data.locale ?? context.input.projection.locale
    );
    text = formatted.text;
    if (formatted.localeFallbackFrom !== undefined) {
      addFinding(context, {
        code: "CBB-DOC-0001",
        severity: "warning",
        kind: "invalidDate",
        message: `Bundled locale data does not include ${formatted.localeFallbackFrom}; date formatting fell back to en-US.`,
        resolvedId: node.resolvedId,
      });
    }
  } catch (error) {
    addFinding(context, {
      code: "CBB-DOC-0001",
      severity: "error",
      kind: "invalidDate",
      message: error instanceof Error ? error.message : "Invalid date value.",
      resolvedId: node.resolvedId,
    });
  }
  context.builder.append(
    `#text(${typstStringLiteral(`${data.prefix ?? ""}${text}${data.suffix ?? ""}`)})`
  );
}

function emitMusic(context: EmitContext, node: ResolvedNode): void {
  if (node.element.type !== "music") return;
  const { data } = node.element;
  const title = data.number === undefined ? data.title : `${data.number} — ${data.title}`;
  context.builder.append(`#strong[#text(${typstStringLiteral(title)})]`);
  if (data.instructions !== undefined) {
    context.builder.append(
      `#parbreak()#emph[#text(${typstStringLiteral(data.instructions)})]`
    );
  }
  if (data.source !== undefined) {
    context.builder.append(`#parbreak()#text(${typstStringLiteral(data.source)})`);
  }
  if (data.richContent !== undefined) {
    context.builder.append(`#parbreak()${renderRichTextDocument(data.richContent)}`);
  }
}

function prepareRights(
  context: EmitContext,
  node: ResolvedNode
): GeneratedRightsBlock {
  if (node.element.type !== "rightsAttribution") {
    throw new TypeError("prepareRights requires a rightsAttribution node");
  }
  const cached = context.generatedRights.get(node.resolvedId);
  if (cached !== undefined) return cached;
  context.rightsBlockCount++;
  if (context.rightsBlockCount > 1) {
    addFinding(context, {
      code: "CBB-RIGHTS-0002",
      severity: "error",
      kind: "duplicateRightsBlock",
      message: "More than one Copyrights & Permissions block is active.",
      resolvedId: node.resolvedId,
    });
  }
  const generated = generateRightsBlock(
    node.element as ResolvedRightsAttributionElement,
    context.input.projection.rightsContributions
  );
  for (const finding of generated.findings) {
    addFinding(context, {
      code: finding.code,
      severity: finding.severity,
      kind: "rightsGeneration",
      message: finding.message,
      resolvedId: node.resolvedId,
    });
  }
  context.generatedRights.set(node.resolvedId, generated);
  return generated;
}

function emitRights(context: EmitContext, node: ResolvedNode): void {
  if (node.element.type !== "rightsAttribution") return;
  const generated = prepareRights(context, node);
  if (generated.entries.length === 0) return;
  if (generated.heading !== undefined) {
    context.builder.append(
      `#heading(level: 2)[#text(${typstStringLiteral(generated.heading)})]`
    );
  }
  if (generated.introText !== undefined) {
    context.builder.append(
      `#block[#text(${typstStringLiteral(generated.introText)})]`
    );
  }
  for (const entry of generated.entries) {
    context.builder.append("#block(breakable: false)[");
    for (const [index, line] of entry.lines.entries()) {
      if (index > 0) context.builder.append("#linebreak()");
      context.builder.append(`#text(${typstStringLiteral(line)})`);
    }
    context.builder.append("]");
  }
}

function repeatedTracks(value: string, count: number): string {
  return `(${value},) * ${count}`;
}

function tracks(
  values: readonly string[] | undefined,
  count: number,
  defaultTrack: "1fr" | "auto",
): string {
  if (values === undefined || values.length === 0) {
    return repeatedTracks(defaultTrack, count);
  }
  const emitted = values.map((value) => typstLength(value, "track"));
  const first = emitted[0];
  if (first !== undefined && emitted.every((value) => value === first)) {
    return repeatedTracks(first, emitted.length);
  }
  return `(${emitted.join(", ")}${emitted.length === 1 ? "," : ""})`;
}

function emitGrid(
  context: EmitContext,
  node: ResolvedNode,
  region: SourceRegion,
  fixedHeight: boolean,
): void {
  if (node.element.type !== "grid") return;
  const { data, children } = node.element;
  const semanticTable = data.semanticRole === "table";
  const functionName = semanticTable ? "table" : "grid";
  const args = [
    `columns: ${tracks(data.columnTracks, data.columns, "1fr")}`,
    // Fractional rows in an auto-height Typst grid consume the remaining page
    // height. Keep natural content-sized rows unless the outer box supplies an
    // authoritative height; fixed boxes can divide that bounded height equally.
    `rows: ${tracks(data.rowTracks, data.rows, fixedHeight ? "1fr" : "auto")}`,
  ];
  const rowGap = data.rowGap ?? data.cellPadding ?? 0;
  const columnGap = data.columnGap ?? data.cellPadding ?? 0;
  args.push(`row-gutter: ${typstLength(rowGap, "spacing")}`);
  args.push(`column-gutter: ${typstLength(columnGap, "spacing")}`);
  context.builder.append(`#${functionName}(${args.join(", ")}`);
  const ordered = [...children].sort((left, right) =>
    left.row - right.row || left.column - right.column ||
    (left.resolvedId < right.resolvedId ? -1 : left.resolvedId > right.resolvedId ? 1 : 0)
  );
  for (const child of ordered) {
    context.builder.append(", ");
    context.builder.append(
      `${functionName}.cell(x: ${child.column}, y: ${child.row}, breakable: false)[`
    );
    emitNodeExpression(context, child.element, region);
    context.builder.append("]");
  }
  context.builder.append(")");
}

function emitStack(context: EmitContext, node: ResolvedNode, region: SourceRegion): void {
  if (node.element.type !== "stack") return;
  const children = [...node.element.children].sort((left, right) => left.index - right.index);
  const gap = typstLength(node.element.data.gap, "spacing");
  if (node.element.data.direction === "horizontal") {
    context.builder.append(
      `#grid(columns: ${repeatedTracks("1fr", Math.max(1, children.length))}, column-gutter: ${gap}`
    );
    for (const child of children) {
      context.builder.append(", [");
      emitNodeExpression(context, child.element, region);
      context.builder.append("]");
    }
    context.builder.append(")");
    return;
  }
  for (const [index, child] of children.entries()) {
    if (index > 0) context.builder.append(`#v(${gap})`);
    emitNodeExpression(context, child.element, region);
  }
}

function staticCanvasAutoHeight(
  context: EmitContext,
  node: ResolvedNode,
): string {
  if (node.element.type !== "canvas") return "0pt";
  const extents: string[] = [];
  let supported = true;
  for (const child of node.element.children) {
    const height = child.element.element.height;
    if (
      height === undefined ||
      height === "auto" ||
      (typeof height === "string" && height.endsWith("%"))
    ) {
      supported = false;
      continue;
    }
    const y = typstLength(child.y, "canvas-position");
    const childHeight = typstLength(height, "element-size");
    const margin = child.element.element.margin;
    extents.push(
      margin === undefined
        ? `${y} + ${childHeight}`
        : `${y} + ${childHeight} + 2 * ${typstLength(margin, "spacing")}`,
    );
  }
  if (!supported) {
    addFinding(context, {
      code: "CBB-LAYOUT-0003",
      severity: "error",
      kind: "invalidLayout",
      message:
        "Canvas auto-height cannot be resolved because every child needs a fixed physical height.",
      resolvedId: node.resolvedId,
    });
    // An error finding is a build blocker. Keep the derived source syntactically
    // valid without inventing an arbitrary preview height.
    return "0pt";
  }
  return extents.length === 0
    ? "0pt"
    : `calc.max(0pt, ${extents.map((extent) => `(${extent})`).join(", ")})`;
}

function emitCanvas(context: EmitContext, node: ResolvedNode, region: SourceRegion): void {
  if (node.element.type !== "canvas") return;
  const height =
    node.element.height === undefined || node.element.height === "auto"
      ? staticCanvasAutoHeight(context, node)
      : typstLength(node.element.height, "element-size");
  context.builder.append(`#block(width: 100%, height: ${height}, clip: true)[`);
  for (const child of node.element.children) {
    context.builder.append(
      `#place(top + left, dx: ${typstLength(child.x, "canvas-position")}, dy: ${typstLength(child.y, "canvas-position")})[`
    );
    emitNodeExpression(context, child.element, region);
    context.builder.append("]");
  }
  context.builder.append("]");
}

function emitElementBody(
  context: EmitContext,
  node: ResolvedNode,
  region: SourceRegion,
  options: NodeEmitOptions,
): void {
  const { element } = node;
  switch (element.type) {
    case "text":
      context.builder.append(
        element.data.content.kind === "plain"
          ? `#text(${typstStringLiteral(element.data.content.text)})`
          : renderRichTextDocument(element.data.content.document)
      );
      return;
    case "image":
      emitImage(context, node, options);
      return;
    case "date":
      emitDate(context, node);
      return;
    case "music":
      emitMusic(context, node);
      return;
    case "rightsAttribution":
      emitRights(context, node);
      return;
    case "grid":
      emitGrid(
        context,
        node,
        region,
        options.fillHeight === true ||
          (element.height !== undefined && element.height !== "auto"),
      );
      return;
    case "stack":
      emitStack(context, node, region);
      return;
    case "canvas":
      emitCanvas(context, node, region);
      return;
    case "pageBreak":
      return;
  }
}

function emitNodeExpression(
  context: EmitContext,
  node: ResolvedNode,
  region: SourceRegion,
  options: NodeEmitOptions = {},
): void {
  context.builder.mapped(node.resolvedId, region, () => {
    const { element } = node;
    if (element.type === "pageBreak") {
      context.builder.append("pagebreak()");
      return;
    }
    if (
      element.type === "rightsAttribution" &&
      prepareRights(context, node).entries.length === 0
    ) {
      return;
    }
    const breakable =
      options.forceUnbreakable !== true &&
      naturallyBreakable(element) &&
      element.breakPolicy !== "avoid";
    const fixedHeight =
      options.fillHeight === true ||
      (element.height !== undefined && element.height !== "auto");
    context.builder.append(
      `#block(${blockArguments(element, breakable, options).join(", ")})[`,
    );
    emitStyledBody(context, node, fixedHeight, () => {
      if (options.generatedPageNumber === true) {
        context.builder.append('#context counter(page).display("1")');
      } else {
        emitElementBody(context, node, region, options);
      }
    });
    context.builder.append("]");
  });
}

function targetExpression(pageElement: ResolvedPageElement): string {
  switch (pageElement.target.mode) {
    case "all":
      return "true";
    case "first":
      return "cbb_page_number == 1";
    case "last":
      return "cbb_page_number == cbb_page_total";
    case "odd":
      return "calc.rem(cbb_page_number, 2) == 1";
    case "even":
      return "calc.rem(cbb_page_number, 2) == 0";
    case "range":
      return `cbb_page_number >= ${pageElement.target.start} and cbb_page_number <= ${pageElement.target.end}`;
    case "pages":
      return `cbb_page_number in (${pageElement.target.pages.join(", ")}${
        pageElement.target.pages.length === 1 ? "," : ""
      })`;
  }
}

function anchorExpression(anchor: ResolvedPageElement["anchor"]): string {
  return {
    topLeft: "top + left",
    topCenter: "top + center",
    topRight: "top + right",
    centerLeft: "horizon + left",
    center: "horizon + center",
    centerRight: "horizon + right",
    bottomLeft: "bottom + left",
    bottomCenter: "bottom + center",
    bottomRight: "bottom + right",
  }[anchor];
}

interface EmittedPageMargins {
  readonly top: string;
  readonly bottom: string;
  readonly fixedLeft: string;
  readonly fixedRight: string;
  readonly inner: string;
  readonly outer: string;
}

function emittedPageMargins(page: RenderPageProjection): EmittedPageMargins {
  const margins = page.margins;
  return {
    top: typstLength(margins?.top ?? "0pt", "physical"),
    bottom: typstLength(margins?.bottom ?? "0pt", "physical"),
    fixedLeft: typstLength(margins?.left ?? "0pt", "physical"),
    fixedRight: typstLength(margins?.right ?? "0pt", "physical"),
    inner: typstLength(margins?.inner ?? "0pt", "physical"),
    outer: typstLength(margins?.outer ?? "0pt", "physical"),
  };
}

/** Emit the exact physical rectangle used as each page-placement basis. */
function emitPageRegionHelpers(context: EmitContext): void {
  const page = context.input.projection.page;
  const margins = emittedPageMargins(page);
  const mirrored = page.marginMode === "mirrored";
  const insideIsLeftOnOdd = (page.binding ?? "left") === "left";
  context.builder.append(
    `#let cbb_page_width = ${typstLength(page.typstWidth, "physical")}\n`,
  );
  context.builder.append(
    `#let cbb_page_height = ${typstLength(page.typstHeight, "physical")}\n`,
  );
  context.builder.append("#let cbb_page_region(page_number, region_name) = {\n");
  context.builder.append(`  let top = ${margins.top}\n`);
  context.builder.append(`  let bottom = ${margins.bottom}\n`);
  if (mirrored) {
    context.builder.append(
      "  let odd = calc.rem(page_number, 2) == 1\n",
    );
    const insideLeftCondition = insideIsLeftOnOdd ? "odd" : "not odd";
    context.builder.append(
      `  let left = if ${insideLeftCondition} { ${margins.inner} } else { ${margins.outer} }\n`,
    );
    context.builder.append(
      `  let right = if ${insideLeftCondition} { ${margins.outer} } else { ${margins.inner} }\n`,
    );
  } else {
    context.builder.append(`  let left = ${margins.fixedLeft}\n`);
    context.builder.append(`  let right = ${margins.fixedRight}\n`);
  }
  context.builder.append("  let content_width = cbb_page_width - left - right\n");
  context.builder.append("  let content_height = cbb_page_height - top - bottom\n");
  context.builder.append(
    '  if region_name == "page" { (x: 0pt, y: 0pt, width: cbb_page_width, height: cbb_page_height) }\n',
  );
  context.builder.append(
    '  else if region_name == "content" { (x: left, y: top, width: content_width, height: content_height) }\n',
  );
  context.builder.append(
    '  else if region_name == "topMargin" { (x: left, y: 0pt, width: content_width, height: top) }\n',
  );
  context.builder.append(
    '  else if region_name == "bottomMargin" { (x: left, y: cbb_page_height - bottom, width: content_width, height: bottom) }\n',
  );
  context.builder.append(
    '  else if region_name == "leftMargin" { (x: 0pt, y: top, width: left, height: content_height) }\n',
  );
  context.builder.append(
    '  else { (x: cbb_page_width - right, y: top, width: right, height: content_height) }\n',
  );
  context.builder.append("}\n");
}

function emitPageLayer(
  context: EmitContext,
  name: "background" | "foreground",
  pageElements: readonly ResolvedPageElement[]
): void {
  if (pageElements.length === 0) return;
  context.builder.append(`#let cbb_page_${name} = context {\n`);
  context.builder.append("  let cbb_page_number = counter(page).get().first()\n");
  context.builder.append("  let cbb_page_total = counter(page).final().first()\n");
  context.builder.append("  let cbb_page_content = []\n");
  const ordered = pageElements
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const layerRank = { background: 0, underlay: 1, overlay: 2 } as const;
      return (
        layerRank[left.entry.layer] - layerRank[right.entry.layer] ||
        left.entry.zIndex - right.entry.zIndex ||
        left.index - right.index
      );
    });
  for (const { entry } of ordered) {
    context.builder.mapped(
      entry.resolvedId,
      name === "background" ? "page-background" : "page-foreground",
      () => {
        context.builder.append(`  if ${targetExpression(entry)} {\n`);
        context.builder.append(
          `    let cbb_region = cbb_page_region(cbb_page_number, ${typstStringLiteral(entry.region)})\n`,
        );
        context.builder.append(
          `    cbb_page_content += place(top + left, dx: cbb_region.x, dy: cbb_region.y, block(width: cbb_region.width, height: cbb_region.height, clip: ${entry.clipToRegion ? "true" : "false"})[#place(${anchorExpression(entry.anchor)}, dx: ${typstLength(entry.x, "physical-or-relative")}, dy: ${typstLength(entry.y, "physical-or-relative")})[#block(width: ${typstLength(entry.width, "page-element-size")}, height: ${typstLength(entry.height, "page-element-size")}, clip: true)[`,
        );
        emitNodeExpression(
          context,
          entry.element,
          name === "background" ? "page-background" : "page-foreground",
          {
            fillWidth: entry.width !== "auto",
            fillHeight: entry.height !== "auto",
            forceUnbreakable: true,
            generatedPageNumber: entry.purpose === "pageNumber",
          },
        );
        context.builder.append("]]])\n  }\n");
      }
    );
  }
  context.builder.append("  cbb_page_content\n}\n");
}

function marginProjection(page: RenderPageProjection): string {
  const margins = page.margins;
  if (margins === undefined) return "0pt";
  const args: string[] = [];
  if (margins.top !== undefined) args.push(`top: ${typstLength(margins.top, "physical")}`);
  if (margins.bottom !== undefined) {
    args.push(`bottom: ${typstLength(margins.bottom, "physical")}`);
  }
  if (page.marginMode === "mirrored") {
    args.push(`inside: ${typstLength(margins.inner ?? "0pt", "physical")}`);
    args.push(`outside: ${typstLength(margins.outer ?? "0pt", "physical")}`);
  } else {
    args.push(`left: ${typstLength(margins.left ?? "0pt", "physical")}`);
    args.push(`right: ${typstLength(margins.right ?? "0pt", "physical")}`);
  }
  return `(${args.join(", ")})`;
}

function emitPreamble(context: EmitContext): void {
  const mandatoryFamilies = mandatoryBundledFontFamilies(context.options);
  const background = context.input.tree.pageElements.filter(
    (entry) => entry.layer === "background" || entry.layer === "underlay"
  );
  const foreground = context.input.tree.pageElements.filter(
    (entry) => entry.layer === "overlay"
  );
  context.builder.append(`// Generated by ${TYPST_GENERATOR_VERSION}. Do not edit.\n`);
  context.builder.append(
    `#set document(title: ${typstStringLiteral(context.input.projection.title)})\n`,
  );
  // Typst's default text box ends at the baseline, so glyph ink can extend
  // beyond a bottom-anchored authoritative placement box and be clipped at the
  // page edge. Use full font extents so matching page anchors contain text.
  context.builder.append(
    `#set text(font: (${mandatoryFamilies.map(typstStringLiteral).join(", ")}), top-edge: "ascender", bottom-edge: "descender")\n`,
  );
  const locale = typstTextLocale(context.input.projection.locale);
  if (locale !== undefined) {
    const localeArgs = [`lang: ${typstStringLiteral(locale.language)}`];
    if (locale.region !== undefined) {
      localeArgs.push(`region: ${typstStringLiteral(locale.region)}`);
    }
    context.builder.append(`#set text(${localeArgs.join(", ")})\n`);
  }
  emitPageRegionHelpers(context);
  emitPageLayer(context, "background", background);
  emitPageLayer(context, "foreground", foreground);
  const page = context.input.projection.page;
  const args = [
    `width: ${typstLength(page.typstWidth, "physical")}`,
    `height: ${typstLength(page.typstHeight, "physical")}`,
    `margin: ${marginProjection(page)}`,
    `binding: ${page.binding ?? "left"}`,
    `fill: ${typstColor(page.background ?? "#ffffff")}`,
  ];
  if (background.length > 0) args.push("background: cbb_page_background");
  if (foreground.length > 0) args.push("foreground: cbb_page_foreground");
  context.builder.append(`#set page(${args.join(", ")})\n`);
  context.builder.append("#set par(leading: 0.65em)\n");
}

function presentationHasUnsupportedTypography(
  presentation: EffectiveScripturePresentation,
): boolean {
  return presentation.typographyPresetSnapshot !== undefined;
}

function richTextBlockHasUnsupportedTypography(
  block: ResolvedRichTextBlock,
): boolean {
  if (block.type === "scripture") {
    return presentationHasUnsupportedTypography(block.presentation);
  }
  if (
    block.type === "bulletList" ||
    block.type === "orderedList" ||
    block.type === "blockquote" ||
    block.type === "listItem"
  ) {
    return block.children.some(richTextBlockHasUnsupportedTypography);
  }
  return false;
}

function richTextHasUnsupportedTypography(
  document: ResolvedRichTextDocument,
): boolean {
  return document.blocks.some(richTextBlockHasUnsupportedTypography);
}

function visitResolvedNodes(
  nodes: readonly ResolvedNode[],
  visitor: (node: ResolvedNode) => void,
): void {
  for (const node of nodes) {
    visitor(node);
    const element = node.element;
    if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
      visitResolvedNodes(
        element.children.map((child) => child.element),
        visitor,
      );
    }
  }
}

function canvasSemanticOrderIsIdentity(element: ResolvedElement): boolean {
  if (element.type !== "canvas") return true;
  const orders = element.children.map((child) => child.semanticOrder);
  if (orders.every((order) => order === undefined)) return true;
  let previous = -1;
  for (const order of orders) {
    if (
      order === undefined ||
      !Number.isInteger(order) ||
      order < 0 ||
      order <= previous
    ) {
      return false;
    }
    previous = order;
  }
  return true;
}

function addPreflightFindings(context: EmitContext): void {
  const allRoots = [
    ...context.input.tree.elements,
    ...context.input.tree.pageElements.map((entry) => entry.element),
  ];
  if (context.input.projection.title.trim().length === 0) {
    addFinding(context, {
      code: "CBB-PDF-0002",
      severity: "error",
      kind: "missingDocumentTitle",
      message: "The machine-readable PDF title must not be empty.",
    });
  }
  if (typstTextLocale(context.input.projection.locale) === undefined) {
    addFinding(context, {
      code: "CBB-PDF-0002",
      severity: "error",
      kind: "unsupportedLocale",
      message:
        `Typst cannot faithfully represent language tag ${JSON.stringify(context.input.projection.locale)} as an ISO 639 language with optional ISO 3166-1 region.`,
    });
  }
  for (const pageElement of context.input.tree.pageElements) {
    if (pageElement.semantic.mode === "content") {
      addFinding(context, {
        code: "CBB-PDF-0002",
        severity: "error",
        kind: "unsupportedPageSemantics",
        message:
          "Meaningful page-level content cannot be represented in source reading order by Typst page foreground/background callbacks.",
        resolvedId: pageElement.resolvedId,
      });
    }
  }

  let rightsBlockCount = 0;
  visitResolvedNodes(allRoots, (node) => {
    if (node.element.type === "rightsAttribution") rightsBlockCount++;
    if (node.element.type === "grid" && node.element.data.semanticRole === "table") {
      addFinding(context, {
        code: "CBB-PDF-0002",
        severity: "error",
        kind: "unsupportedTableSemantics",
        message:
          "Semantic table summary and header scope require the staged accessibility-extras renderer.",
        resolvedId: node.resolvedId,
      });
    }
    if (node.element.type === "canvas" && !canvasSemanticOrderIsIdentity(node.element)) {
      addFinding(context, {
        code: "CBB-PDF-0002",
        severity: "error",
        kind: "unsupportedCanvasSemantics",
        message:
          "Canvas reading order differs from paint order and cannot yet be represented without changing visual stacking.",
        resolvedId: node.resolvedId,
      });
    }
    if (
      node.element.breakPolicy === "avoid" &&
      naturallyBreakable(node.element)
    ) {
      addFinding(context, {
        code: "CBB-LAYOUT-0003",
        severity: "error",
        kind: "invalidLayout",
        message:
          "breakPolicy avoid requires a measured pagination plan so oversized content can fall back to natural fragmentation.",
        resolvedId: node.resolvedId,
      });
    }
  });
  const needsRightsBlock = context.input.projection.rightsContributions.some(
    (contribution) =>
      contribution.requiredCreditLineApplies ||
      contribution.usagePolicyDisclosureLine !== undefined ||
      contribution.publicationLicenseDisplay !== undefined,
  );
  if (needsRightsBlock && rightsBlockCount === 0) {
    addFinding(context, {
      code: "CBB-RIGHTS-0001",
      severity: "error",
      kind: "rightsGeneration",
      message:
        "Active rights contributions require publication text, but the resolved tree has no Copyrights & Permissions block.",
    });
  }

  const globalTypographyUnsupported = presentationHasUnsupportedTypography(
    context.input.projection.scripturePresentation,
  );
  if (globalTypographyUnsupported) {
    addFinding(context, {
      code: "CBB-DOC-0001",
      severity: "error",
      kind: "unsupportedTypographyPreset",
      message:
        "Scripture typographyPresetSnapshot is present, but v1 Typst generation has no supported mapping for it.",
    });
    return;
  }

  visitResolvedNodes(
    allRoots,
    (node) => {
      const element = node.element;
      const unsupported =
        (element.type === "text" &&
          element.data.content.kind === "richText" &&
          richTextHasUnsupportedTypography(element.data.content.document)) ||
        (element.type === "music" &&
          element.data.richContent !== undefined &&
          richTextHasUnsupportedTypography(element.data.richContent));
      if (unsupported) {
        addFinding(context, {
          code: "CBB-DOC-0001",
          severity: "error",
          kind: "unsupportedTypographyPreset",
          message:
            "A Scripture formatting override contains typographyPresetSnapshot, but v1 Typst generation has no supported mapping for it.",
          resolvedId: node.resolvedId,
        });
      }
    },
  );
}

/**
 * A projection hash is meaningful only for the exact resolved tree it was
 * derived from. Fail before producing any source when callers pair data from
 * different resolution runs.
 */
function assertProjectionMatchesTree(input: TypstGenerationInput): void {
  const treeProjection = projectResolvedTree(input.tree);
  const suppliedProjection = {
    elements: input.projection.elements,
    pageElements: input.projection.pageElements,
  };
  if (
    canonicalStringify(treeProjection) !== canonicalStringify(suppliedProjection)
  ) {
    throw new TypeError(
      "generateTypst: resolved tree does not match projection elements/pageElements",
    );
  }
}

/** Generate deterministic, app-owned Typst from one resolved document. */
export function generateTypst(
  input: TypstGenerationInput,
  options: TypstGenerationOptions = {}
): TypstGenerationResult {
  assertProjectionMatchesTree(input);
  assertMaterializedMandatoryBundledFonts(input.projection, "generateTypst");
  mandatoryBundledFontFamilies(options);
  const context: EmitContext = {
    input,
    options,
    builder: new TypstSourceBuilder(),
    findings: [],
    generatedRights: new Map<string, GeneratedRightsBlock>(),
    rightsBlockCount: 0,
  };
  addPreflightFindings(context);
  emitPreamble(context);
  for (const [index, node] of input.tree.elements.entries()) {
    if (node.element.type === "pageBreak") {
      const intent = node.element.data.intent ?? "flowBreak";
      context.builder.mapped(node.resolvedId, "body", () => {
        if (intent === "flowBreak") {
          context.builder.append("#pagebreak()\n");
        } else {
          context.builder.append("#pagebreak(weak: true)\n");
          if (index < input.tree.elements.length - 1) {
            context.builder.append("#pagebreak()\n");
          }
        }
      });
      continue;
    }
    emitNodeExpression(context, node, "body");
    context.builder.append("\n");
  }
  const built = context.builder.build();
  return {
    generatorVersion: TYPST_GENERATOR_VERSION,
    source: built.source,
    sourceMap: built.sourceMap,
    findings: context.findings,
  };
}
