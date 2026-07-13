import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Preserve the invoking control across an overlaid modal's complete lifetime. */
export function useModalFocus<T extends HTMLElement>(): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const returnFocus = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => () => {
    const target = returnFocus.current;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }, []);
  return dialogRef;
}

/** Keep Tab/Shift+Tab inside a modal while retaining native order and controls. */
export function trapModalTab(
  event: ReactKeyboardEvent<HTMLElement>,
  dialog: HTMLElement | null,
): void {
  if (event.key !== "Tab" || dialog === null) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((candidate) => !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true");
  const first = controls[0];
  const last = controls.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !(active instanceof Node) || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !(active instanceof Node) || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
