export function ToggleSwitch({ label, checked, disabled = false, className = '', onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange(checked: boolean): void;
}) {
  return <button
    type="button"
    role="switch"
    aria-label={label}
    aria-checked={checked}
    className={`property-toggle ${className}`.trim()}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  ><span aria-hidden="true" /></button>;
}
