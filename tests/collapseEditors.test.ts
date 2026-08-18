import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CollapseAllElementsButton, collapseAllElementEditors } from '../src/components/CollapseAllElementsButton';

describe('element editor collapsing', () => {
  it('closes every expanded editor in the supplied elements panel', () => {
    const editors = [{ open: true }, { open: true }];
    const querySelectorAll = vi.fn(() => editors);
    const root = { querySelectorAll } as unknown as ParentNode;

    expect(collapseAllElementEditors(root)).toBe(2);
    expect(querySelectorAll).toHaveBeenCalledWith('details.collapsible-editor[open]');
    expect(editors.every(editor => editor.open === false)).toBe(true);
  });

  it('renders a clearly labeled button', () => {
    const markup = renderToStaticMarkup(createElement(CollapseAllElementsButton));
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Collapse all');
  });
});
