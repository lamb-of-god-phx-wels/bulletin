/**
 * Exact-rational measured pagination over legal, atomic fragment descriptors.
 *
 * Measurement is deliberately outside this module. Callers adapt resolved
 * content into fragments only at break opportunities allowed by breakMatrix.
 * The paginator therefore contains no document, DOM, Typst, or renderer types.
 */

import {
  type Rational,
  add,
  cmp,
  fromInt,
  sub,
} from "../geometry/rational.js";

const ZERO = fromInt(0n);

/** Hard logical-page cap from the v1 page model. */
export const DEFAULT_PAGE_CAP = 9_999;

export type MeasuredFragmentRole =
  | "textLine"
  | "paragraph"
  | "listItem"
  | "musicContent"
  | "rightsEntry"
  | "gridRow"
  | "stackChild"
  | "customRoot"
  | "atomic";

/** One measured atom; the paginator may break before or after, never within. */
export interface MeasuredFragment {
  readonly id: string;
  readonly role: MeasuredFragmentRole;
  readonly height: Rational;
  /** Resolved stack/grid/text spacing before this atom when no page intervenes. */
  readonly gapBefore?: Rational;
  /** Number of following atoms that should remain with this one when possible. */
  readonly keepWithNext?: number;
}

export interface MeasuredFlowBlock {
  readonly kind: "block";
  readonly id: string;
  /** Unbreakable blocks must contain zero or one measured fragment. */
  readonly fragmentation: "breakable" | "unbreakable";
  readonly breakPolicy?: "auto" | "avoid";
  readonly marginBefore?: Rational;
  readonly marginAfter?: Rational;
  readonly fragments: readonly MeasuredFragment[];
}

export interface PageBreakItem {
  readonly kind: "pageBreak";
  readonly id: string;
  readonly intent: "flowBreak" | "intentionalBlank";
}

export type MeasuredFlowItem = MeasuredFlowBlock | PageBreakItem;

export interface FragmentPlacement {
  readonly blockId: string;
  readonly fragmentId: string;
  readonly fragmentRole: MeasuredFragmentRole;
  readonly fragmentIndex: number;
  readonly pageNumber: number;
  readonly y: Rational;
  readonly height: Rational;
  readonly spaceBefore: Rational;
  readonly isFirstFragment: boolean;
  readonly isLastFragment: boolean;
  /** True only for the editor's blocking clipped-error representation. */
  readonly overflow: boolean;
}

export interface PaginatedPage {
  readonly pageNumber: number;
  readonly kind: "content" | "intentionalBlank";
  readonly placements: readonly FragmentPlacement[];
  readonly usedHeight: Rational;
}

export type PaginationFinding =
  | {
      readonly kind: "avoidFallback";
      readonly severity: "warning";
      readonly blocking: false;
      readonly itemId: string;
      readonly measuredHeight: Rational;
      readonly pageContentHeight: Rational;
    }
  | {
      readonly kind: "oversizedUnbreakable";
      readonly severity: "error";
      readonly blocking: true;
      readonly itemId: string;
      readonly fragmentId: string;
      readonly pageNumber: number;
      readonly measuredHeight: Rational;
      readonly pageContentHeight: Rational;
    }
  | {
      readonly kind: "oversizedFragment";
      readonly severity: "error";
      readonly blocking: true;
      readonly itemId: string;
      readonly fragmentId: string;
      readonly fragmentRole: MeasuredFragmentRole;
      readonly pageNumber: number;
      readonly measuredHeight: Rational;
      readonly pageContentHeight: Rational;
    }
  | {
      readonly kind: "leadingFlowBreak" | "trailingFlowBreak";
      readonly severity: "warning";
      readonly blocking: false;
      readonly itemId: string;
      readonly pageNumber: number;
    }
  | {
      readonly kind: "consecutiveFlowBreak";
      readonly severity: "warning";
      readonly blocking: false;
      readonly itemId: string;
      readonly previousItemId: string;
      readonly pageNumber: number;
    }
  | {
      readonly kind: "noProgress";
      readonly severity: "error";
      readonly blocking: true;
      readonly itemId: string;
      readonly iterationLimit: number;
    }
  | {
      readonly kind: "pageCapExceeded";
      readonly severity: "error";
      readonly blocking: true;
      readonly itemId: string;
      readonly pageCap: number;
    };

