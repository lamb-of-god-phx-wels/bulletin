import { useEffect, useState } from 'react';
import type { ResponsiveReadingRole, ResponsiveReadingSettings } from '../shared/types';
import { responsiveReadingSettingsIssues, shouldItalicizeSilentPrayer } from '../shared/responsiveReading';

const roles: Array<{ role: ResponsiveReadingRole; label: string }> = [
  { role: 'leader', label: 'Leader' },
  { role: 'follower', label: 'Follower / congregation' },
  { role: 'all', label: 'All' },
];

export function ResponsiveReadingSettingsFields({ value, onChange }: {
  value: ResponsiveReadingSettings;
  onChange(value: ResponsiveReadingSettings): void;
}) {
  const [draft, setDraft] = useState(value);
  const signature = JSON.stringify(value);
  useEffect(() => setDraft(value), [signature]);
  const issues = responsiveReadingSettingsIssues(draft);
  return <div className="responsive-reading-settings-fields">
    <div className="field-row responsive-reader-labels">
      {roles.map(({ role, label }) => <label key={role}>{label}<input
        value={draft.labels[role]}
        aria-invalid={issues.length > 0}
        onChange={event => {
          const next = { ...draft, labels: { ...draft.labels, [role]: event.target.value } };
          setDraft(next);
          if (!responsiveReadingSettingsIssues(next).length) onChange(next);
        }}
      /></label>)}
    </div>
    <div className="responsive-reading-toggle-row"><span>Italicize &quot;Silent Prayer&quot;</span><button type="button" role="switch" aria-label={'Italicize "Silent Prayer"'} aria-checked={shouldItalicizeSilentPrayer(draft)} className="property-toggle" onClick={() => {
      const next = { ...draft, italicizeSilentPrayer: !shouldItalicizeSilentPrayer(draft) };
      setDraft(next);
      onChange(next);
    }}><span aria-hidden="true" /></button></div>
    {issues.map(issue => <small className="validation warning" role="alert" key={issue}>{issue}</small>)}
  </div>;
}
