/**
 * @cbb/core/richtext — Rich-text AST, normalization, plain-text derivation,
 * and clipboard sanitization.
 *
 * Public surface for the richtext module. Consumers should import from this
 * barrel rather than from internal files directly.
 */

// Types (AST vocabulary + scripture structures).
export type {
  // Marks
  MarkKind,
  // Inline nodes
  InlineNode,
  TextNode,
  LineBreakNode,
  // Block nodes
  BlockNode,
  ParagraphBlock,
  HeadingBlock,
  ListItemBlock,
  BulletListBlock,
  OrderedListBlock,
  BlockquoteBlock,
  // Scripture
  ScriptureBlock,
  VerseStructuredScriptureBlock,
  ParagraphOnlyScriptureBlock,
  ScriptureVerse,
  ScriptureParagraph,
  ScriptureFormatting,
  ScriptureSourceCatalog,
  ScriptureTranslationRecord,
  ScriptureImportSnapshot,
  VerseStructuredImportSnapshot,
  ParagraphOnlyImportSnapshot,
  PasteImportSnapshot,
  ProviderImportSnapshot,
  ScriptureVerseBoundary,
  ScriptureParagraphBoundary,
  ScriptureImportReview,
  ImportReviewDisposition,
  // Document root
  RichTextDocument,
} from "./types.js";

export { MARK_ORDER, SCRIPTURE_FORMATTING_DEFAULTS } from "./types.js";

// Normalization.
export { normalize } from "./normalize.js";

// Runtime guard for generic field values before they enter resolution.
export {
  isRichTextDocument,
  MAX_RICH_TEXT_UNICODE_SCALARS,
} from "./validate.js";

// Plain-text derivation.
export { plainText } from "./plainText.js";

// Clipboard sanitization.
export {
  sanitizeExternalHtml,
  sanitizePlainText,
  HtmlSizeError,
  MAX_HTML_BYTES,
} from "./sanitize.js";
