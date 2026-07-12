/**
 * Runtime guard for rich-text values stored in generic field-value slots.
 *
 * This intentionally mirrors the persisted v1 rich-text and nested rights
 * schemas without depending on the schema catalog at resolution time. Tree and
 * opaque-JSON traversal are iterative so untrusted values cannot exhaust the
 * JavaScript call stack.
 */

const TRANSLATION_REF =
  /^translation:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CREDIT_REF =
  /^credit:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RFC3339_UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const ISO_DATE =
  /^(?:000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u;
const PHYSICAL_LENGTH = /^[0-9]+(?:\.[0-9]+)?(?:pt|in|cm|mm)$/u;
const HTTPS_URL = /^https:\/\//u;

/** spec.md hard cap for rendered rich-text Unicode scalars per document. */
export const MAX_RICH_TEXT_UNICODE_SCALARS = 5_000_000;

type JsonRecord = Readonly<Record<string, unknown>>;
type Validator = (value: unknown) => boolean;
interface ScalarBudget {
  remaining: number;
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function allowedKeys(value: JsonRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function optional(
  value: JsonRecord,
  key: string,
  validate: Validator,
): boolean {
  return !Object.hasOwn(value, key) || validate(value[key]);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function arrayOf(
  value: unknown,
  validate: Validator,
  minimumItems = 0,
): value is readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimumItems) return false;
  for (let index = 0; index < value.length; index += 1) {
    // Indexing (instead of Array#every) deliberately rejects sparse arrays.
    if (!validate(value[index])) return false;
  }
  return true;
}

/** JSON Schema string lengths count Unicode code points, not UTF-16 units. */
function codePointLengthAtMost(value: string, maximum: number): boolean {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximum) return false;
  }
  return true;
}

function consumeScalars(value: string, budget: ScalarBudget): boolean {
  for (const _character of value) {
    budget.remaining -= 1;
    if (budget.remaining < 0) return false;
  }
  return true;
}

/** Validate an arbitrary JSON object without recursive descent. */
function jsonObject(value: unknown): boolean {
  if (!record(value)) return false;
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== "object") return false;
    if (seen.has(current)) return false;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
      continue;
    }
    for (const entry of Object.values(current)) pending.push(entry);
  }
  return true;
}

const INLINE_KEYS = new Set(["type", "text", "marks"]);
const LINE_BREAK_KEYS = new Set(["type"]);
const MARKS = new Set(["strong", "emphasis"]);

function inline(value: unknown, budget: ScalarBudget): boolean {
  if (!record(value)) return false;
  if (value["type"] === "lineBreak") {
    return allowedKeys(value, LINE_BREAK_KEYS);
  }
  if (
    value["type"] !== "text" ||
    !nonemptyString(value["text"]) ||
    !allowedKeys(value, INLINE_KEYS) ||
    !consumeScalars(value["text"], budget)
  ) {
    return false;
  }
  if (!Object.hasOwn(value, "marks")) return true;
  const marks = value["marks"];
  if (!arrayOf(marks, (mark) => MARKS.has(String(mark)))) {
    return false;
  }
  // The schema describes this canonical persisted order in addition to
  // declaring uniqueItems.
  return (
    new Set(marks).size === marks.length &&
    (marks.length < 2 || (marks[0] === "strong" && marks[1] === "emphasis"))
  );
}

function inlines(value: unknown, budget: ScalarBudget): boolean {
  return arrayOf(value, (entry) => inline(entry, budget));
}

const CONTRIBUTOR_KEYS = new Set(["name", "role"]);
const CONTRIBUTOR_ROLES = new Set([
  "author", "composer", "arranger", "translator", "adapter", "publisher", "other",
]);

function contributor(value: unknown): boolean {
  return record(value) &&
    allowedKeys(value, CONTRIBUTOR_KEYS) &&
    nonemptyString(value["name"]) &&
    CONTRIBUTOR_ROLES.has(String(value["role"]));
}

