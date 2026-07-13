import {
  generateRightsBlock,
  resolveDocument,
  type CbbDocument,
  type NativeElement,
  type NodeId,
  type PageLevelWrapper,
  type ResolvedElement,
  type ResolvedNode,
  type ResolvedPageElement,
  type TextContent,
} from "@cbb/core";

export type EditorGeneratedRightsBlock = ReturnType<typeof generateRightsBlock>;

export interface EditorRenderNode {
  /** Unique for one resolved occurrence; direct, unexpanded nodes retain their source id. */
  readonly renderId: string;
  readonly sourceNodeId: NodeId;
  readonly element: NativeElement;
  readonly derived: boolean;
  readonly contextLabel?: string | undefined;
}

export interface EditorRenderPageElement {
  readonly renderId: string;
  readonly wrapper: PageLevelWrapper;
}

export interface EditorRenderModel {
  readonly elements: readonly EditorRenderNode[];
  readonly pageElements: readonly EditorRenderPageElement[];
  readonly rightsBlocks: Readonly<Record<NodeId, EditorGeneratedRightsBlock>>;
  readonly findings: readonly string[];
}

function sourceIndex(document: CbbDocument): ReadonlyMap<NodeId, NativeElement> {
  const result = new Map<NodeId, NativeElement>();
  const visit = (element: NativeElement): void => {
    result.set(element.id, element);
    if (element.type === "grid" || element.type === "stack" || element.type === "canvas") {
      for (const child of element.children) visit(child.element);
    }
  };
  for (const element of document.elements) visit(element);
  for (const wrapper of document.pageElements ?? []) visit(wrapper.element);
  for (const definition of document.customElementDefinitions ?? []) {
    for (const element of definition.elements) visit(element);
  }
  return result;
}

function syntheticSource(node: ResolvedNode): NativeElement {
  const common = {
    id: node.provenance.sourceElementId,
    name: "Resolved content",
  };
  switch (node.element.type) {
    case "text":
      return { ...common, type: "text", data: { content: { kind: "plain", text: "" } } };
    case "image":
      return { ...common, type: "image", data: node.element.data };
    case "date":
      return { ...common, type: "date", data: node.element.data };
    case "music":
      return {
        ...common,
        type: "music",
        data: {
          title: node.element.data.title,
          rights: [],
          rightsAssociationReview: {
            reviewedSongContentHash: "0".repeat(64),
            reviewedRightsProjectionHash: "0".repeat(64),
            reviewTime: "1970-01-01T00:00:00Z",
          },
        },
      } as NativeElement;
    case "rightsAttribution":
      return { ...common, type: "rightsAttribution", data: node.element.data };
    case "pageBreak":
      return { ...common, type: "pageBreak", data: node.element.data };
    case "grid":
      return { ...common, type: "grid", data: node.element.data, children: [] };
    case "stack":
      return { ...common, type: "stack", data: node.element.data, children: [] };
    case "canvas":
      return { ...common, type: "canvas", children: [] };
  }
}

function renderId(node: ResolvedNode): string {
  return node.provenance.kind === "direct" && node.provenance.expansions.length === 0
    ? node.provenance.sourceElementId
    : node.resolvedId;
}

function materializeNode(
  node: ResolvedNode,
  sources: ReadonlyMap<NodeId, NativeElement>,
): EditorRenderNode {
  const source = sources.get(node.provenance.sourceElementId) ?? syntheticSource(node);
  const repeat = [...node.provenance.expansions].reverse().find((entry) => entry.kind === "repeat");
  const custom = [...node.provenance.expansions].reverse().find((entry) => entry.kind === "custom");
  return {
    renderId: renderId(node),
    sourceNodeId: node.provenance.sourceElementId,
    derived: node.provenance.expansions.length > 0,
    ...(repeat?.kind === "repeat"
      ? { contextLabel: `Repeat item ${repeat.itemIndex + 1}` }
      : custom?.kind === "custom" ? { contextLabel: "Saved Section occurrence" } : {}),
    element: materializeElement(source, node.element, sources),
  };
}

