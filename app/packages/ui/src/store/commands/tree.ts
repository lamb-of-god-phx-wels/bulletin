import type {
  CanvasChildWrapper,
  CanvasElement,
  CbbDocument,
  GridChildWrapper,
  GridElement,
  NativeElement,
  PageLevelWrapper,
  StackChildWrapper,
  StackElement,
} from "@cbb/core";

export type ContainerElement = GridElement | StackElement | CanvasElement;
export type ContainerWrapper =
  | GridChildWrapper
  | StackChildWrapper
  | CanvasChildWrapper;

export type ElementParent =
  | { readonly kind: "body"; readonly index: number }
  | {
      readonly kind: "grid";
      readonly containerId: string;
      readonly wrapper: GridChildWrapper;
      readonly wrapperIndex: number;
      readonly wrapperPath: string;
    }
  | {
      readonly kind: "stack";
      readonly containerId: string;
      readonly wrapper: StackChildWrapper;
      readonly wrapperIndex: number;
      readonly wrapperPath: string;
    }
  | {
      readonly kind: "canvas";
      readonly containerId: string;
      readonly wrapper: CanvasChildWrapper;
      readonly wrapperIndex: number;
      readonly wrapperPath: string;
    }
  | {
      readonly kind: "page";
      readonly wrapper: PageLevelWrapper;
      readonly wrapperIndex: number;
      readonly wrapperPath: string;
    };

export interface ElementLocation {
  readonly element: NativeElement;
  readonly elementPath: string;
  readonly parent: ElementParent;
}

export interface ContainerLocation {
  readonly container: ContainerElement;
  readonly elementPath: string;
}

export type PlacementWrapperLocation =
  | {
      readonly kind: "grid";
      readonly wrapper: GridChildWrapper;
      readonly wrapperPath: string;
      readonly containerId: string;
    }
  | {
      readonly kind: "stack";
      readonly wrapper: StackChildWrapper;
      readonly wrapperPath: string;
      readonly containerId: string;
    }
  | {
      readonly kind: "canvas";
      readonly wrapper: CanvasChildWrapper;
      readonly wrapperPath: string;
      readonly containerId: string;
    }
  | {
      readonly kind: "page";
      readonly wrapper: PageLevelWrapper;
      readonly wrapperPath: string;
    };

function findWrapperInElement(
  element: NativeElement,
  elementPath: string,
  wrapperId: string,
): PlacementWrapperLocation | undefined {
  if (element.type !== "grid" && element.type !== "stack" && element.type !== "canvas") {
    return undefined;
  }
  for (const [index, wrapper] of element.children.entries()) {
    const wrapperPath = `${elementPath}/children/${index}`;
    if (wrapper.id === wrapperId) {
      return {
        kind: element.type,
        wrapper,
        wrapperPath,
        containerId: element.id,
      } as PlacementWrapperLocation;
    }
    const nested = findWrapperInElement(wrapper.element, `${wrapperPath}/element`, wrapperId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function findInElement(
  element: NativeElement,
  elementPath: string,
  parent: ElementParent,
  nodeId: string,
): ElementLocation | undefined {
  if (element.id === nodeId) return { element, elementPath, parent };
  if (
    element.type !== "grid" &&
    element.type !== "stack" &&
    element.type !== "canvas"
  ) {
    return undefined;
  }
  for (const [wrapperIndex, wrapper] of element.children.entries()) {
    const wrapperPath = `${elementPath}/children/${wrapperIndex}`;
    const childParent = {
      kind: element.type,
      containerId: element.id,
      wrapper,
      wrapperIndex,
      wrapperPath,
    } as ElementParent;
    const found = findInElement(
      wrapper.element,
      `${wrapperPath}/element`,
      childParent,
      nodeId,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

export function findElementLocation(
  document: CbbDocument,
  nodeId: string,
): ElementLocation | undefined {
  for (const [index, element] of document.elements.entries()) {
    const found = findInElement(
      element,
      `/elements/${index}`,
      { kind: "body", index },
      nodeId,
    );
    if (found !== undefined) return found;
  }
  for (const [wrapperIndex, wrapper] of (document.pageElements ?? []).entries()) {
    const wrapperPath = `/pageElements/${wrapperIndex}`;
    const found = findInElement(
      wrapper.element,
      `${wrapperPath}/element`,
      { kind: "page", wrapper, wrapperIndex, wrapperPath },
      nodeId,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

export function findContainerLocation(
  document: CbbDocument,
  containerId: string,
): ContainerLocation | undefined {
  const location = findElementLocation(document, containerId);
  if (
    location === undefined ||
    (location.element.type !== "grid" &&
      location.element.type !== "stack" &&
      location.element.type !== "canvas")
  ) {
    return undefined;
  }
  return { container: location.element, elementPath: location.elementPath };
}

/** Locate a placement wrapper independently from the native node it owns. */
export function findPlacementWrapperLocation(
  document: CbbDocument,
  wrapperId: string,
): PlacementWrapperLocation | undefined {
  for (const [index, element] of document.elements.entries()) {
    const found = findWrapperInElement(element, `/elements/${index}`, wrapperId);
    if (found !== undefined) return found;
  }
  for (const [index, wrapper] of (document.pageElements ?? []).entries()) {
    const wrapperPath = `/pageElements/${index}`;
    if (wrapper.id === wrapperId) {
      return { kind: "page", wrapper, wrapperPath };
    }
    const nested = findWrapperInElement(wrapper.element, `${wrapperPath}/element`, wrapperId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function selectionForNode(nodeId: string) {
  return { kind: "node" as const, nodeId, surface: "editor" as const };
}
