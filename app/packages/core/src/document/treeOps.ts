/**
 * @cbb/core/document/treeOps — Pure tree operations on CbbDocument.
 *
 * All functions are pure: they accept a document (or element/wrapper array)
 * and return new values without mutation.
 *
 * Operations:
 *   - findById           — find any node (element or wrapper) by NodeId
 *   - buildParentMap     — map from child NodeId -> parent NodeId
 *   - collectAllNodeIds  — collect every NodeId in document tree
 *   - countNodes         — count persisted visual nodes
 *   - insertElement      — insert an element at a body position
 *   - removeElement      — remove an element by id (body only)
 *   - moveElement        — reorder within body elements
 *   - remintIds          — re-mint all ids in a subtree using an IdPort
 *
 * Spec references:
 *   spec.md §Container Child Wrappers (2824-2856) — id namespace rules
 *   spec.md §Document Model (1465-1640) — tree invariants
 *   spec.md §Size, Performance, And Resource Limits (6017-6107)
 */

import type { IdPort } from "../ids/index.js";
import type {
  CbbDocument,
  NativeElement,
  NodeId,
  GridChildWrapper,
  StackChildWrapper,
  CanvasChildWrapper,
  PageLevelWrapper,
} from "./types.js";
import { DOCUMENT_LIMITS } from "./types.js";

// ---------------------------------------------------------------------------
// NodeRef — a found node plus its location
// ---------------------------------------------------------------------------

