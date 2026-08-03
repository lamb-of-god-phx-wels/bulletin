import type { BulletinDocumentV1, LibraryManifestV1, TemplateV1, ValidationIssue } from './types.js';
import { customBlockIssues } from './customBlocks.js';
import { validateCanvasScene } from './canvas.js';
import { pageTemplateIssues, pageTemplateMargin } from './pageTemplates.js';
import { estimateBlockPoints } from './pagination.js';
import { songLibraryItem, songPresentations } from './songs.js';
import { customPropertyIssues } from './customProperties.js';
import { flattenBlocks } from './blocks.js';

export function validateBulletin(value: unknown, library?: LibraryManifestV1, template?: TemplateV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object') return [{ path: '', message: 'Bulletin must be an object.' }];
  const doc = value as Partial<BulletinDocumentV1>;
  if (doc.schemaVersion !== 1) issues.push({ path: '/schemaVersion', message: 'Expected schema version 1.' });
  if (!doc.id) issues.push({ path: '/id', message: 'A stable bulletin ID is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.info?.date ?? '')) issues.push({ path: '/info/date', message: 'Use an ISO date (YYYY-MM-DD).' });
  if (!Array.isArray(doc.blocks)) issues.push({ path: '/blocks', message: 'Blocks must be an array.' });
  if (template && Array.isArray(doc.blocks)) issues.push(...customPropertyIssues({ ...template, starterBlocks: doc.blocks }, doc as BulletinDocumentV1));
  const ids = new Set<string>();
  doc.blocks?.forEach((block, index) => {
    const hasInlineLibraryContent = (block.type === 'song' && Boolean(block.contentOverride?.length || block.asset)) || (block.type === 'libraryText' && Boolean(block.contentOverride?.length));
    if (!block.id) issues.push({ path: `/blocks/${index}/id`, message: 'Every block needs an ID.' });
    else if (ids.has(block.id)) issues.push({ path: `/blocks/${index}/id`, message: `Duplicate block ID: ${block.id}` });
    ids.add(block.id);
    if (block.type === 'titlePage' || block.type === 'canvasCover') {
      issues.push({ path: `/blocks/${index}/type`, message: `Legacy ${block.type} blocks are unsupported. Remove the block and insert a reusable page template.` });
    }
    if (block.type === 'scriptureReading' && !block.reference) issues.push({ path: `/blocks/${index}/reference`, message: 'Enter a Scripture reference.' });
    else if (block.type === 'scriptureReading' && !block.resolved) issues.push({ path: `/blocks/${index}/resolved`, message: 'Fetch or paste the approved passage text.' });
    if ((block.type === 'song' || block.type === 'libraryText') && !block.libraryItemId) issues.push({ path: `/blocks/${index}/libraryItemId`, message: 'Choose an approved library item.' });
    if ((block.type === 'song' || block.type === 'libraryText') && !hasInlineLibraryContent && library && !library.items.some(item => item.id === block.libraryItemId && (!block.libraryItemVersion || item.version === block.libraryItemVersion))) {
      const title = block.type === 'libraryText' ? block.title : block.title ?? block.label;
      issues.push({ path: `/blocks/${index}/libraryItemId`, message: `The ${block.weeklyEditable ? '' : 'template-managed '}block “${title ?? block.libraryItemId}” references missing library item “${block.libraryItemId}”${block.libraryItemVersion ? ` version ${block.libraryItemVersion}` : ''}. Choose a replacement or remove the block from this bulletin.` });
    }
    if (block.type === 'song' && library) {
      const presentations = songPresentations(block, songLibraryItem(block, library));
      if (!presentations.includes(block.renderMode)) issues.push({
        path: `/blocks/${index}/renderMode`,
        message: block.renderMode === 'lyrics'
          ? 'The selected song does not include lyrics.'
          : 'The selected song does not include a music image or PDF.'
      });
    }
    if (block.type === 'fullPageAsset' && !block.asset?.path) issues.push({ path: `/blocks/${index}/asset/path`, message: 'Choose an asset.' });
    if (block.type === 'image' && !block.asset?.path) issues.push({ path: `/blocks/${index}/asset/path`, message: 'Choose an image.' });
    if (block.type === 'image' && block.asset?.mediaType === 'application/pdf') issues.push({ path: `/blocks/${index}/asset/mediaType`, message: 'Image blocks require PNG, JPEG, or SVG assets.' });
    if (block.type === 'canvas') {
      validateCanvasScene(block.scene, 0, `/blocks/${index}/scene`, block.widthMode === 'fullPage' ? 7 : 7 - (doc.layout?.marginIn ?? .4) * 2, block.heightIn)
        .filter(issue => issue.severity === 'error')
        .forEach(({ path, message }) => issues.push({ path, message }));
    }
    if (block.type === 'templatePage') {
      pageTemplateIssues({ blocks: block.blocks, margin: block.margin, layout: block.pageLayout }).forEach(message => issues.push({ path: `/blocks/${index}`, message }));
      const margin = pageTemplateMargin(block.margin, doc.layout?.marginIn ?? .4);
      block.blocks.filter(child => child.type === 'canvas').forEach((child, childIndex) => {
        validateCanvasScene(child.scene, 0, `/blocks/${index}/blocks/${childIndex}/scene`, child.widthMode === 'fullPage' ? 7 : 7 - margin * 2, child.heightIn)
          .filter(issue => issue.severity === 'error')
          .forEach(({ path, message }) => issues.push({ path, message }));
      });
      if (template) {
        const effectiveTemplate = { ...template, theme: { ...template.theme, marginIn: margin } };
        const used = block.blocks.reduce((total, child) => total + estimateBlockPoints(child, effectiveTemplate, library, doc as BulletinDocumentV1), 0);
        const capacity = (template.page.heightIn - margin * 2) * 72;
        if (used > capacity + .5) issues.push({
          path: `/blocks/${index}`,
          message: `Page template “${block.name}” overflows by ${((used - capacity) / 72).toFixed(2)} inches at the current host margin. Edit or explode it before export.`
        });
      }
    }
    if (block.type === 'templateInstance') {
      if (!block.source?.id || !Number.isInteger(block.source.version) || block.source.version < 1)
        issues.push({ path: `/blocks/${index}/source`, message: 'Choose a valid published template version.' });
    }
    if (block.type === 'custom') customBlockIssues(block).forEach(message => issues.push({ path: `/blocks/${index}`, message }));
  });
  if (doc.blocks) {
    const nestedIds = new Set(doc.blocks.map(block => block.id));
    for (const block of flattenBlocks(doc.blocks).filter(block => !doc.blocks!.includes(block))) {
      if (!block.id) issues.push({ path: '/blocks', message: 'Every nested block needs an ID.' });
      else if (nestedIds.has(block.id)) issues.push({ path: '/blocks', message: `Duplicate block ID: ${block.id}` });
      nestedIds.add(block.id);
    }
  }
  return issues;
}