function materializeElement(
  source: NativeElement,
  resolved: ResolvedElement,
  sources: ReadonlyMap<NodeId, NativeElement>,
): NativeElement {
  const flow = {
    ...(resolved.width === undefined ? {} : { width: resolved.width }),
    ...(resolved.height === undefined ? {} : { height: resolved.height }),
    ...(resolved.breakPolicy === undefined ? {} : { breakPolicy: resolved.breakPolicy }),
    ...(resolved.margin === undefined ? {} : { margin: resolved.margin }),
    ...(resolved.padding === undefined ? {} : { padding: resolved.padding }),
    ...(resolved.style === undefined ? {} : { style: resolved.style }),
  };
  const common = { ...source, ...flow, type: resolved.type };
  switch (resolved.type) {
    case "text":
      return {
        ...common,
        type: "text",
        data: { content: resolved.data.content as unknown as TextContent },
      };
    case "image":
      return { ...common, type: "image", data: resolved.data };
    case "date":
      return { ...common, type: "date", data: resolved.data };
    case "music": {
      const sourceMusic = source.type === "music" ? source : undefined;
      return {
        ...common,
        type: "music",
        data: {
          ...sourceMusic?.data,
          ...resolved.data,
          ...(resolved.data.richContent === undefined
            ? {}
            : { richContent: resolved.data.richContent as unknown as NonNullable<Extract<NativeElement, { type: "music" }>["data"]["richContent"]> }),
        },
      } as NativeElement;
    }
    case "rightsAttribution":
      return { ...common, type: "rightsAttribution", data: resolved.data };
    case "pageBreak":
      return { ...common, type: "pageBreak", data: resolved.data };
    case "grid": {
      const sourceGrid = source.type === "grid" ? source : undefined;
      return {
        ...common,
        type: "grid",
        data: resolved.data,
        children: resolved.children.map((child) => {
          const childSource = sources.get(child.provenance.sourceElementId) ?? syntheticSource(child.element);
          const sourceWrapper = sourceGrid?.children.find((candidate) =>
            candidate.element.id === child.provenance.sourceElementId
          );
          return {
            id: sourceWrapper?.id ?? child.resolvedId,
            row: child.row,
            column: child.column,
            ...(sourceWrapper?.authoringPolicy === undefined ? {} : { authoringPolicy: sourceWrapper.authoringPolicy }),
            element: materializeElement(childSource, child.element.element, sources),
          };
        }),
      };
    }
    case "stack": {
      const sourceStack = source.type === "stack" ? source : undefined;
      return {
        ...common,
        type: "stack",
        data: resolved.data,
        children: resolved.children.map((child) => {
          const childSource = sources.get(child.provenance.sourceElementId) ?? syntheticSource(child.element);
          const sourceWrapper = sourceStack?.children.find((candidate) =>
            candidate.element.id === child.provenance.sourceElementId
          );
          return {
            id: sourceWrapper?.id ?? child.resolvedId,
            index: child.index,
            ...(sourceWrapper?.authoringPolicy === undefined ? {} : { authoringPolicy: sourceWrapper.authoringPolicy }),
            element: materializeElement(childSource, child.element.element, sources),
          };
        }),
      };
    }
    case "canvas": {
      const sourceCanvas = source.type === "canvas" ? source : undefined;
      return {
        ...common,
        type: "canvas",
        children: resolved.children.map((child) => {
          const childSource = sources.get(child.provenance.sourceElementId) ?? syntheticSource(child.element);
          const sourceWrapper = sourceCanvas?.children.find((candidate) =>
            candidate.element.id === child.provenance.sourceElementId
          );
          return {
            id: sourceWrapper?.id ?? child.resolvedId,
            x: child.x,
            y: child.y,
            ...(child.semanticOrder === undefined ? {} : { semanticOrder: child.semanticOrder }),
            ...(sourceWrapper?.authoringPolicy === undefined ? {} : { authoringPolicy: sourceWrapper.authoringPolicy }),
            element: materializeElement(childSource, child.element.element, sources),
          };
        }),
      };
    }
  }
}

function materializePageElement(
  entry: ResolvedPageElement,
  document: CbbDocument,
  sources: ReadonlyMap<NodeId, NativeElement>,
): EditorRenderPageElement {
  const source = sources.get(entry.element.provenance.sourceElementId) ?? syntheticSource(entry.element);
  const sourceWrapper = (document.pageElements ?? []).find((candidate) =>
    candidate.id === entry.provenance.sourceElementId
  );
  return {
    renderId: entry.resolvedId,
    wrapper: {
      id: sourceWrapper?.id ?? entry.resolvedId,
      purpose: entry.purpose,
      target: entry.target,
      layer: entry.layer,
      region: entry.region,
      anchor: entry.anchor,
      x: entry.x,
      y: entry.y,
      width: entry.width,
      height: entry.height,
      zIndex: entry.zIndex,
      clipToRegion: entry.clipToRegion,
      semantic: entry.semantic,
      ...(sourceWrapper?.authoringPolicy === undefined ? {} : { authoringPolicy: sourceWrapper.authoringPolicy }),
      element: materializeElement(source, entry.element.element, sources) as PageLevelWrapper["element"],
    },
  };
}

function rawFallback(document: CbbDocument, message: string): EditorRenderModel {
  return {
    elements: document.elements.map((element) => ({
      renderId: element.id,
      sourceNodeId: element.id,
      element,
      derived: false,
    })),
    pageElements: (document.pageElements ?? []).map((wrapper) => ({ renderId: wrapper.id, wrapper })),
    rightsBlocks: {},
    findings: [message],
  };
}

export function createEditorRenderModel(document: CbbDocument): EditorRenderModel {
  try {
    const sources = sourceIndex(document);
    const result = resolveDocument(document, { verifyDefinitionHashes: false });
    const rightsBlocks: Record<NodeId, EditorGeneratedRightsBlock> = {};
    const collectRights = (node: ResolvedNode): void => {
      if (node.element.type === "rightsAttribution") {
        rightsBlocks[node.provenance.sourceElementId] = generateRightsBlock(
          node.element,
          result.rightsContributions,
        );
      }
      if (node.element.type === "grid" || node.element.type === "stack" || node.element.type === "canvas") {
        for (const child of node.element.children) collectRights(child.element);
      }
    };
    for (const node of result.tree.elements) collectRights(node);
    for (const entry of result.tree.pageElements) collectRights(entry.element);
    return {
      elements: result.tree.elements.map((node) => materializeNode(node, sources)),
      pageElements: result.tree.pageElements.map((entry) =>
        materializePageElement(entry, document, sources)
      ),
      rightsBlocks,
      findings: [
        ...result.findings.map((finding) => finding.message),
        ...Object.values(rightsBlocks).flatMap((block) => block.findings.map((finding) => finding.message)),
      ],
    };
  } catch (error) {
    return rawFallback(
      document,
      error instanceof Error ? error.message : "The resolved preview could not be produced.",
    );
  }
}
