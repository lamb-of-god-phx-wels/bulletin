import {
  findById,
  type CbbDocument,
  type FieldContract,
  type FieldValues,
  type NativeElement,
  type NodeId,
} from "@cbb/core";
import { checkEditorCapabilities } from "./capabilities.js";
import {
  applyDocumentPatches,
  documentValuesEqual,
  immutableDocument,
} from "./patches.js";
import type {
  CapabilityDecision,
  CapabilityRequirement,
  DocumentChangeEvent,
  DocumentPatch,
  EditorCommand,
  EditorCommandContext,
  EditorMode,
  EditorSelection,
  EditorStoreSnapshot,
  ExecuteCommandResult,
} from "./types.js";

interface HistoryEntry {
  readonly commandId: string;
  readonly label: string;
  readonly patches: readonly DocumentPatch[];
  readonly inversePatches: readonly DocumentPatch[];
  readonly selectionBefore: EditorSelection;
  readonly selectionAfter: EditorSelection;
  readonly historyGroupToken?: string;
}

interface PendingPublication {
  readonly event?: DocumentChangeEvent;
}

export interface EditorStoreOptions {
  /** Reject every document mutation while preserving selection/navigation. */
  readonly readOnly?: boolean;
  readonly initialMode?: EditorMode;
  readonly initialSelection?: EditorSelection;
  /** Optional catalog-backed structural validation, run before every commit. */
  readonly validateDocument?: (document: CbbDocument) => void;
  /** Subscriber failures are isolated and reported here when supplied. */
  readonly onSubscriberError?: (failure: EditorStoreSubscriberFailure) => void;
}

export type EditorStoreListener = () => void;
export type DocumentChangeListener = (event: DocumentChangeEvent) => void;

export interface EditorStoreSubscriberFailure {
  readonly channel: "state" | "documentChange";
  readonly error: unknown;
}

export class EditorCommandDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorCommandDefinitionError";
  }
}

function immutableSelection(selection: EditorSelection): EditorSelection {
  return Object.freeze({ ...selection });
}

interface FieldOwner {
  readonly contract?: FieldContract;
  readonly values?: FieldValues;
}