const PUBLICATION_LICENSE_KEYS = new Set([
  "providerLabel", "displayLine", "sourceDisplayRevisionHash",
  "effectiveFrom", "effectiveThrough",
]);

function publicationLicenseDisplay(value: unknown): boolean {
  return record(value) &&
    allowedKeys(value, PUBLICATION_LICENSE_KEYS) &&
    nonemptyString(value["providerLabel"]) &&
    nonemptyString(value["displayLine"]) &&
    matches(value["sourceDisplayRevisionHash"], SHA256) &&
    optional(value, "effectiveFrom", (entry) => matches(entry, ISO_DATE)) &&
    optional(value, "effectiveThrough", (entry) => matches(entry, ISO_DATE));
}

const USAGE_CONSTRAINT_KEYS = new Set([
  "metric", "scope", "limit", "basisMetric", "basisUnitCount",
]);
const USAGE_METRICS = new Set(["verses", "words", "passages", "portionBasisPoints"]);
const USAGE_SCOPES = new Set(["passage", "bulletin", "translation"]);
const BASIS_METRICS = new Set(["verses", "words"]);

function usagePolicyConstraint(value: unknown): boolean {
  if (
    !record(value) ||
    !allowedKeys(value, USAGE_CONSTRAINT_KEYS) ||
    !USAGE_METRICS.has(String(value["metric"])) ||
    !USAGE_SCOPES.has(String(value["scope"])) ||
    !nonnegativeInteger(value["limit"]) ||
    !optional(value, "basisMetric", (entry) => BASIS_METRICS.has(String(entry))) ||
    !optional(value, "basisUnitCount", positiveInteger)
  ) {
    return false;
  }
  return value["metric"] !== "portionBasisPoints" ||
    (BASIS_METRICS.has(String(value["basisMetric"])) && positiveInteger(value["basisUnitCount"]));
}

const USAGE_POLICY_KEYS = new Set([
  "providerRuleId", "providerRuleVersion", "applicablePublicationContexts",
  "quotationConstraints", "requiredPublicationDisclosureLine", "policySourceHash",
  "counterIdVersion",
]);
const PUBLICATION_CONTEXTS = new Set([
  "printedNonsalableChurchBulletin", "digitalNonsalableChurchBulletin",
]);

function usagePolicySnapshot(value: unknown): boolean {
  if (
    !record(value) ||
    !allowedKeys(value, USAGE_POLICY_KEYS) ||
    !nonemptyString(value["providerRuleId"]) ||
    !nonemptyString(value["providerRuleVersion"]) ||
    !arrayOf(
      value["applicablePublicationContexts"],
      (context) => PUBLICATION_CONTEXTS.has(String(context)),
      1,
    ) ||
    new Set(value["applicablePublicationContexts"]).size !==
      value["applicablePublicationContexts"].length ||
    !matches(value["policySourceHash"], SHA256) ||
    !nonemptyString(value["counterIdVersion"]) ||
    !optional(value, "requiredPublicationDisclosureLine", nonemptyString)
  ) {
    return false;
  }
  return optional(
    value,
    "quotationConstraints",
    (constraints) => arrayOf(constraints, usagePolicyConstraint),
  );
}

/** Linear equivalent of the rights schema's normalized publication-line rule. */
function requiredCreditLine(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  let lineHasContent = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0a) {
      if (!lineHasContent) return false;
      lineHasContent = false;
      continue;
    }
    if (
      code === 0x0d ||
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      return false;
    }
    lineHasContent = true;
  }
  return lineHasContent;
}