export interface PaginationOptions {
  readonly pageContentHeight: Rational;
  readonly pageCap?: number;
  /** Optional lower safety limit, primarily useful to prove guard behavior. */
  readonly iterationLimit?: number;
}

export interface PaginationResult {
  readonly pages: readonly PaginatedPage[];
  readonly placements: readonly FragmentPlacement[];
  readonly findings: readonly PaginationFinding[];
  /** False only when the page-cap or no-progress guard halted consumption. */
  readonly complete: boolean;
  readonly hasBlockingFindings: boolean;
}

type ContentPageOrigin =
  | "initial"
  | "flowBreak"
  | "intentionalContinuation"
  | "naturalContinuation";

interface MutablePage {
  readonly pageNumber: number;
  readonly kind: "content" | "intentionalBlank";
  readonly origin?: ContentPageOrigin;
  readonly placements: FragmentPlacement[];
  usedHeight: Rational;
}

/** Paginate measured flow deterministically using exact rational arithmetic. */
export function paginateMeasuredFlow(
  items: readonly MeasuredFlowItem[],
  options: PaginationOptions,
): PaginationResult {
  const validated = validateInput(items, options);
  const { pageContentHeight, pageCap, iterationLimit } = validated;
  const pages: MutablePage[] = [makeContentPage(1, "initial")];
  const findings: PaginationFinding[] = [];
  let current: MutablePage | undefined = pages[0];
  let iterations = 0;
  let halted = false;

  function stopAtPageCap(itemId: string): void {
    findings.push({
      kind: "pageCapExceeded",
      severity: "error",
      blocking: true,
      itemId,
      pageCap,
    });
    halted = true;
  }

  function pushContentPage(
    origin: ContentPageOrigin,
    itemId: string,
  ): MutablePage | undefined {
    if (pages.length >= pageCap) {
      stopAtPageCap(itemId);
      return undefined;
    }
    const page = makeContentPage(pages.length + 1, origin);
    pages.push(page);
    current = page;
    return page;
  }

  function ensureCurrent(itemId: string): MutablePage | undefined {
    return current ?? pushContentPage("intentionalContinuation", itemId);
  }

  function startFreshPage(itemId: string): MutablePage | undefined {
    return pushContentPage("naturalContinuation", itemId);
  }

  function tick(itemId: string): boolean {
    iterations++;
    if (iterations <= iterationLimit) return true;
    findings.push({
      kind: "noProgress",
      severity: "error",
      blocking: true,
      itemId,
      iterationLimit,
    });
    halted = true;
    return false;
  }

  function addPlacement(
    page: MutablePage,
    block: MeasuredFlowBlock,
    fragment: MeasuredFragment,
    fragmentIndex: number,
    spaceBefore: Rational,
    overflow: boolean,
  ): void {
    const y = add(page.usedHeight, spaceBefore);
    const placement: FragmentPlacement = {
      blockId: block.id,
      fragmentId: fragment.id,
      fragmentRole: fragment.role,
      fragmentIndex,
      pageNumber: page.pageNumber,
      y,
      height: fragment.height,
      spaceBefore,
      isFirstFragment: fragmentIndex === 0,
      isLastFragment: fragmentIndex === block.fragments.length - 1,
      overflow,
    };
    page.placements.push(placement);
    page.usedHeight = add(y, fragment.height);
  }

  function applyTrailingMargin(block: MeasuredFlowBlock): void {
    if (current === undefined || current.placements.length === 0) return;
    const marginAfter = block.marginAfter ?? ZERO;
    const remaining = sub(pageContentHeight, current.usedHeight);
    if (cmp(marginAfter, remaining) <= 0) {
      current.usedHeight = add(current.usedHeight, marginAfter);
    }
  }

  function placeUnbreakable(block: MeasuredFlowBlock): void {
    const fragment = block.fragments[0];
    if (fragment === undefined) return;
    let page = ensureCurrent(block.id);
    if (page === undefined) return;

    if (cmp(fragment.height, pageContentHeight) > 0) {
      if (page.placements.length > 0) {
        page = startFreshPage(block.id);
        if (page === undefined) return;
      }
      findings.push({
        kind: "oversizedUnbreakable",
        severity: "error",
        blocking: true,
        itemId: block.id,
        fragmentId: fragment.id,
        pageNumber: page.pageNumber,
        measuredHeight: fragment.height,
        pageContentHeight,
      });
      addPlacement(page, block, fragment, 0, ZERO, true);
      return;
    }

    let spaceBefore = page.placements.length > 0
      ? block.marginBefore ?? ZERO
      : ZERO;
    const required = add(spaceBefore, fragment.height);
    if (cmp(required, remainingHeight(page, pageContentHeight)) > 0) {
      page = startFreshPage(block.id);
      if (page === undefined) return;
      spaceBefore = ZERO;
    }

    addPlacement(page, block, fragment, 0, spaceBefore, false);
    applyTrailingMargin(block);
  }

  function placeWholeBreakable(block: MeasuredFlowBlock): void {
    let page = ensureCurrent(block.id);
    if (page === undefined) return;
    const wholeHeight = measuredWholeHeight(block.fragments);
    let firstSpace = page.placements.length > 0
      ? block.marginBefore ?? ZERO
      : ZERO;
    if (
      cmp(
        add(firstSpace, wholeHeight),
        remainingHeight(page, pageContentHeight),
      ) > 0
    ) {
      page = startFreshPage(block.id);
      if (page === undefined) return;
      firstSpace = ZERO;
    }

    for (const [index, fragment] of block.fragments.entries()) {
      const spaceBefore = index === 0
        ? firstSpace
        : fragment.gapBefore ?? ZERO;
      addPlacement(page, block, fragment, index, spaceBefore, false);
    }
    applyTrailingMargin(block);
  }

  function placeBreakable(block: MeasuredFlowBlock): void {
    let lastPlacedPageNumber: number | undefined;

    for (const [index, fragment] of block.fragments.entries()) {
      if (halted || !tick(block.id)) return;
      let page = ensureCurrent(block.id);
      if (page === undefined) return;

      if (cmp(fragment.height, pageContentHeight) > 0) {
        if (page.placements.length > 0) {
          page = startFreshPage(block.id);
          if (page === undefined) return;
        }
        findings.push({
          kind: "oversizedFragment",
          severity: "error",
          blocking: true,
          itemId: block.id,
          fragmentId: fragment.id,
          fragmentRole: fragment.role,
          pageNumber: page.pageNumber,
          measuredHeight: fragment.height,
          pageContentHeight,
        });
        addPlacement(page, block, fragment, index, ZERO, true);
        lastPlacedPageNumber = page.pageNumber;
        continue;
      }

      let spaceBefore = spaceBeforeFragment(
        block,
        fragment,
        index,
        page,
        lastPlacedPageNumber,
      );
      const keepCount = fragment.keepWithNext ?? 0;
      const keepEnd = Math.min(block.fragments.length - 1, index + keepCount);
      const keptHeightOnCurrentPage = measuredRangeHeight(
        block.fragments,
        index,
        keepEnd,
        spaceBefore,
      );
      const keptHeightOnFreshPage = measuredRangeHeight(
        block.fragments,
        index,
        keepEnd,
        ZERO,
      );
      if (
        keepCount > 0 &&
        cmp(keptHeightOnFreshPage, pageContentHeight) <= 0 &&
        cmp(
          keptHeightOnCurrentPage,
          remainingHeight(page, pageContentHeight),
        ) > 0 &&
        page.placements.length > 0
      ) {
        page = startFreshPage(block.id);
        if (page === undefined) return;
        spaceBefore = ZERO;
      }

      const required = add(spaceBefore, fragment.height);
      if (cmp(required, remainingHeight(page, pageContentHeight)) > 0) {
        if (page.placements.length > 0) {
          page = startFreshPage(block.id);
          if (page === undefined) return;
        }
        // Normal margins/gaps collapse at the newly-created page boundary.
        spaceBefore = ZERO;
      }

      addPlacement(page, block, fragment, index, spaceBefore, false);
      lastPlacedPageNumber = page.pageNumber;
    }

    applyTrailingMargin(block);
  }

  function placeBlock(block: MeasuredFlowBlock): void {
    if (block.fragments.length === 0) return;

    if (block.fragmentation === "unbreakable") {
      placeUnbreakable(block);
      return;
    }

    const wholeHeight = measuredWholeHeight(block.fragments);
    if (block.breakPolicy === "avoid") {
      if (cmp(wholeHeight, pageContentHeight) <= 0) {
        placeWholeBreakable(block);
        return;
      }
      findings.push({
        kind: "avoidFallback",
        severity: "warning",
        blocking: false,
        itemId: block.id,
        measuredHeight: wholeHeight,
        pageContentHeight,
      });
    }

    placeBreakable(block);
  }

  function placeFlowBreak(
    item: PageBreakItem,
    itemIndex: number,
  ): void {
    const page = ensureCurrent(item.id);
    if (page === undefined) return;
    if (itemIndex === 0) {
      findings.push({
        kind: "leadingFlowBreak",
        severity: "warning",
        blocking: false,
        itemId: item.id,
        pageNumber: page.pageNumber,
      });
    }
    if (itemIndex === items.length - 1) {
      findings.push({
        kind: "trailingFlowBreak",
        severity: "warning",
        blocking: false,
        itemId: item.id,
        pageNumber: page.pageNumber,
      });
    }
    const previous = items[itemIndex - 1];
    if (
      previous?.kind === "pageBreak" &&
      previous.intent === "flowBreak"
    ) {
      findings.push({
        kind: "consecutiveFlowBreak",
        severity: "warning",
        blocking: false,
        itemId: item.id,
        previousItemId: previous.id,
        pageNumber: page.pageNumber,
      });
    }
    pushContentPage("flowBreak", item.id);
  }

  function placeIntentionalBlank(item: PageBreakItem): void {
    if (current !== undefined && current.placements.length === 0) {
      if (current.origin === "flowBreak") {
        // The preceding flow break already ended the prior content page and
        // left exactly the empty page this intent must label. Reuse it rather
        // than appending a second blank that Typst's weak+strong sequence does
        // not produce.
        pages[pages.length - 1] = {
          pageNumber: current.pageNumber,
          kind: "intentionalBlank",
          placements: [],
          usedHeight: ZERO,
        };
        current = undefined;
        return;
      }
      pages.pop();
      current = undefined;
    }

    if (pages.length >= pageCap) {
      stopAtPageCap(item.id);
      return;
    }
    const blank: MutablePage = {
      pageNumber: pages.length + 1,
      kind: "intentionalBlank",
      placements: [],
      usedHeight: ZERO,
    };
    pages.push(blank);
    current = undefined;
  }

  for (const [itemIndex, item] of items.entries()) {
    if (halted || !tick(item.id)) break;
    if (item.kind === "block") {
      placeBlock(item);
    } else if (item.intent === "flowBreak") {
      placeFlowBreak(item, itemIndex);
    } else {
      placeIntentionalBlank(item);
    }
  }

  const immutablePages: PaginatedPage[] = pages.map((page, index) => ({
    pageNumber: index + 1,
    kind: page.kind,
    placements: [...page.placements],
    usedHeight: page.usedHeight,
  }));
  const placements = immutablePages.flatMap((page) => page.placements);

  return {
    pages: immutablePages,
    placements,
    findings,
    complete: !halted,
    hasBlockingFindings: findings.some((finding) => finding.blocking),
  };
}

