import type { PreferredOutput } from "./FirstRunFlow.js";
import type { StarterId } from "./starters.js";

export type FirstRunDisposition = "completed" | "skipped";

export type FirstRunStep = 0 | 1 | 2;

export interface FirstRunContactValues {
  readonly churchName?: string;
  readonly mailingAddress?: string;
  readonly locationAddress?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly logo?: string;
}

/**
 * Output-inert, workspace-local first-run state. Keeping this beside the
 * workspace preferences makes setup resumable for each bulletin library while
 * ensuring it can never affect portable bulletin JSON or generated PDF bytes.
 */
export interface FirstRunPreference {
  readonly version: 1;
  readonly disposition: FirstRunDisposition | "inProgress";
  readonly step?: FirstRunStep;
  readonly churchName?: string;
  readonly mailingAddress?: string;
  readonly locationAddress?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly logo?: string;
  readonly preferredOutput?: PreferredOutput;
  readonly starterId?: StarterId;
  readonly createPracticeBulletin?: boolean;
  readonly tourCompleted?: boolean;
  readonly tourBulletinLocalResourceId?: string;
}

export type FirstRunDraft = FirstRunPreference & {
  readonly disposition: "inProgress";
};

const STARTERS = new Set<StarterId>([
  "simple-service",
  "folded-letter",
  "announcements",
  "blank-accessible",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSAFE_OPTIONAL_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 120 ||
    value.normalize("NFC") !== value || value.trim() !== value || UNSAFE_OPTIONAL_TEXT.test(value)) {
    return undefined;
  }
  return value;
}

export function parseFirstRunPreference(value: unknown): FirstRunPreference | undefined {
  if (!record(value) || value["version"] !== 1) return undefined;
  const disposition = value["disposition"];
  if (disposition !== "completed" && disposition !== "skipped" && disposition !== "inProgress") return undefined;
  const preferredOutput = value["preferredOutput"];
  const starterId = value["starterId"];
  const tourBulletinLocalResourceId = value["tourBulletinLocalResourceId"];
  const step = value["step"];
  const parsed: {
    version: 1;
    disposition: FirstRunPreference["disposition"];
    step?: FirstRunStep;
    churchName?: string;
    mailingAddress?: string;
    locationAddress?: string;
    phone?: string;
    email?: string;
    website?: string;
    logo?: string;
    preferredOutput?: PreferredOutput;
    starterId?: StarterId;
    createPracticeBulletin?: boolean;
    tourCompleted?: boolean;
    tourBulletinLocalResourceId?: string;
  } = {
    version: 1 as const,
    disposition,
  };
  if (disposition === "inProgress") {
    if (step === 0 || step === 1 || step === 2) parsed.step = step;
    for (const key of [
      "churchName",
      "mailingAddress",
      "locationAddress",
      "phone",
      "email",
      "website",
    ] as const) {
      const text = optionalText(value[key]);
      if (text !== undefined) parsed[key] = text;
    }
    if (typeof value["logo"] === "string" &&
      /^asset:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value["logo"])) {
      parsed.logo = value["logo"];
    }
    if (typeof value["createPracticeBulletin"] === "boolean") {
      parsed.createPracticeBulletin = value["createPracticeBulletin"];
    }
  }
  if (preferredOutput === "fullSheet" || preferredOutput === "foldedBooklet" || preferredOutput === "other") {
    parsed.preferredOutput = preferredOutput;
  }
  if (typeof starterId === "string" && STARTERS.has(starterId as StarterId)) {
    parsed.starterId = starterId as StarterId;
  }
  if (disposition !== "inProgress") {
    if (typeof value["tourCompleted"] === "boolean") parsed.tourCompleted = value["tourCompleted"];
    if (typeof tourBulletinLocalResourceId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(tourBulletinLocalResourceId)) {
      parsed.tourBulletinLocalResourceId = tourBulletinLocalResourceId;
    }
  }
  return Object.freeze(parsed);
}

export function firstRunFinished(value: unknown): boolean {
  const parsed = parseFirstRunPreference(value);
  return parsed?.disposition === "completed" || parsed?.disposition === "skipped";
}