const RIGHTS_KEYS = new Set([
  "creditKey", "creditProjectionHash", "component", "status", "workTitle",
  "edition", "arrangement", "tune", "translationIdentity", "contributors",
  "copyrightYear", "copyrightHolder", "administrator", "licenseProvider",
  "providerSongId", "providerCatalogId", "providerReportingId",
  "creditRequiredWhen", "requiredCreditLine", "publicationLicenseDisplay",
  "usagePolicySnapshot", "metadataSourceHash", "retrievalTime",
]);
const RIGHTS_COMPONENTS = new Set([
  "text", "tune", "arrangement", "translation", "setting", "recording",
  "scriptureTranslation", "other",
]);
const RIGHTS_STATUSES = new Set(["copyrighted", "publicDomain", "unknown"]);
const CREDIT_REQUIREMENTS = new Set(["always", "renderedText", "never"]);

function rightsRecord(value: unknown): boolean {
  if (
    !record(value) ||
    !allowedKeys(value, RIGHTS_KEYS) ||
    !matches(value["creditKey"], CREDIT_REF) ||
    !matches(value["creditProjectionHash"], SHA256) ||
    !RIGHTS_COMPONENTS.has(String(value["component"])) ||
    !RIGHTS_STATUSES.has(String(value["status"])) ||
    !arrayOf(value["contributors"], contributor) ||
    !CREDIT_REQUIREMENTS.has(String(value["creditRequiredWhen"])) ||
    !optional(value, "workTitle", isString) ||
    !optional(value, "edition", isString) ||
    !optional(value, "arrangement", isString) ||
    !optional(value, "tune", isString) ||
    !optional(value, "translationIdentity", isString) ||
    !optional(value, "copyrightYear", (entry) => Number.isInteger(entry)) ||
    !optional(value, "copyrightHolder", isString) ||
    !optional(value, "administrator", isString) ||
    !optional(value, "licenseProvider", isString) ||
    !optional(value, "providerSongId", isString) ||
    !optional(value, "providerCatalogId", isString) ||
    !optional(value, "providerReportingId", isString) ||
    !optional(value, "requiredCreditLine", requiredCreditLine) ||
    !optional(value, "publicationLicenseDisplay", publicationLicenseDisplay) ||
    !optional(value, "usagePolicySnapshot", usagePolicySnapshot) ||
    !optional(value, "metadataSourceHash", (entry) => matches(entry, SHA256)) ||
    !optional(value, "retrievalTime", (entry) => matches(entry, RFC3339_UTC))
  ) {
    return false;
  }
  return value["creditRequiredWhen"] === "never" || requiredCreditLine(value["requiredCreditLine"]);
}

const FORMATTING_KEYS = new Set([
  "referencePlacement", "verseNumberStyle", "paragraphPolicy",
  "paragraphSpacing", "translationLabelPlacement", "typographyPresetSnapshot",
]);

function formatting(value: unknown): boolean {
  return record(value) &&
    allowedKeys(value, FORMATTING_KEYS) &&
    (value["referencePlacement"] === "before" || value["referencePlacement"] === "after") &&
    ["inline", "superscript", "hidden"].includes(String(value["verseNumberStyle"])) &&
    (value["paragraphPolicy"] === "publisher" || value["paragraphPolicy"] === "oneVerse") &&
    matches(value["paragraphSpacing"], PHYSICAL_LENGTH) &&
    ["withReference", "afterPassage", "hidden"].includes(
      String(value["translationLabelPlacement"]),
    ) &&
    optional(value, "typographyPresetSnapshot", jsonObject);
}

const SOURCE_CATALOG_KEYS = new Set([
  "translationId", "catalogRevision", "revisionHash", "displayLabel", "sourceLabel",
]);

function sourceCatalog(value: unknown): boolean {
  return record(value) &&
    allowedKeys(value, SOURCE_CATALOG_KEYS) &&
    matches(value["translationId"], TRANSLATION_REF) &&
    positiveInteger(value["catalogRevision"]) &&
    matches(value["revisionHash"], SHA256) &&
    optional(value, "displayLabel", isString) &&
    optional(value, "sourceLabel", isString);
}

const IMPORT_REVIEW_KEYS = new Set([
  "disposition", "reviewedFidelityHash", "reviewedRightsProjectionHash", "reviewTime",
]);

