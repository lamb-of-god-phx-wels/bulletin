import { useEffect, useState } from 'react';
import type { BulletinDocumentV1, LibraryManifestV1, TemplateV1 } from '../shared/types';
import { DocumentView } from './DocumentView';

export function BookletPreview({ document, template, library, root, onClose }: {
  document: BulletinDocumentV1;
  template: TemplateV1;
  library?: LibraryManifestV1;
  root?: string;
  onClose(): void;
}) {
  const [mode, setMode] = useState<'reading' | 'printer'>('reading');
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="booklet-preview" role="dialog" aria-modal="true" aria-labelledby="booklet-preview-title">
    <header>
      <div><div className="eyebrow">Pagination check</div><h2 id="booklet-preview-title">Booklet preview</h2><p>{mode === 'reading' ? 'See the pages as worshipers will encounter them after folding.' : 'See the fronts and backs of imposed printer sheets.'}</p></div>
      <div className="booklet-preview-actions">
        <div className="create-from-tabs" role="tablist" aria-label="Booklet preview mode">
          <button role="tab" aria-selected={mode === 'reading'} className={mode === 'reading' ? 'active' : ''} onClick={() => setMode('reading')}>Reading spreads</button>
          <button role="tab" aria-selected={mode === 'printer'} className={mode === 'printer' ? 'active' : ''} onClick={() => setMode('printer')}>Printer sheets</button>
        </div>
        <button className="secondary" onClick={onClose}>Done</button>
      </div>
    </header>
    {mode === 'printer' && <div className="booklet-print-hint">Print landscape, double-sided, flipping on the short edge. The PDF export itself remains in normal page order.</div>}
    <main><DocumentView document={document} template={template} library={library} root={root} rulers={false} guides={false} zoom={.42} bookletMode={mode} /></main>
  </div>;
}
