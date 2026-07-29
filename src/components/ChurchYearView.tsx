import { ChurchWeekNamesEditor } from './ChurchWeekNamesEditor';
import type { LibraryManifestV1 } from '../shared/types';

export function ChurchYearView({ library, onSave, onDirtyChange }: {
  library: LibraryManifestV1;
  onSave(library: LibraryManifestV1): Promise<void>;
  onDirtyChange?(dirty: boolean): void;
}) {
  return <div className="library-screen church-year-screen">
    <div className="library-intro">
      <div>
        <div className="eyebrow">Shared settings</div>
        <h2>Church Year</h2>
        <p>Control how Service Builder’s designated church-week names appear across bulletins, templates, and bound cover text.</p>
      </div>
    </div>
    <ChurchWeekNamesEditor library={library} onSave={onSave} onDirtyChange={onDirtyChange} />
  </div>;
}
