import { canonicalStringify, hashCanonical } from "../canonical/index.js";
import type {
  CustomElementDefinition,
  NativeElement,
  NodeId,
  PageLevelWrapper,
  Sha256HashString,
} from "./types.js";

type DefinitionHashInput = Omit<CustomElementDefinition, "definitionHash"> & {
  readonly definitionHash?: Sha256HashString;
};

export interface CustomDefinitionRevisionSet {
  readonly definitions: readonly CustomElementDefinition[];
  readonly elements: readonly NativeElement[];
  readonly pageElements?: readonly PageLevelWrapper[];
}

function positiveRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function withoutDefinitionHash(
  definition: DefinitionHashInput,
): Omit<CustomElementDefinition, "definitionHash"> {
  const { definitionHash: _selfHash, ...projected } = definition;
  return projected;
}

function definitionMeaning(definition: DefinitionHashInput): unknown {
  const {
    definitionHash: _selfHash,
    definitionVersion: _revision,
    ...projected
  } = definition;
  return projected;
}

/**
 * Hash one exact custom-definition revision without recursively hashing its
 * own `definitionHash` property. Nested instance pins and values remain in the
 * projection because both affect the containing definition's resolved output.
 */
export function customElementDefinitionHash(
  definition: DefinitionHashInput,
): Sha256HashString {
  positiveRevision(definition.definitionVersion, "definitionVersion");
  return hashCanonical(withoutDefinitionHash(definition)) as Sha256HashString;
}

function mapElement(
  element: NativeElement,
  transform: (element: NativeElement) => NativeElement,
): NativeElement {
  const nested = element.type === "grid" || element.type === "stack" || element.type === "canvas"
    ? {
        ...element,
        children: element.children.map((wrapper) => ({
          ...wrapper,
          element: mapElement(wrapper.element, transform),
        })),
      } as NativeElement
    : element;
  return transform(nested);
}

function mapElements(
  elements: readonly NativeElement[],
  transform: (element: NativeElement) => NativeElement,
): readonly NativeElement[] {
  return elements.map((element) => mapElement(element, transform));
}

function definitionMap(
  definitions: readonly CustomElementDefinition[],
  label: string,
): ReadonlyMap<NodeId, CustomElementDefinition> {
  const output = new Map<NodeId, CustomElementDefinition>();
  for (const definition of definitions) {
    if (output.has(definition.id)) {
      throw new TypeError(`${label} contains duplicate definition id ${definition.id}`);
    }
    output.set(definition.id, definition);
  }
  return output;
}

function sameMeaning(
  left: DefinitionHashInput,
  right: DefinitionHashInput,
): boolean {
  return canonicalStringify(definitionMeaning(left)) ===
    canonicalStringify(definitionMeaning(right));
}

/**
 * Finalize one atomic definition edit.
 *
 * Dependencies are finalized bottom-up. Each changed existing definition is
 * bumped exactly once, new definitions start at revision 1, and every nested,
 * body, and page instance is repinned to the resulting id/version/hash tuple.
 * Missing definitions and dependency cycles fail closed.
 */