export type NodeLocation =
  | { readonly kind: "bodyElement"; readonly index: number }
  | {
      readonly kind: "gridChild";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | {
      readonly kind: "stackChild";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | {
      readonly kind: "canvasChild";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | { readonly kind: "pageElement"; readonly wrapperIndex: number }
  | {
      readonly kind: "pageElementChild";
      readonly wrapperIndex: number;
    }
  | {
      readonly kind: "gridWrapper";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | {
      readonly kind: "stackWrapper";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | {
      readonly kind: "canvasWrapper";
      readonly parentId: NodeId;
      readonly wrapperIndex: number;
    }
  | { readonly kind: "pageLevelWrapper"; readonly index: number }
  | { readonly kind: "customDefinition"; readonly index: number }
  | {
      readonly kind: "customDefinitionElement";
      readonly definitionIndex: number;
      readonly elementIndex: number;
    };

export interface NodeRef {
  readonly id: NodeId;
  readonly location: NodeLocation;
}

// ---------------------------------------------------------------------------
// Internal recursive visitor
// ---------------------------------------------------------------------------

type Visitor = (id: NodeId, location: NodeLocation) => boolean; // return true to stop

function visitElement(
  el: NativeElement,
  location: NodeLocation,
  visitor: Visitor
): boolean {
  if (visitor(el.id, location)) return true;

  if (el.type === "grid") {
    for (const [wi, wrap] of el.children.entries()) {
      const wrapLoc: NodeLocation = {
        kind: "gridWrapper",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitor(wrap.id, wrapLoc)) return true;
      const childLoc: NodeLocation = {
        kind: "gridChild",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitElement(wrap.element, childLoc, visitor)) return true;
    }
  } else if (el.type === "stack") {
    for (const [wi, wrap] of el.children.entries()) {
      const wrapLoc: NodeLocation = {
        kind: "stackWrapper",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitor(wrap.id, wrapLoc)) return true;
      const childLoc: NodeLocation = {
        kind: "stackChild",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitElement(wrap.element, childLoc, visitor)) return true;
    }
  } else if (el.type === "canvas") {
    for (const [wi, wrap] of el.children.entries()) {
      const wrapLoc: NodeLocation = {
        kind: "canvasWrapper",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitor(wrap.id, wrapLoc)) return true;
      const childLoc: NodeLocation = {
        kind: "canvasChild",
        parentId: el.id,
        wrapperIndex: wi,
      };
      if (visitElement(wrap.element, childLoc, visitor)) return true;
    }
  }

  return false;
}

function visitDocument(doc: CbbDocument, visitor: Visitor): void {
  for (const [i, el] of doc.elements.entries()) {
    const loc: NodeLocation = { kind: "bodyElement", index: i };
    if (visitElement(el, loc, visitor)) return;
  }

  const pageElements = doc.pageElements ?? [];
  for (const [i, wrapper] of pageElements.entries()) {
    const wrapLoc: NodeLocation = { kind: "pageLevelWrapper", index: i };
    if (visitor(wrapper.id, wrapLoc)) return;
    const elLoc: NodeLocation = { kind: "pageElementChild", wrapperIndex: i };
    if (visitElement(wrapper.element, elLoc, visitor)) return;
  }

  for (const [definitionIndex, definition] of (
    doc.customElementDefinitions ?? []
  ).entries()) {
    const definitionLoc: NodeLocation = {
      kind: "customDefinition",
      index: definitionIndex,
    };
    if (visitor(definition.id, definitionLoc)) return;
    for (const [elementIndex, element] of definition.elements.entries()) {
      const elementLoc: NodeLocation = {
        kind: "customDefinitionElement",
        definitionIndex,
        elementIndex,
      };
      if (visitElement(element, elementLoc, visitor)) return;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find any node (element or wrapper) by NodeId in the full document tree.
 * Returns undefined if not found.
 * O(n) in node count.
 */
export function findById(
  doc: CbbDocument,
  id: NodeId
): NodeRef | undefined {
  let found: NodeRef | undefined;

  visitDocument(doc, (nodeId, location) => {
    if (nodeId === id) {
      found = { id: nodeId, location };
      return true;
    }
    return false;
  });

  return found;
}

/**
 * Build a map from every child NodeId -> its parent NodeId.
 * Body-root elements have no parent (absent from the map).
 * Page-level wrapper children map to their wrapper id.
 * Container wrappers map to their container element id.
 * Container children map to their wrapper id.
 */
export function buildParentMap(
  doc: CbbDocument
): ReadonlyMap<NodeId, NodeId> {
  const map = new Map<NodeId, NodeId>();

  for (const el of doc.elements) {
    addParentsFromElement(el, undefined, map);
  }

  const pageElements = doc.pageElements ?? [];
  for (const pw of pageElements) {
    // Page-level element's root -> placement wrapper; nested container
    // descendants retain the same wrapper/element parent semantics as body
    // containers.
    addParentsFromElement(pw.element, pw.id, map);
  }

  for (const definition of doc.customElementDefinitions ?? []) {
    for (const element of definition.elements) {
      addParentsFromElement(element, definition.id, map);
    }
  }

  return map;
}

function addParentsFromElement(
  el: NativeElement,
  parentId: NodeId | undefined,
  map: Map<NodeId, NodeId>
): void {
  if (parentId !== undefined) {
    map.set(el.id, parentId);
  }

  if (el.type === "grid") {
    for (const wrap of el.children) {
      // Wrapper -> container element
      map.set(wrap.id, el.id);
      // Child element -> wrapper
      addParentsFromElement(wrap.element, wrap.id, map);
    }
  } else if (el.type === "stack") {
    for (const wrap of el.children) {
      map.set(wrap.id, el.id);
      addParentsFromElement(wrap.element, wrap.id, map);
    }
  } else if (el.type === "canvas") {
    for (const wrap of el.children) {
      map.set(wrap.id, el.id);
      addParentsFromElement(wrap.element, wrap.id, map);
    }
  }
}

/**
 * Collect every NodeId in the document tree into a Set.
 * Includes body/page/custom-definition element ids and every wrapper id in
 * the one document-global namespace.
 */
export function collectAllNodeIds(doc: CbbDocument): ReadonlySet<NodeId> {
  const ids = new Set<NodeId>();

  visitDocument(doc, (id) => {
    ids.add(id);
    return false;
  });

  return ids;
}

/**
 * Count total persisted visual nodes (definitions, elements, and wrappers,
 * recursively).
 * Used to enforce DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP.
 */
export function countNodes(doc: CbbDocument): number {
  let count = 0;

  visitDocument(doc, () => {
    count++;
    return false;
  });

  return count;
}

/**
 * Check whether the node count is within limits.
 * Returns { ok: true } or { ok: false, count, limit }.
 */
export function checkNodeLimit(
  doc: CbbDocument
): { ok: true } | { ok: false; count: number; limit: number } {
  const count = countNodes(doc);
  if (count > DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP) {
    return {
      ok: false,
      count,
      limit: DOCUMENT_LIMITS.PERSISTED_VISUAL_NODES_CAP,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Insert / remove / move body elements
// ---------------------------------------------------------------------------

/**
 * Insert an element into doc.elements at the given zero-based index.
 * Returns a new CbbDocument with the element inserted; does not mutate.
 *
 * @throws Error if the resulting node count exceeds the hard cap.
 * @throws Error if the element's id already exists in the document.
 */
export function insertElement(
  doc: CbbDocument,
  element: NativeElement,
  atIndex: number
): CbbDocument {
  // Collision check
  const existing = collectAllNodeIds(doc);
  collectNodeIdsFromElement(element, existing, true);

  // Build new array
  const elements = [...doc.elements];
  const clampedIndex = Math.max(0, Math.min(atIndex, elements.length));
  elements.splice(clampedIndex, 0, element);

  const next: CbbDocument = { ...doc, elements };

  // Limit check
  const limitResult = checkNodeLimit(next);
  if (!limitResult.ok) {
    throw new Error(
      `Insert would exceed persisted visual node cap ` +
        `(${limitResult.count} > ${limitResult.limit})`
    );
  }

  return next;
}

/**
 * Collect all NodeIds from an element tree.
 * If checkCollision is true, throws on any id that already exists in the set.
 */
function collectNodeIdsFromElement(
  el: NativeElement,
  existing: Set<NodeId> | ReadonlySet<NodeId>,
  checkCollision: boolean
): void {
  const mutable = existing as Set<NodeId>;

  function check(id: NodeId): void {
    if (checkCollision && mutable.has(id)) {
      throw new Error(
        `Node id collision: "${id}" already exists in the document`
      );
    }
    mutable.add(id);
  }

  check(el.id);

  if (el.type === "grid") {
    for (const wrap of el.children) {
      check(wrap.id);
      collectNodeIdsFromElement(wrap.element, mutable, checkCollision);
    }
  } else if (el.type === "stack") {
    for (const wrap of el.children) {
      check(wrap.id);
      collectNodeIdsFromElement(wrap.element, mutable, checkCollision);
    }
  } else if (el.type === "canvas") {
    for (const wrap of el.children) {
      check(wrap.id);
      collectNodeIdsFromElement(wrap.element, mutable, checkCollision);
    }
  }
}

/**
 * Remove the body element with the given id from doc.elements.
 * Returns a new CbbDocument with the element removed; does not mutate.
 *
 * @throws Error if the id is not found in the top-level body elements.
 */
export function removeElement(
  doc: CbbDocument,
  id: NodeId
): CbbDocument {
  const index = doc.elements.findIndex((el) => el.id === id);
  if (index === -1) {
    throw new Error(
      `removeElement: element "${id}" not found in doc.elements`
    );
  }

  const elements = [
    ...doc.elements.slice(0, index),
    ...doc.elements.slice(index + 1),
  ];

  return { ...doc, elements };
}

/**
 * Move the body element at fromIndex to toIndex in doc.elements.
 * Returns a new CbbDocument; does not mutate.
 *
 * Both indices are clamped to valid bounds.
 */
export function moveElement(
  doc: CbbDocument,
  fromIndex: number,
  toIndex: number
): CbbDocument {
  const elements = [...doc.elements];
  const len = elements.length;

  if (len === 0) return doc;

  const from = Math.max(0, Math.min(fromIndex, len - 1));
  const to = Math.max(0, Math.min(toIndex, len - 1));

  if (from === to) return doc;

  const moved = elements[from];
  if (moved === undefined) return doc;

  elements.splice(from, 1);
  elements.splice(to, 0, moved);

  return { ...doc, elements };
}

// ---------------------------------------------------------------------------
// Id re-minting (collision avoidance on copy/paste/import)
// ---------------------------------------------------------------------------

/**
 * Re-mint all NodeIds in a subtree using the given IdPort.
 *
 * Returns a new NativeElement tree with fresh ids. The id generation is
 * sequential and deterministic given the IdPort's sequence: the element's
 * own id is minted first (DFS pre-order), then each child wrapper, then
 * each child element recursively.
 *
 * The existing set is used to skip ids that don't collide — only collision
 * ids are re-minted unless forceRemint is enabled.
 *
 * Spec: spec.md §Document Model (1392-1465) — element-id collision re-mint
 * rules on copy/paste.
 *
 * @param element    The root element of the subtree to re-mint.
 * @param existingIds  Set of ids currently in the document.
 * @param idPort     Injected UUID minter.
 * @param forceRemint When true, always generate new ids regardless of
 *                   collision (use when duplicating a subtree).
 */
export function remintIds(
  element: NativeElement,
  existingIds: ReadonlySet<NodeId>,
  idPort: IdPort,
  forceRemint = false
): NativeElement {
  const usedIds = new Set<NodeId>(existingIds);
  return remintElementIds(element, usedIds, idPort, forceRemint);
}

function generateFreshId(
  base: NodeId,
  usedIds: Set<NodeId>,
  idPort: IdPort
): NodeId {
  // First try the existing id (if not in usedIds)
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  return mintUniqueNodeId(usedIds, idPort);
}

/**
 * Mint a schema-valid NodeId while retaining all 128 bits from the UUID.
 * UUID hyphens are unnecessary because NodeId has its own lexical contract;
 * the leading letter makes every UUID-derived value valid even when the UUID
 * starts with a decimal digit.
 */
function mintUniqueNodeId(
  usedIds: Set<NodeId>,
  idPort: IdPort
): NodeId {
  let candidate: NodeId;
  do {
    candidate = `n${idPort.randomUuid().replace(/-/g, "")}`;
  } while (usedIds.has(candidate));

  usedIds.add(candidate);
  return candidate;
}

function remintElementIds(
  el: NativeElement,
  usedIds: Set<NodeId>,
  idPort: IdPort,
  forceRemint: boolean
): NativeElement {
  const newId = forceRemint
    ? mintUniqueNodeId(usedIds, idPort)
    : generateFreshId(el.id, usedIds, idPort);

  if (el.type === "grid") {
    const children: GridChildWrapper[] = el.children.map((wrap) => {
      const newWrapId = forceRemint
        ? mintUniqueNodeId(usedIds, idPort)
        : generateFreshId(wrap.id, usedIds, idPort);
      return {
        ...wrap,
        id: newWrapId,
        element: remintElementIds(wrap.element, usedIds, idPort, forceRemint),
      };
    });
    return { ...el, id: newId, children };
  }

  if (el.type === "stack") {
    const children: StackChildWrapper[] = el.children.map((wrap) => {
      const newWrapId = forceRemint
        ? mintUniqueNodeId(usedIds, idPort)
        : generateFreshId(wrap.id, usedIds, idPort);
      return {
        ...wrap,
        id: newWrapId,
        element: remintElementIds(wrap.element, usedIds, idPort, forceRemint),
      };
    });
    return { ...el, id: newId, children };
  }

  if (el.type === "canvas") {
    const children: CanvasChildWrapper[] = el.children.map((wrap) => {
      const newWrapId = forceRemint
        ? mintUniqueNodeId(usedIds, idPort)
        : generateFreshId(wrap.id, usedIds, idPort);
      return {
        ...wrap,
        id: newWrapId,
        element: remintElementIds(wrap.element, usedIds, idPort, forceRemint),
      };
    });
    return { ...el, id: newId, children };
  }

  return { ...el, id: newId };
}

// ---------------------------------------------------------------------------
// Container nesting depth check
// ---------------------------------------------------------------------------

/**
 * Compute the maximum container nesting depth in the given elements array.
 * A leaf element has depth 0; each nested container level adds 1.
 */
export function maxContainerDepth(elements: readonly NativeElement[]): number {
  function depthOf(el: NativeElement): number {
    if (el.type === "grid") {
      const childDepths = el.children.map((w) => depthOf(w.element));
      const maxChild = childDepths.length > 0 ? Math.max(...childDepths) : 0;
      return 1 + maxChild;
    }
    if (el.type === "stack") {
      const childDepths = el.children.map((w) => depthOf(w.element));
      const maxChild = childDepths.length > 0 ? Math.max(...childDepths) : 0;
      return 1 + maxChild;
    }
    if (el.type === "canvas") {
      const childDepths = el.children.map((w) => depthOf(w.element));
      const maxChild = childDepths.length > 0 ? Math.max(...childDepths) : 0;
      return 1 + maxChild;
    }
    return 0;
  }

  if (elements.length === 0) return 0;
  return Math.max(...elements.map(depthOf));
}

/**
 * Check container nesting depth against limits.
 */
export function checkContainerDepth(
  doc: CbbDocument
): { ok: true } | { ok: false; depth: number; limit: number } {
  const pageRoots = (doc.pageElements ?? []).map((entry) => entry.element);
  const definitionRoots = (doc.customElementDefinitions ?? []).flatMap(
    (definition) => definition.elements,
  );
  const depth = Math.max(
    maxContainerDepth(doc.elements),
    maxContainerDepth(pageRoots),
    maxContainerDepth(definitionRoots),
  );
  if (depth > DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP) {
    return {
      ok: false,
      depth,
      limit: DOCUMENT_LIMITS.CONTAINER_NESTING_DEPTH_CAP,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Uniqueness check
// ---------------------------------------------------------------------------

/**
 * Check that all NodeIds in the document tree are unique.
 * Returns first duplicate id found, or undefined if all unique.
 */
export function findDuplicateNodeId(doc: CbbDocument): NodeId | undefined {
  const seen = new Set<NodeId>();
  let duplicate: NodeId | undefined;

  visitDocument(doc, (id) => {
    if (seen.has(id)) {
      duplicate = id;
      return true;
    }
    seen.add(id);
    return false;
  });

  return duplicate;
}

// Re-export PageLevelWrapper for callers that need it from treeOps
export type { PageLevelWrapper };