function importReview(value: unknown): boolean {
  return record(value) &&
    allowedKeys(value, IMPORT_REVIEW_KEYS) &&
    value["disposition"] === "changesConfirmed" &&
    matches(value["reviewedFidelityHash"], SHA256) &&
    matches(value["reviewedRightsProjectionHash"], SHA256) &&
    matches(value["reviewTime"], RFC3339_UTC);
}

const VERSE_BOUNDARY_KEYS = new Set(["verseId", "label"]);
const PARAGRAPH_BOUNDARY_KEYS = new Set(["paragraphIndex", "content"]);

function verseBoundaries(value: unknown): boolean {
  return arrayOf(value, (boundary) =>
    record(boundary) &&
    allowedKeys(boundary, VERSE_BOUNDARY_KEYS) &&
    nonemptyString(boundary["verseId"]) &&
    nonemptyString(boundary["label"]),
  1);
}

function paragraphBoundaries(value: unknown): boolean {
  return arrayOf(value, (boundary) =>
    record(boundary) &&
    allowedKeys(boundary, PARAGRAPH_BOUNDARY_KEYS) &&
    nonnegativeInteger(boundary["paragraphIndex"]) &&
    optional(boundary, "content", isString),
  1);
}

const IMPORT_COMMON_KEYS = [
  "sourceKind", "structureKind", "displayReference", "canonicalReference",
  "translationId", "translationLabel", "normalizerId", "normalizerVersion",
  "sourceText", "sourceTextHash", "importedFidelityHash", "rightsProjectionHash",
  "verseBoundaries", "paragraphBoundaries", "sourceUrl",
] as const;
const PASTE_IMPORT_KEYS = new Set([...IMPORT_COMMON_KEYS, "sourceLabel"]);
const PROVIDER_IMPORT_KEYS = new Set([
  ...IMPORT_COMMON_KEYS, "providerId", "adapterId", "adapterVersion",
  "requestedReference", "requestedTranslationId", "retrievalTime",
]);

function importSnapshot(
  value: unknown,
  expectedStructure: "verseStructured" | "paragraphOnly",
): boolean {
  if (!record(value) || value["structureKind"] !== expectedStructure) return false;
  const sourceKind = value["sourceKind"];
  const allowed = sourceKind === "paste"
    ? PASTE_IMPORT_KEYS
    : sourceKind === "provider"
      ? PROVIDER_IMPORT_KEYS
      : undefined;
  if (
    allowed === undefined ||
    !allowedKeys(value, allowed) ||
    !isString(value["displayReference"]) ||
    !matches(value["translationId"], TRANSLATION_REF) ||
    !nonemptyString(value["translationLabel"]) ||
    !nonemptyString(value["normalizerId"]) ||
    !nonemptyString(value["normalizerVersion"]) ||
    !isString(value["sourceText"]) ||
    !matches(value["sourceTextHash"], SHA256) ||
    !matches(value["importedFidelityHash"], SHA256) ||
    !matches(value["rightsProjectionHash"], SHA256) ||
    !optional(value, "canonicalReference", nonemptyString) ||
    !optional(value, "verseBoundaries", verseBoundaries) ||
    !optional(value, "paragraphBoundaries", paragraphBoundaries) ||
    !optional(value, "sourceUrl", (entry) => matches(entry, HTTPS_URL))
  ) {
    return false;
  }
  if (
    expectedStructure === "verseStructured" &&
    (!nonemptyString(value["canonicalReference"]) || !verseBoundaries(value["verseBoundaries"]))
  ) {
    return false;
  }
  if (
    expectedStructure === "paragraphOnly" &&
    !paragraphBoundaries(value["paragraphBoundaries"])
  ) {
    return false;
  }
  if (sourceKind === "paste") {
    return optional(value, "sourceLabel", isString);
  }
  return nonemptyString(value["providerId"]) &&
    nonemptyString(value["adapterId"]) &&
    nonemptyString(value["adapterVersion"]) &&
    nonemptyString(value["requestedReference"]) &&
    matches(value["requestedTranslationId"], TRANSLATION_REF) &&
    matches(value["retrievalTime"], RFC3339_UTC);
}