export function finalizeCustomDefinitionRevisions(
  previous: CustomDefinitionRevisionSet | undefined,
  edited: CustomDefinitionRevisionSet,
): CustomDefinitionRevisionSet {
  const previousById = definitionMap(previous?.definitions ?? [], "Previous document");
  const editedById = definitionMap(edited.definitions, "Edited document");

  for (const definition of previousById.values()) {
    positiveRevision(definition.definitionVersion, `Definition ${definition.id} revision`);
    if (customElementDefinitionHash(definition) !== definition.definitionHash) {
      throw new TypeError(`Previous definition ${definition.id} has an invalid self-hash`);
    }
  }

  const validatedPrevious = new Set<NodeId>();
  const validatingPrevious = new Set<NodeId>();
  const validatePreviousInstance = (
    element: NativeElement,
    owner: string,
  ): NativeElement => {
    if (element.type !== "customInstance") return element;
    const target = previousById.get(element.definitionId);
    if (target === undefined) {
      throw new TypeError(`${owner} references missing definition ${element.definitionId}`);
    }
    positiveRevision(element.definitionVersion, `${owner} pinned definition revision`);
    if (
      element.definitionVersion !== target.definitionVersion ||
      element.definitionHash !== target.definitionHash
    ) {
      throw new TypeError(`${owner} has a stale custom-definition pin`);
    }
    validatePreviousDefinition(target.id);
    return element;
  };
  const validatePreviousDefinition = (definitionId: NodeId): void => {
    if (validatedPrevious.has(definitionId)) return;
    if (validatingPrevious.has(definitionId)) {
      throw new TypeError(`Previous custom-definition graph contains a cycle at ${definitionId}`);
    }
    const definition = previousById.get(definitionId);
    if (definition === undefined) {
      throw new TypeError(`Previous document is missing definition ${definitionId}`);
    }
    validatingPrevious.add(definitionId);
    try {
      mapElements(definition.elements, (element) =>
        validatePreviousInstance(element, `Previous definition ${definitionId}`));
      validatedPrevious.add(definitionId);
    } finally {
      validatingPrevious.delete(definitionId);
    }
  };
  for (const definition of previousById.values()) validatePreviousDefinition(definition.id);
  if (previous !== undefined) {
    mapElements(previous.elements, (element) =>
      validatePreviousInstance(element, "Previous document body"));
    for (const wrapper of previous.pageElements ?? []) {
      mapElements([wrapper.element], (element) =>
        validatePreviousInstance(element, "Previous document page content"));
    }
  }

  const finalized = new Map<NodeId, CustomElementDefinition>();
  const visiting = new Set<NodeId>();

  const finalize = (definitionId: NodeId): CustomElementDefinition => {
    const ready = finalized.get(definitionId);
    if (ready !== undefined) return ready;
    const raw = editedById.get(definitionId);
    if (raw === undefined) {
      throw new TypeError(`Custom instance references missing definition ${definitionId}`);
    }
    if (visiting.has(definitionId)) {
      throw new TypeError(`Custom-definition dependency graph contains a cycle at ${definitionId}`);
    }
    visiting.add(definitionId);
    try {
      const elements = mapElements(raw.elements, (element) => {
        if (element.type !== "customInstance") return element;
        const target = finalize(element.definitionId);
        if (
          element.definitionVersion === target.definitionVersion &&
          element.definitionHash === target.definitionHash
        ) return element;
        return {
          ...element,
          definitionVersion: target.definitionVersion,
          definitionHash: target.definitionHash,
        };
      });
      const withDependencies = elements === raw.elements ? raw : { ...raw, elements };
      const prior = previousById.get(definitionId);
      let definitionVersion: number;
      if (prior === undefined) {
        definitionVersion = 1;
      } else if (sameMeaning(prior, withDependencies)) {
        definitionVersion = positiveRevision(
          prior.definitionVersion,
          `Definition ${definitionId} revision`,
        );
      } else {
        const previousVersion = positiveRevision(
          prior.definitionVersion,
          `Definition ${definitionId} revision`,
        );
        if (previousVersion === Number.MAX_SAFE_INTEGER) {
          throw new RangeError(`Definition ${definitionId} revision cannot be incremented`);
        }
        definitionVersion = previousVersion + 1;
      }
      const revisionInput: DefinitionHashInput = {
        ...withDependencies,
        definitionVersion,
      };
      const definition: CustomElementDefinition = {
        ...revisionInput,
        definitionHash: customElementDefinitionHash(revisionInput),
      };
      finalized.set(definitionId, definition);
      return definition;
    } finally {
      visiting.delete(definitionId);
    }
  };

  const definitions = edited.definitions.map((definition) => finalize(definition.id));
  const pin = (element: NativeElement): NativeElement => {
    if (element.type !== "customInstance") return element;
    const target = finalize(element.definitionId);
    if (
      element.definitionVersion === target.definitionVersion &&
      element.definitionHash === target.definitionHash
    ) return element;
    return {
      ...element,
      definitionVersion: target.definitionVersion,
      definitionHash: target.definitionHash,
    };
  };
  const elements = mapElements(edited.elements, pin);
  const pageElements = edited.pageElements?.map((wrapper) => ({
    ...wrapper,
    element: mapElements([wrapper.element], pin)[0] as typeof wrapper.element,
  }));
  return {
    definitions,
    elements,
    ...(pageElements === undefined ? {} : { pageElements }),
  };
}
