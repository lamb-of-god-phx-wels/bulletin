import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../design-system/index.js";
import type { EditorStore } from "../store/editorStore.js";
import type { EditorMode } from "../store/types.js";
import { planDocumentFindReplace } from "./findReplace.js";

export interface FindReplacePanelProps {
  readonly store: EditorStore;
  readonly mode: EditorMode;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onAnnouncement: (message: string) => void;
}

export function FindReplacePanel({
  store,
  mode,
  readOnly,
  onClose,
  onAnnouncement,
}: FindReplacePanelProps) {
  const headingId = useId();
  const summaryId = useId();
  const findInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const document = store.getSnapshot().document;
  const plan = useMemo(
    () => planDocumentFindReplace(document, mode, { query, replacement, matchCase }, readOnly),
    [document, matchCase, mode, query, readOnly, replacement],
  );

  function replaceAll(): void {
    if (plan.command === undefined) return;
    try {
      const result = store.execute(plan.command);
      const message = result.status === "applied"
        ? `Replaced ${plan.replaceableMatches} ${plan.replaceableMatches === 1 ? "match" : "matches"} as one undoable change.`
        : result.status === "denied"
          ? result.denial.reason
          : "No document text changed.";
      onAnnouncement(message);
      if (result.status === "applied") findInputRef.current?.focus();
    } catch (error) {
      onAnnouncement(error instanceof Error
        ? `Replace all was not applied: ${error.message}`
        : "Replace all was not applied because the resulting document was invalid.");
    }
  }

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && plan.command !== undefined) {
      event.preventDefault();
      replaceAll();
    }
  }

  return (
    <section
      className="cbb-find-replace"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onKeyDown={keyDown}
    >
      <header>
        <div>
          <h2 id={headingId}>Find and replace</h2>
          <p>Searches stored text and weekly field values in this document. Generated and protected matches stay unchanged.</p>
        </div>
        <Button onClick={onClose}>Close find and replace</Button>
      </header>
      <div className="cbb-find-replace__controls">
        <label>
          <span>Find</span>
          <input
            ref={findInputRef}
            autoFocus
            type="search"
            value={query}
            maxLength={256}
            aria-describedby={summaryId}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Replace with</span>
          <input
            type="text"
            value={replacement}
            disabled={readOnly}
            onChange={(event) => setReplacement(event.currentTarget.value)}
          />
        </label>
        <label className="cbb-find-replace__case">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(event) => setMatchCase(event.currentTarget.checked)}
          />
          Match case
        </label>
        <Button
          variant="primary"
          disabled={plan.command === undefined}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          title={readOnly
            ? "This bulletin library is open read-only."
            : plan.replaceableMatches === 0 ? "No editable matches to replace." : "Also available with Ctrl+Enter or Command+Enter."}
          onClick={replaceAll}
        >
          Replace all {plan.replaceableMatches > 0 ? `(${plan.replaceableMatches})` : ""}
        </Button>
      </div>
      <p id={summaryId} className="cbb-find-replace__summary" aria-live="polite">
        {query.length === 0
          ? "Enter text to preview matches before replacing."
          : plan.totalMatches === 0
            ? "No matches in this document."
            : `${plan.totalMatches} ${plan.totalMatches === 1 ? "match" : "matches"}: ${plan.replaceableMatches} replaceable${plan.skippedMatches === 0 ? "" : `, ${plan.skippedMatches} skipped`}.`}
      </p>
      {plan.previews.length === 0
        ? null
        : (
            <ol className="cbb-find-replace__results" aria-label="Find results">
              {plan.previews.map((match) => (
                <li key={match.id} data-replaceable={match.replaceable ? "true" : "false"}>
                  <button
                    type="button"
                    onClick={() => {
                      store.setSelection(match.selection);
                      onAnnouncement(`${match.label}. ${match.replaceable ? "This match will be replaced." : match.reason ?? "This match will be skipped."}`);
                    }}
                  >
                    <strong>{match.label}</strong>
                    <span>{match.snippet}</span>
                    {match.replaceable ? null : <small>Skipped — {match.reason}</small>}
                  </button>
                </li>
              ))}
            </ol>
          )}
      {plan.omittedPreviews > 0
        ? <p className="cbb-find-replace__limit">{plan.omittedPreviews} additional matches are included in the count but omitted from this bounded preview.</p>
        : null}
    </section>
  );
}