function findElementFieldOwner(
  element: NativeElement,
  ownerNodeId: NodeId,
  document: CbbDocument,
): FieldOwner | undefined {
  if (element.id === ownerNodeId) {
    if (element.type === "customInstance") {
      const definition = document.customElementDefinitions?.find(
        (candidate) => candidate.id === element.definitionId,
      );
      return {
        ...(definition === undefined ? {} : { contract: definition.fieldContract }),
        ...(element.fieldValues === undefined ? {} : { values: element.fieldValues }),
      };
    }
    return {
      ...(element.fieldContract === undefined ? {} : { contract: element.fieldContract }),
      ...(element.fieldValues === undefined ? {} : { values: element.fieldValues }),
    };
  }
  if (
    element.type !== "grid" &&
    element.type !== "stack" &&
    element.type !== "canvas"
  ) {
    return undefined;
  }
  for (const wrapper of element.children) {
    const found = findElementFieldOwner(wrapper.element, ownerNodeId, document);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findFieldOwner(
  document: CbbDocument,
  ownerNodeId: NodeId,
): FieldOwner | undefined {
  for (const element of document.elements) {
    const found = findElementFieldOwner(element, ownerNodeId, document);
    if (found !== undefined) return found;
  }
  for (const wrapper of document.pageElements ?? []) {
    const found = findElementFieldOwner(wrapper.element, ownerNodeId, document);
    if (found !== undefined) return found;
  }
  for (const definition of document.customElementDefinitions ?? []) {
    if (definition.id === ownerNodeId) {
      return {
        contract: definition.fieldContract,
        ...(definition.sampleFieldValues === undefined
          ? {}
          : { values: definition.sampleFieldValues }),
      };
    }
    for (const element of definition.elements) {
      const found = findElementFieldOwner(element, ownerNodeId, document);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function ownerHasField(owner: FieldOwner, fieldId: string): boolean {
  return (
    owner.contract?.fields.some((field) => field.id === fieldId) === true ||
    Object.prototype.hasOwnProperty.call(owner.values ?? {}, fieldId)
  );
}

function selectionIsValid(
  document: CbbDocument,
  selection: EditorSelection,
): boolean {
  if (selection.kind === "document") return true;
  if (selection.kind === "node") {
    return findById(document, selection.nodeId) !== undefined;
  }
  if (selection.ownerNodeId !== undefined) {
    const owner = findFieldOwner(document, selection.ownerNodeId);
    return owner !== undefined && ownerHasField(owner, selection.fieldId);
  }
  return (
    document.fieldContract?.fields.some((field) => field.id === selection.fieldId) ===
      true ||
    Object.prototype.hasOwnProperty.call(
      document.fieldValues ?? {},
      selection.fieldId,
    )
  );
}

function reconcileSelection(
  document: CbbDocument,
  preferred: EditorSelection,
  fallback: EditorSelection,
): EditorSelection {
  if (selectionIsValid(document, preferred)) return immutableSelection(preferred);
  if (selectionIsValid(document, fallback)) return immutableSelection(fallback);
  return Object.freeze({ kind: "document" });
}

function resolveRequirements(
  command: EditorCommand,
  context: EditorCommandContext,
): readonly CapabilityRequirement[] {
  const requirements = typeof command.capabilities === "function"
    ? command.capabilities(context)
    : command.capabilities;
  if (requirements.length === 0) {
    throw new EditorCommandDefinitionError(
      `Document command '${command.id}' must declare at least one capability`,
    );
  }
  return requirements;
}

function resolvePatches(
  command: EditorCommand,
  context: EditorCommandContext,
): readonly DocumentPatch[] {
  return typeof command.createPatches === "function"
    ? command.createPatches(context)
    : command.createPatches;
}

function appendFrozen<T>(values: readonly T[], value: T): readonly T[] {
  return Object.freeze([...values, value]);
}

function withoutLast<T>(values: readonly T[]): readonly T[] {
  return Object.freeze(values.slice(0, -1));
}

/**
 * Renderer-owned document state with immutable snapshots and reversible patch
 * history.  It intentionally has no React dependency; `subscribe` and
 * `getSnapshot` satisfy React's `useSyncExternalStore` contract directly.
 */
export class EditorStore {
  private document: CbbDocument;
  private mode: EditorMode;
  private selection: EditorSelection;
  private documentRevision = 0;
  private undoEntries: readonly HistoryEntry[] = Object.freeze([]);
  private redoEntries: readonly HistoryEntry[] = Object.freeze([]);
  private historyBoundary = 0;
  private snapshot: EditorStoreSnapshot;
  private readonly listeners = new Set<EditorStoreListener>();
  private readonly documentChangeListeners = new Set<DocumentChangeListener>();
  private readonly validateDocument: ((document: CbbDocument) => void) | undefined;
  private readonly readOnly: boolean;
  private readonly onSubscriberError:
    | ((failure: EditorStoreSubscriberFailure) => void)
    | undefined;
  private readonly pendingPublications: PendingPublication[] = [];
  private publishing = false;

  constructor(document: CbbDocument, options: EditorStoreOptions = {}) {
    this.document = immutableDocument(document);
    this.validateDocument = options.validateDocument;
    this.readOnly = options.readOnly ?? false;
    this.onSubscriberError = options.onSubscriberError;
    this.validateDocument?.(this.document);
    this.mode = options.initialMode ??
      (this.document.kind === "template" ? "customizeLayout" : "weeklyContent");
    this.selection = reconcileSelection(
      this.document,
      options.initialSelection ?? { kind: "document" },
      { kind: "document" },
    );
    this.snapshot = this.makeSnapshot();
  }

  getSnapshot = (): EditorStoreSnapshot => this.snapshot;

  subscribe = (listener: EditorStoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeToDocumentChanges(listener: DocumentChangeListener): () => void {
    this.documentChangeListeners.add(listener);
    return () => this.documentChangeListeners.delete(listener);
  }

  /** Evaluate the same gate used by execute, for controls and keyboard actions. */
  canExecute(command: EditorCommand): CapabilityDecision {
    const context = this.commandContext();
    if (this.readOnly) {
      return {
        allowed: false,
        code: "readOnly",
        reason: "This bulletin library is open read-only.",
        requirement: resolveRequirements(command, context)[0]!,
      };
    }
    return checkEditorCapabilities(
      this.document,
      this.mode,
      resolveRequirements(command, context),
    );
  }

  execute(command: EditorCommand): ExecuteCommandResult {
    const context = this.commandContext();
    if (this.readOnly) {
      return {
        status: "denied",
        denial: {
          allowed: false,
          code: "readOnly",
          reason: "This bulletin library is open read-only.",
          requirement: resolveRequirements(command, context)[0]!,
        },
      };
    }
    const decision = checkEditorCapabilities(
      this.document,
      this.mode,
      resolveRequirements(command, context),
    );
    if (!decision.allowed) return { status: "denied", denial: decision };

    const applied = applyDocumentPatches(
      this.document,
      resolvePatches(command, context),
    );
    this.validateDocument?.(applied.document);
    if (documentValuesEqual(this.document, applied.document)) {
      return { status: "noChange" };
    }

    const requestedSelection =
      typeof command.selectAfter === "function"
        ? command.selectAfter({ ...context, nextDocument: applied.document })
        : command.selectAfter ?? this.selection;
    const nextSelection = reconcileSelection(
      applied.document,
      requestedSelection,
      this.selection,
    );
    const groupToken =
      command.historyGroup === undefined
        ? undefined
        : `${this.historyBoundary}:${command.historyGroup}`;

    const entry: HistoryEntry = Object.freeze({
      commandId: command.id,
      label: command.label,
      patches: applied.patches,
      inversePatches: applied.inversePatches,
      selectionBefore: this.selection,
      selectionAfter: nextSelection,
      ...(groupToken === undefined ? {} : { historyGroupToken: groupToken }),
    });

    const previous = this.undoEntries.at(-1);
    if (
      groupToken !== undefined &&
      previous?.historyGroupToken === groupToken
    ) {
      const grouped: HistoryEntry = Object.freeze({
        commandId: command.id,
        label: command.label,
        patches: Object.freeze([...previous.patches, ...entry.patches]),
        inversePatches: Object.freeze([
          ...entry.inversePatches,
          ...previous.inversePatches,
        ]),
        selectionBefore: previous.selectionBefore,
        selectionAfter: entry.selectionAfter,
        historyGroupToken: groupToken,
      });
      this.undoEntries = appendFrozen(withoutLast(this.undoEntries), grouped);
    } else {
      this.undoEntries = appendFrozen(this.undoEntries, entry);
    }
    this.redoEntries = Object.freeze([]);
    if (groupToken === undefined) this.historyBoundary++;

    this.document = applied.document;
    this.selection = nextSelection;
    this.documentRevision++;
    const event = this.makeDocumentChangeEvent(
      "execute",
      command.id,
      command.label,
      applied.patches,
      applied.inversePatches,
    );
    this.publish(event);
    return { status: "applied", event };
  }

  undo(): DocumentChangeEvent | undefined {
    if (this.readOnly) return undefined;
    const entry = this.undoEntries.at(-1);
    if (entry === undefined) return undefined;

    const applied = applyDocumentPatches(this.document, entry.inversePatches);
    this.validateDocument?.(applied.document);
    this.undoEntries = withoutLast(this.undoEntries);
    this.redoEntries = appendFrozen(this.redoEntries, entry);
    this.document = applied.document;
    this.selection = reconcileSelection(
      this.document,
      entry.selectionBefore,
      entry.selectionAfter,
    );
    this.documentRevision++;
    this.breakHistoryGroup();
    const event = this.makeDocumentChangeEvent(
      "undo",
      entry.commandId,
      entry.label,
      applied.patches,
      applied.inversePatches,
    );
    this.publish(event);
    return event;
  }

  redo(): DocumentChangeEvent | undefined {
    if (this.readOnly) return undefined;
    const entry = this.redoEntries.at(-1);
    if (entry === undefined) return undefined;

    const applied = applyDocumentPatches(this.document, entry.patches);
    this.validateDocument?.(applied.document);
    this.redoEntries = withoutLast(this.redoEntries);
    this.undoEntries = appendFrozen(this.undoEntries, entry);
    this.document = applied.document;
    this.selection = reconcileSelection(
      this.document,
      entry.selectionAfter,
      entry.selectionBefore,
    );
    this.documentRevision++;
    this.breakHistoryGroup();
    const event = this.makeDocumentChangeEvent(
      "redo",
      entry.commandId,
      entry.label,
      applied.patches,
      applied.inversePatches,
    );
    this.publish(event);
    return event;
  }

  setSelection(selection: EditorSelection): void {
    const nextSelection = reconcileSelection(
      this.document,
      selection,
      { kind: "document" },
    );
    if (documentValuesEqual(this.selection, nextSelection)) return;
    this.selection = nextSelection;
    this.breakHistoryGroup();
    this.publish();
  }

  setMode(mode: EditorMode): void {
    if (this.readOnly) return;
    if (this.mode === mode) return;
    this.mode = mode;
    this.breakHistoryGroup();
    this.publish();
  }

  /** End continuous typing/arrow-key grouping without changing visible state. */
  breakHistoryGroup(): void {
    this.historyBoundary++;
  }

  private commandContext(): EditorCommandContext {
    return Object.freeze({
      document: this.document,
      mode: this.mode,
      selection: this.selection,
    });
  }

  private makeSnapshot(): EditorStoreSnapshot {
    const undoEntry = this.undoEntries.at(-1);
    const redoEntry = this.redoEntries.at(-1);
    return Object.freeze({
      document: this.document,
      mode: this.mode,
      selection: this.selection,
      documentRevision: this.documentRevision,
      canUndo: undoEntry !== undefined,
      canRedo: redoEntry !== undefined,
      ...(undoEntry === undefined ? {} : { undoLabel: undoEntry.label }),
      ...(redoEntry === undefined ? {} : { redoLabel: redoEntry.label }),
    });
  }

  private makeDocumentChangeEvent(
    kind: DocumentChangeEvent["kind"],
    commandId: string,
    label: string,
    patches: readonly DocumentPatch[],
    inversePatches: readonly DocumentPatch[],
  ): DocumentChangeEvent {
    return Object.freeze({
      kind,
      commandId,
      label,
      document: this.document,
      patches,
      inversePatches,
      documentRevision: this.documentRevision,
    });
  }

  private publish(event?: DocumentChangeEvent): void {
    this.snapshot = this.makeSnapshot();
    this.pendingPublications.push(
      event === undefined ? {} : { event },
    );
    if (this.publishing) return;

    this.publishing = true;
    try {
      for (;;) {
        const publication = this.pendingPublications.shift();
        if (publication === undefined) break;
        // Durable-change consumers go first so a state subscriber cannot
        // suppress or overtake the autosave patch stream.
        const eventToPublish = publication.event;
        if (eventToPublish !== undefined) {
          for (const listener of [...this.documentChangeListeners]) {
            this.notifySubscriber(
              "documentChange",
              () => listener(eventToPublish),
            );
          }
        }
        for (const listener of [...this.listeners]) {
          this.notifySubscriber("state", listener);
        }
      }
    } finally {
      this.publishing = false;
    }
  }

  private notifySubscriber(
    channel: EditorStoreSubscriberFailure["channel"],
    listener: () => void,
  ): void {
    try {
      listener();
    } catch (error) {
      try {
        this.onSubscriberError?.(Object.freeze({ channel, error }));
      } catch {
        // Error reporting is also an observer and must never suppress state.
      }
    }
  }
}