function makeContentPage(
  pageNumber: number,
  origin: ContentPageOrigin,
): MutablePage {
  return {
    pageNumber,
    kind: "content",
    origin,
    placements: [],
    usedHeight: ZERO,
  };
}

function remainingHeight(page: MutablePage, pageHeight: Rational): Rational {
  return sub(pageHeight, page.usedHeight);
}

function spaceBeforeFragment(
  block: MeasuredFlowBlock,
  fragment: MeasuredFragment,
  index: number,
  page: MutablePage,
  lastPlacedPageNumber: number | undefined,
): Rational {
  if (index === 0) {
    return page.placements.length > 0 ? block.marginBefore ?? ZERO : ZERO;
  }
  return lastPlacedPageNumber === page.pageNumber
    ? fragment.gapBefore ?? ZERO
    : ZERO;
}

function measuredWholeHeight(
  fragments: readonly MeasuredFragment[],
): Rational {
  if (fragments.length === 0) return ZERO;
  return measuredRangeHeight(fragments, 0, fragments.length - 1, ZERO);
}

function measuredRangeHeight(
  fragments: readonly MeasuredFragment[],
  start: number,
  end: number,
  firstSpace: Rational,
): Rational {
  let height = firstSpace;
  for (let index = start; index <= end; index++) {
    const fragment = fragments[index];
    if (fragment === undefined) break;
    if (index > start) height = add(height, fragment.gapBefore ?? ZERO);
    height = add(height, fragment.height);
  }
  return height;
}

