import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SongBlockFields } from '../src/components/SongBlockFields';
import { DocumentView } from '../src/components/DocumentView';
import { createBulletin, defaultTemplate } from '../src/shared/defaults';
import {
  selectSong,
  songHeader,
  songLibraryItem,
  songPresentations,
  songTitle,
} from '../src/shared/songs';
import type { LibraryManifestV1, SongBlock } from '../src/shared/types';
import { validateBulletin } from '../src/shared/validation';

const lyrics = [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: 'Sing aloud.' }] }];
const library: LibraryManifestV1 = {
  schemaVersion: 1,
  name: 'Songs',
  items: [
    { id: 'anthem', version: 1, kind: 'song', title: 'Original Anthem', content: lyrics },
    { id: 'anthem', version: 2, kind: 'song', title: 'Revised Anthem', assets: [{ path: 'anthem.pdf', mediaType: 'application/pdf' }] },
    { id: 'both', version: 1, kind: 'song', title: 'Complete Song', content: lyrics, assets: [{ path: 'complete.png', mediaType: 'image/png' }] },
  ],
};
const block = (changes: Partial<SongBlock> = {}): SongBlock => ({
  id: 'song',
  type: 'song',
  songType: 'song',
  libraryItemId: 'anthem',
  libraryItemVersion: 1,
  selection: { mode: 'all' },
  renderMode: 'lyrics',
  ...changes,
});

describe('song blocks', () => {
  it('uses linked title and literal Song header fallbacks with pinned library versions', () => {
    const pinned = songLibraryItem(block(), library);
    expect(pinned?.version).toBe(1);
    expect(songLibraryItem(block({ libraryItemVersion: 99 }), library)).toBeUndefined();
    expect(songHeader(block({ label: '' }))).toBe('Song');
    expect(songTitle(block(), pinned)).toBe('Original Anthem');
    expect(songTitle(block({ title: 'Bulletin title' }), pinned)).toBe('Bulletin title');
  });

  it('pins the newest version and resets per-song overrides when a song is selected', () => {
    const selected = selectSong(block({
      title: 'Old title',
      contentOverride: lyrics,
      asset: { path: 'local.png', mediaType: 'image/png' },
    }), 'anthem', library);
    expect(selected).toMatchObject({
      libraryItemId: 'anthem',
      libraryItemVersion: 2,
      renderMode: 'asset',
    });
    expect(selected).not.toHaveProperty('title');
    expect(selected).not.toHaveProperty('contentOverride');
    expect(selected).not.toHaveProperty('asset');
  });

  it('offers only presentations backed by available content', () => {
    expect(songPresentations(block(), library.items[0])).toEqual(['lyrics']);
    expect(songPresentations(block({ libraryItemId: 'both', libraryItemVersion: 1 }), library.items[2])).toEqual(['lyrics', 'asset']);
    expect(songPresentations(block({ contentOverride: undefined, asset: { path: 'legacy.pdf', mediaType: 'application/pdf' } }))).toEqual(['asset']);
    expect(songPresentations(block({ contentOverride: undefined }))).toEqual([]);
  });

  it('renders library-aware controls without version or image override controls', () => {
    const markup = renderToStaticMarkup(createElement(SongBlockFields, {
      block: block(),
      library,
      template: defaultTemplate,
      scope: 'weekly',
      onChange: () => undefined,
    }));
    expect(markup).toContain('Library song');
    expect(markup).toContain('Header');
    expect(markup).toContain('Display title');
    expect(markup).toContain('Lyrics');
    expect(markup).not.toContain('Version');
    expect(markup).not.toContain('Choose music image');
    expect(markup).not.toContain('Replace');
    expect(markup).toContain('aria-label="Song text part"');
    expect(markup).toContain('Header typography');
    expect(markup).toContain('More formatting…');
    expect(markup).toContain('aria-label="Uppercase" aria-pressed="true"');
  });

  it('renders header, display-title, and body formatting independently', () => {
    const song = block({
      elements: {
        header: { presentation: { fontSizePt: 14, textTransform: 'small-caps' } },
        title: { presentation: { fontSizePt: 18 } },
        body: { presentation: { fontStyle: 'italic' } },
      },
    });
    const document = { ...createBulletin(defaultTemplate, '2026-08-02'), blocks: [song] };
    const markup = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      library,
      rulers: false,
    }));
    expect(markup).toMatch(/class="song-header"[^>]*font-size:14pt[^>]*font-variant:small-caps[^>]*text-transform:none/);
    expect(markup).toMatch(/class="song-title"[^>]*font-size:18pt/);
    expect(markup).toMatch(/class="song-body"[^>]*font-style:italic/);
  });

  it('lets regular capitalization override the song heading’s built-in uppercase style', () => {
    const song = block({
      label: 'Opening Hymn',
      elements: { header: { presentation: { textTransform: 'none' } } },
    });
    const document = { ...createBulletin(defaultTemplate, '2026-08-02'), blocks: [song] };
    const markup = renderToStaticMarkup(createElement(DocumentView, {
      document,
      template: defaultTemplate,
      library,
      rulers: false,
    }));
    expect(markup).toMatch(/class="song-header"[^>]*text-transform:none/);
  });

  it('validates the selected presentation against the pinned library content', () => {
    const document = {
      ...createBulletin(defaultTemplate, '2026-08-02'),
      blocks: [block({ libraryItemVersion: 2, renderMode: 'lyrics' })],
    };
    expect(validateBulletin(document, library)).toContainEqual({
      path: '/blocks/0/renderMode',
      message: 'The selected song does not include lyrics.',
    });
    expect(validateBulletin({
      ...document,
      blocks: [block({
        libraryItemId: 'missing',
        libraryItemVersion: undefined,
        renderMode: 'asset',
        asset: { path: 'legacy.pdf', mediaType: 'application/pdf' },
      })],
    }, library)).not.toContainEqual(expect.objectContaining({ path: '/blocks/0/renderMode' }));
  });
});