const VERSE_KEYS = new Set(["verseId", "label", "paragraphStart", "children"]);
const SCRIPTURE_PARAGRAPH_KEYS = new Set(["type", "children"]);
const SCRIPTURE_COMMON_KEYS = [
  "type", "structureKind", "reference", "canonicalReference", "translationId",
  "translationLabel", "sourceCatalog", "formattingOverride", "importSnapshot",
  "importReview", "rights",
] as const;
const VERSE_SCRIPTURE_KEYS = new Set([...SCRIPTURE_COMMON_KEYS, "verses"]);
const PARAGRAPH_SCRIPTURE_KEYS = new Set([...SCRIPTURE_COMMON_KEYS, "paragraphs"]);

function scripture(value: JsonRecord, budget: ScalarBudget): boolean {
  const structure = value["structureKind"];
  if (structure !== "verseStructured" && structure !== "paragraphOnly") return false;
  const allowed = structure === "verseStructured"
    ? VERSE_SCRIPTURE_KEYS
    : PARAGRAPH_SCRIPTURE_KEYS;
  if (
    !allowedKeys(value, allowed) ||
    value["type"] !== "scripture" ||
    !matches(value["translationId"], TRANSLATION_REF) ||
    !arrayOf(value["rights"], rightsRecord, 1) ||
    !optional(value, "sourceCatalog", sourceCatalog) ||
    !optional(value, "formattingOverride", formatting) ||
    !optional(value, "importSnapshot", (entry) => importSnapshot(entry, structure)) ||
    !optional(value, "importReview", importReview)
  ) {
    return false;
  }
  const catalog = value["sourceCatalog"];
  if (record(catalog) && catalog["translationId"] !== value["translationId"]) {
    return false;
  }
  const snapshot = value["importSnapshot"];
  if (
    record(snapshot) &&
    (snapshot["translationId"] !== value["translationId"] ||
      snapshot["translationLabel"] !== value["translationLabel"])
  ) {
    return false;
  }
  if (Object.hasOwn(value, "importReview") && !Object.hasOwn(value, "importSnapshot")) {
    return false;
  }
  if (structure === "verseStructured") {
    const verseIds = new Set<string>();
    return nonemptyString(value["reference"]) &&
      isString(value["canonicalReference"]) &&
      nonemptyString(value["translationLabel"]) &&
      consumeScalars(value["reference"], budget) &&
      consumeScalars(value["translationLabel"], budget) &&
      arrayOf(value["verses"], (verse) =>
        record(verse) &&
        allowedKeys(verse, VERSE_KEYS) &&
        nonemptyString(verse["verseId"]) &&
        !verseIds.has(verse["verseId"]) &&
        (verseIds.add(verse["verseId"]), true) &&
        nonemptyString(verse["label"]) &&
        codePointLengthAtMost(verse["label"], 20) &&
        consumeScalars(verse["label"], budget) &&
        typeof verse["paragraphStart"] === "boolean" &&
        inlines(verse["children"], budget),
      1);
  }
  const imported = Object.hasOwn(value, "importSnapshot");
  return (!imported ||
      (nonemptyString(value["reference"]) && nonemptyString(value["translationLabel"]))) &&
    optional(value, "reference", (entry) =>
      isString(entry) && consumeScalars(entry, budget)) &&
    optional(value, "canonicalReference", isString) &&
    optional(value, "translationLabel", (entry) =>
      isString(entry) && consumeScalars(entry, budget)) &&
    arrayOf(value["paragraphs"], (paragraph) =>
      record(paragraph) &&
      allowedKeys(paragraph, SCRIPTURE_PARAGRAPH_KEYS) &&
      paragraph["type"] === "paragraph" &&
      inlines(paragraph["children"], budget),
    1);
}

