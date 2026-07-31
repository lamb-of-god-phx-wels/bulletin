import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  applyTypographyChange,
  effectiveBlockStyle,
  InlineTypographyControls,
  supportsInlineTypography,
} from '../src/components/InlineTypographyControls';
import { defaultTemplate } from '../src/shared/defaults';
import type { BulletinBlock, CustomBlockStyle } from '../src/shared/types';

const heading = (presentation?: Partial<CustomBlockStyle>): BulletinBlock => ({
  id: 'heading',
  type: 'heading',
  text: 'Welcome',
  presentation,
});

describe('inline typography controls', () => {
  it('uses template typography as the baseline and preserves advanced formatting', () => {
    const template = {
      ...defaultTemplate,
      theme: { ...defaultTemplate.theme, bodySizePt: 11.5, lineHeight: 1.4 },
    };
    const block = heading({
      widthPercent: 72,
      paddingIn: { top: .1, right: .2, bottom: .3, left: .4 },
      fontStyle: 'italic',
    });

    expect(effectiveBlockStyle(block, template)).toMatchObject({
      fontSizePt: 11.5,
      lineHeight: 1.4,
      verticalAlign: 'top',
      widthPercent: 72,
      fontStyle: 'italic',
      paddingIn: { top: .1, right: .2, bottom: .3, left: .4 },
    });
    expect(applyTypographyChange(block, template, { fontWeight: 'bold' })).toMatchObject({
      fontSizePt: 11.5,
      lineHeight: 1.4,
      widthPercent: 72,
      fontWeight: 'bold',
      fontStyle: 'italic',
      paddingIn: { top: .1, right: .2, bottom: .3, left: .4 },
    });
  });

  it('shows custom font and line-spacing values without discarding them', () => {
    const markup = renderToStaticMarkup(createElement(InlineTypographyControls, {
      block: heading({ fontFamily: 'Calibri, sans-serif', lineHeight: 1.37 }),
      template: defaultTemplate,
      onChange: () => undefined,
    }));

    expect(markup).toContain('Calibri, sans-serif');
    expect(markup).toContain('Custom (1.37)');
    expect(markup).toContain('aria-label="Regular capitalization"');
    expect(markup).toContain('aria-label="Small caps"');
    expect(markup).toContain('aria-label="Uppercase"');
    expect(markup).toContain('<legend>Horizontal</legend>');
    expect(markup).toContain('<legend>Vertical</legend>');
    expect(markup).toContain('aria-label="Align top"');
    expect(markup).toContain('aria-label="Align middle"');
    expect(markup).toContain('aria-label="Align bottom"');
  });

  it('supports an externally controlled vertical alignment for fixed canvas boxes', () => {
    const markup = renderToStaticMarkup(createElement(InlineTypographyControls, {
      block: heading(),
      template: defaultTemplate,
      verticalAlign: 'bottom',
      onVerticalAlignChange: () => undefined,
      onChange: () => undefined,
    }));

    expect(markup).toContain('aria-label="Align bottom" aria-pressed="true"');
  });

  it('is limited to blocks that directly present text', () => {
    expect(supportsInlineTypography(heading())).toBe(true);
    expect(supportsInlineTypography({
      id: 'responses',
      type: 'responsiveReading',
      entries: [],
    })).toBe(true);
    expect(supportsInlineTypography({
      id: 'image',
      type: 'image',
      asset: { path: 'photo.png', mediaType: 'image/png' },
    })).toBe(false);
    expect(supportsInlineTypography({
      id: 'group',
      type: 'group',
      children: [],
    })).toBe(false);
  });
});
