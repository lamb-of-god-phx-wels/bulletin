export type ScriptureTypographyPresetId = "readable" | "compact";

export interface SupportedScriptureTypographySnapshot extends Readonly<Record<string, unknown>> {
  readonly preset: ScriptureTypographyPresetId;
  readonly version: 1;
}

const IDS = new Set<ScriptureTypographyPresetId>(["readable", "compact"]);

export function scriptureTypographyPresetSnapshot(
  preset: ScriptureTypographyPresetId,
): SupportedScriptureTypographySnapshot {
  return Object.freeze({ preset, version: 1 });
}

/** Recognize only the closed snapshots that the v1 Typst generator renders. */
export function scriptureTypographyPresetId(
  value: Readonly<Record<string, unknown>> | undefined,
): ScriptureTypographyPresetId | undefined {
  if (value === undefined || Object.keys(value).length !== 2 || value["version"] !== 1) {
    return undefined;
  }
  const preset = value["preset"];
  return typeof preset === "string" && IDS.has(preset as ScriptureTypographyPresetId)
    ? preset as ScriptureTypographyPresetId
    : undefined;
}