function validateInput(
  items: readonly MeasuredFlowItem[],
  options: PaginationOptions,
): {
  readonly pageContentHeight: Rational;
  readonly pageCap: number;
  readonly iterationLimit: number;
} {
  assertPositiveRational(options.pageContentHeight, "pageContentHeight");
  const pageCap = options.pageCap ?? DEFAULT_PAGE_CAP;
  if (
    !Number.isInteger(pageCap) ||
    pageCap < 1 ||
    pageCap > DEFAULT_PAGE_CAP
  ) {
    throw new RangeError(
      `pageCap must be an integer from 1 through ${DEFAULT_PAGE_CAP}`,
    );
  }

  const itemIds = new Set<string>();
  let fragmentCount = 0;
  for (const item of items) {
    assertNonEmptyId(item.id, "item id");
    if (itemIds.has(item.id)) {
      throw new TypeError(`Duplicate flow item id: ${item.id}`);
    }
    itemIds.add(item.id);
    if (item.kind === "pageBreak") continue;

    assertNonNegativeRational(item.marginBefore ?? ZERO, "marginBefore");
    assertNonNegativeRational(item.marginAfter ?? ZERO, "marginAfter");
    if (item.fragmentation === "unbreakable" && item.fragments.length > 1) {
      throw new TypeError(
        `Unbreakable block ${item.id} must contain at most one fragment`,
      );
    }
    const fragmentIds = new Set<string>();
    for (const [index, fragment] of item.fragments.entries()) {
      fragmentCount++;
      assertNonEmptyId(fragment.id, "fragment id");
      if (fragmentIds.has(fragment.id)) {
        throw new TypeError(
          `Duplicate fragment id ${fragment.id} in block ${item.id}`,
        );
      }
      fragmentIds.add(fragment.id);
      assertNonNegativeRational(fragment.height, "fragment height");
      assertNonNegativeRational(fragment.gapBefore ?? ZERO, "fragment gap");
      const keepWithNext = fragment.keepWithNext ?? 0;
      if (
        !Number.isInteger(keepWithNext) ||
        keepWithNext < 0 ||
        keepWithNext > item.fragments.length - index - 1
      ) {
        throw new RangeError(
          `keepWithNext for ${item.id}/${fragment.id} exceeds following fragments`,
        );
      }
    }
  }

  const defaultIterationLimit = (items.length + fragmentCount + 1) * 4;
  const iterationLimit = options.iterationLimit ?? defaultIterationLimit;
  if (!Number.isInteger(iterationLimit) || iterationLimit < 1) {
    throw new RangeError("iterationLimit must be a positive integer");
  }

  return { pageContentHeight: options.pageContentHeight, pageCap, iterationLimit };
}

function assertNonEmptyId(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty`);
}

function assertPositiveRational(value: Rational, name: string): void {
  assertRationalDenominator(value, name);
  if (value.numerator <= 0n) {
    throw new RangeError(`${name} must be positive`);
  }
}

function assertNonNegativeRational(value: Rational, name: string): void {
  assertRationalDenominator(value, name);
  if (value.numerator < 0n) {
    throw new RangeError(`${name} must be non-negative`);
  }
}

function assertRationalDenominator(value: Rational, name: string): void {
  if (value.denominator <= 0n) {
    throw new RangeError(`${name} must have a positive denominator`);
  }
}