const PARAGRAPH_KEYS = new Set(["type", "children"]);
const HEADING_KEYS = new Set(["type", "level", "children"]);
const BULLET_LIST_KEYS = new Set(["type", "children"]);
const ORDERED_LIST_KEYS = new Set(["type", "start", "children"]);
const LIST_ITEM_KEYS = new Set(["type", "children"]);
const BLOCKQUOTE_KEYS = new Set(["type", "children"]);
const DOCUMENT_KEYS = new Set(["type", "blocks"]);

type BlockContext = "root" | "blockquote" | "listItem";
interface BlockTask {
  readonly value: unknown;
  readonly context: BlockContext;
  /** One for the outermost list and four for the deepest permitted list. */
  readonly listDepth: number;
}

function blocksAreValid(blocks: readonly unknown[]): boolean {
  const scalarBudget: ScalarBudget = { remaining: MAX_RICH_TEXT_UNICODE_SCALARS };
  const pending: BlockTask[] = [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    pending.push({ value: blocks[index], context: "root", listDepth: 0 });
  }
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === undefined || !record(task.value)) return false;
    const value = task.value;
    switch (value["type"]) {
      case "paragraph":
        if (
          !allowedKeys(value, PARAGRAPH_KEYS) ||
          !inlines(value["children"], scalarBudget)
        ) return false;
        break;
      case "heading":
        if (
          task.context !== "root" ||
          !allowedKeys(value, HEADING_KEYS) ||
          !Number.isInteger(value["level"]) ||
          Number(value["level"]) < 1 ||
          Number(value["level"]) > 6 ||
          !inlines(value["children"], scalarBudget)
        ) return false;
        break;
      case "scripture":
        if (task.context !== "root" || !scripture(value, scalarBudget)) return false;
        break;
      case "blockquote": {
        if (
          task.context !== "root" ||
          !allowedKeys(value, BLOCKQUOTE_KEYS) ||
          !Array.isArray(value["children"]) ||
          value["children"].length === 0
        ) return false;
        for (let index = value["children"].length - 1; index >= 0; index -= 1) {
          pending.push({ value: value["children"][index], context: "blockquote", listDepth: 0 });
        }
        break;
      }
      case "bulletList":
      case "orderedList": {
        const depth = task.context === "listItem" ? task.listDepth + 1 : 1;
        const keys = value["type"] === "orderedList" ? ORDERED_LIST_KEYS : BULLET_LIST_KEYS;
        if (
          depth > 4 ||
          !allowedKeys(value, keys) ||
          (value["type"] === "orderedList" &&
            !optional(value, "start", positiveInteger)) ||
          !Array.isArray(value["children"]) ||
          value["children"].length === 0
        ) return false;
        for (let index = value["children"].length - 1; index >= 0; index -= 1) {
          const item = value["children"][index];
          if (
            !record(item) ||
            item["type"] !== "listItem" ||
            !allowedKeys(item, LIST_ITEM_KEYS) ||
            !Array.isArray(item["children"]) ||
            item["children"].length === 0
          ) return false;
          for (let childIndex = item["children"].length - 1; childIndex >= 0; childIndex -= 1) {
            pending.push({
              value: item["children"][childIndex],
              context: "listItem",
              listDepth: depth,
            });
          }
        }
        break;
      }
      default:
        return false;
    }
    if (
      task.context !== "root" &&
      value["type"] !== "paragraph" &&
      value["type"] !== "bulletList" &&
      value["type"] !== "orderedList"
    ) {
      return false;
    }
  }
  return true;
}

export function isRichTextDocument(value: unknown): boolean {
  try {
    return record(value) &&
      value["type"] === "document" &&
      allowedKeys(value, DOCUMENT_KEYS) &&
      Array.isArray(value["blocks"]) &&
      blocksAreValid(value["blocks"]);
  } catch {
    // A persisted JSON value cannot contain throwing accessors/proxies. Treat
    // such runtime input as invalid instead of leaking an exception to resolve.
    return false;
  }
}
