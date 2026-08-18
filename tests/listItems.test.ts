import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListFields } from '../src/components/ListFields';
import { listItemEditorContent, setListHeadingsEnabled, updateListItemEditorContent } from '../src/shared/listItems';
import type { ListBlock, Paragraph } from '../src/shared/types';

const paragraph = (text: string, marks?: Array<'bold' | 'italic'>): Paragraph => ({
  type: 'paragraph',
  children: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const line = (text: string, marks?: Array<'bold' | 'italic'>): Paragraph => ({ ...paragraph(text, marks), breakBefore: 'line' });

const block: ListBlock = {
  id: 'list',
  type: 'list',
  items: [
    { id: 'first', title: 'First', content: [paragraph('First body')] },
    { id: 'second', title: 'Second', content: [paragraph('Second body')] },
  ],
};

describe('list item body editing', () => {
  it('interprets more than two newline characters as one item separator', () => {
    const result = updateListItemEditorContent(block, 0, [
      paragraph('First'),
      paragraph('Updated body', ['italic']),
      paragraph(''), paragraph(''), paragraph(''),
    ]);

    expect(result.createdItemId).toBeTruthy();
    expect(result.block.items.map(item => item.title)).toEqual(['First', 'New item', 'Second']);
    expect(result.block.items[0]).toMatchObject({ title: 'First', content: [line('Updated body', ['italic'])] });
    expect(result.block.items[1]).toMatchObject({ id: result.createdItemId, title: 'New item', content: [] });

    const longerRun = updateListItemEditorContent(block, 0, [
      paragraph('First'), paragraph('Body'),
      paragraph(''), paragraph(''), paragraph(''), paragraph(''), paragraph(''),
      paragraph('Next'), paragraph('Next body'),
    ]);
    expect(longerRun.block.items.map(item => item.title)).toEqual(['First', 'Next', 'Second']);
    expect(longerRun.block.items[1].content).toEqual([line('Next body')]);

    const threeNewlinesBetweenText = updateListItemEditorContent(block, 0, [
      paragraph('First'), paragraph('Body'), paragraph(''), paragraph(''), paragraph('Next'),
    ]);
    expect(threeNewlinesBetweenText.block.items.map(item => item.title)).toEqual(['First', 'Next', 'Second']);

    const whitespaceOnlyLines = updateListItemEditorContent(block, 0, [
      paragraph('First'), paragraph('Body'), paragraph('   '), paragraph('\t'), paragraph('Next'),
    ]);
    expect(whitespaceOnlyLines.block.items.map(item => item.title)).toEqual(['First', 'Next', 'Second']);
  });

  it('parses a pasted list containing multiple three-blank-line separators', () => {
    const result = updateListItemEditorContent(block, 0, [
      paragraph('Alpha'), paragraph('Alpha body'),
      paragraph(''), paragraph(''),
      paragraph('Beta'), paragraph('Beta body'),
      paragraph(''), paragraph(''),
      paragraph('Gamma'), paragraph('Gamma body'),
    ]);
    expect(result.block.items.map(item => item.title)).toEqual(['Alpha', 'Beta', 'Gamma', 'Second']);
    expect(result.block.items.slice(0, 3).map(item => item.content)).toEqual([
      [line('Alpha body')], [line('Beta body')], [line('Gamma body')],
    ]);
  });

  it('uses the first editor line as the heading for the whole list', () => {
    expect(listItemEditorContent(block.items[0])).toEqual([paragraph('First'), paragraph('First body')]);
    const updated = updateListItemEditorContent(block, 0, [paragraph('Changed heading', ['bold']), paragraph('Changed body')]);
    expect(updated.block.items[0]).toMatchObject({
      title: 'Changed heading',
      titleContent: [paragraph('Changed heading', ['bold'])],
      content: [paragraph('Changed body')],
    });

    const replaced = updateListItemEditorContent(block, 0, [paragraph('Replacement')]).block;
    expect(replaced.items[0].content).toEqual([]);
    expect(listItemEditorContent(replaced.items[0])).toEqual([paragraph('Replacement')]);
  });

  it('toggles first-line headings for every item without losing text', () => {
    const disabled = setListHeadingsEnabled(block, false);
    expect(disabled.headingsEnabled).toBe(false);
    expect(disabled.items.map(item => item.title)).toEqual([undefined, undefined]);
    expect(disabled.items.map(item => item.content)).toEqual([
      [paragraph('First'), line('First body')],
      [paragraph('Second'), line('Second body')],
    ]);

    const enabled = setListHeadingsEnabled(disabled, true);
    expect(enabled.headingsEnabled).toBe(true);
    expect(enabled.items.map(item => item.title)).toEqual(['First', 'Second']);
    expect(enabled.items.map(item => item.content)).toEqual([[line('First body')], [line('Second body')]]);
  });

  it('renders one combined editor per item and one heading switch for the list', () => {
    const markup = renderToStaticMarkup(createElement(ListFields, {
      block,
      targetFolder: 'assets/images/lists',
      onChange: () => undefined,
    }));
    expect(markup.match(/role="textbox"/g)).toHaveLength(2);
    expect(markup.match(/role="switch"/g)).toHaveLength(1);
    expect(markup).toContain('Heading and content');
    expect(markup).toContain('Use first line as heading');
  });

  it('keeps one or two blank lines in the current item', () => {
    const oneBlank = updateListItemEditorContent(block, 0, [paragraph('First'), paragraph('Body'), paragraph('')]);
    expect(oneBlank.block.items).toHaveLength(2);
    expect(oneBlank.block.items[0].content).toEqual([line('Body'), line('')]);

    const twoBlanks = updateListItemEditorContent(block, 0, [paragraph('First'), paragraph('Body'), paragraph(''), paragraph('')]);
    expect(twoBlanks.block.items).toHaveLength(2);
    expect(twoBlanks.block.items[0].content).toEqual([line('Body'), line(''), line('')]);
  });

  it('parses one newline as a line break and two as a paragraph boundary', () => {
    const oneNewline = updateListItemEditorContent(block, 0, [paragraph('First'), paragraph('Line one'), paragraph('Line two')]).block.items[0];
    expect(oneNewline.content).toEqual([line('Line one'), line('Line two')]);
    expect(listItemEditorContent(oneNewline)).toEqual([paragraph('First'), paragraph('Line one'), paragraph('Line two')]);

    const twoNewlines = updateListItemEditorContent(block, 0, [paragraph('First'), paragraph('Paragraph one'), paragraph(''), paragraph('Paragraph two')]).block.items[0];
    expect(twoNewlines.content).toEqual([line('Paragraph one'), paragraph('Paragraph two')]);
    expect(listItemEditorContent(twoNewlines)).toEqual([paragraph('First'), paragraph('Paragraph one'), paragraph(''), paragraph('Paragraph two')]);
  });

});
