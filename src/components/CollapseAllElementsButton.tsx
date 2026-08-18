import type { MouseEvent } from 'react';

export function collapseAllElementEditors(root: ParentNode | null) {
  const editors = root?.querySelectorAll<HTMLDetailsElement>('details.collapsible-editor[open]') ?? [];
  editors.forEach(editor => { editor.open = false; });
  return editors.length;
}

export function CollapseAllElementsButton() {
  const collapse = (event: MouseEvent<HTMLButtonElement>) => {
    collapseAllElementEditors(event.currentTarget.closest('.editor-scroll'));
  };
  return <button type="button" className="secondary collapse-all-elements" onClick={collapse}>Collapse all</button>;
}
