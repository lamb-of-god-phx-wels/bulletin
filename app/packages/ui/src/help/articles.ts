export interface HelpArticle {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly paragraphs: readonly string[];
  readonly keywords: readonly string[];
}

export const HELP_ARTICLES: readonly HelpArticle[] = Object.freeze([
  {
    id: "first-bulletin",
    title: "Make your first bulletin",
    summary: "Choose a starter, fill this week’s details, and check the working preview.",
    paragraphs: [
      "From This Week, choose Create This Week’s Bulletin. Pick a starter that matches the finished page you want.",
      "Use Weekly Content for ordinary changes. Your edits are saved to the bulletin in this library.",
      "Open the PDF preview to check each page while you work. Preview current means it includes the latest saved visual changes.",
    ],
    keywords: ["first", "starter", "create", "begin"],
  },
  {
    id: "weekly-content",
    title: "Edit this week’s content",
    summary: "Change linked text and dates while the template’s layout stays protected.",
    paragraphs: [
      "Keep Weekly Content selected for routine bulletin work. Select visible text or a date to change its linked weekly value.",
      "Switch to Customize Layout only when you intend to change structure, page setup, weekly-field connections, or protection rules.",
    ],
    keywords: ["weekly", "content", "text", "date", "protected"],
  },
  {
    id: "edit-text",
    title: "Edit and format text",
    summary: "Open direct text editing without changing the bulletin’s layout.",
    paragraphs: [
      "Select a text item and press Enter or F2 to edit it directly. Use the formatting controls for headings, bold, italic, bulleted or numbered lists, and block quotes.",
      "Finish the direct edit to return to page navigation. Undo remains available for committed changes.",
    ],
    keywords: ["text", "format", "heading", "list", "direct edit"],
  },
  {
    id: "template-creation",
    title: "Create and test a template",
    summary: "Turn a bulletin into a reusable starting point without editing code.",
    paragraphs: [
      "Open Customize Layout and choose Save this bulletin as a template. Review every value that might belong only to one week.",
      "Use Make this a weekly field for content volunteers should fill. Protect layout after the structure is ready, then use Test weekly workflow.",
    ],
    keywords: ["template", "weekly field", "lock", "test"],
  },
  {
    id: "saved-sections",
    title: "Reuse a Saved Section in this bulletin",
    summary: "Save selected content inside the current bulletin and insert another linked copy.",
    paragraphs: [
      "In Customize Layout, select a section, open Saved Sections, give it a name, and choose Save section for reuse.",
      "Inserted copies stay linked inside this bulletin. Choose Make independent when one copy should change on its own.",
    ],
    keywords: ["saved section", "reuse", "insert", "copy", "independent"],
  },
  {
    id: "accessible-authoring",
    title: "Make content easier for everyone to use",
    summary: "Use meaningful headings, image descriptions, table headers, and a reviewed reading order.",
    paragraphs: [
      "Choose heading levels for meaning rather than visual size. Describe meaningful images or mark decorative images as decorative.",
      "For a data table, identify header rows or columns and write a short summary. Check canvas and page-item reading order when it differs from paint order.",
    ],
    keywords: ["accessible", "headings", "alt text", "images", "reading order", "table"],
  },
  {
    id: "image-description",
    title: "Add an image description",
    summary: "Describe a meaningful installed image or mark it decorative.",
    paragraphs: [
      "In Customize Layout, add an installed image from Structure and select it on the page.",
      "Open Accessibility in the inspector. Write a concise description for a meaningful image, or mark a purely visual image decorative.",
    ],
    keywords: ["image", "description", "alternative text", "decorative", "accessibility"],
  },
  {
    id: "template-test",
    title: "Test a template without changing your library",
    summary: "Try weekly fields, optional sections, and repeated items in a disposable test.",
    paragraphs: [
      "Open a template in Customize Layout and choose Test weekly workflow after its weekly fields and section rules are ready.",
      "Reset or exit when you are done. Values entered in this test are discarded and never create a bulletin in the library.",
    ],
    keywords: ["template", "test", "weekly workflow", "disposable", "reset"],
  },
  {
    id: "preview-check",
    title: "Check the PDF preview while you work",
    summary: "Compare the current or last successful preview with your latest edits.",
    paragraphs: [
      "Preview current means the displayed pages match the latest saved visual changes. Use thumbnails, the page outline, or the page controls to inspect them.",
      "Preview out of date means the displayed pages are an earlier successful preview. Keep editing or wait for the preview to update.",
    ],
    keywords: ["PDF", "preview", "page", "current", "out of date"],
  },
  {
    id: "page-layout",
    title: "Change page size and layout",
    summary: "Adjust finished-page size, margins, columns, and page furniture in Customize Layout.",
    paragraphs: [
      "Select the document or a section, then use the Layout inspector for finished-page size, margins, spacing, columns, and placement.",
      "Use Structure for headers, footers, page numbers, backgrounds, and reading order. The working preview updates after saved changes.",
    ],
    keywords: ["page", "layout", "margin", "columns", "header", "footer"],
  },
  {
    id: "glossary",
    title: "Plain-language glossary",
    summary: "Quick definitions for the words used in normal bulletin work.",
    paragraphs: [
      "Weekly Content is the protected mode for ordinary bulletin changes. Customize Layout is the advanced mode for structure, page setup, and template rules.",
      "A Saved section is reusable bulletin content. A Linked weekly field connects visible content to a reusable weekly value. Make independent keeps the current value and removes that link.",
      "Preview current means the displayed PDF matches the latest saved visual content. Needs attention marks an editor check that should be reviewed.",
    ],
    keywords: ["glossary", "meaning", "weekly content", "customize layout", "saved section"],
  },
]);

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

export function searchHelp(query: string): readonly HelpArticle[] {
  const tokens = normalize(query).split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0) return HELP_ARTICLES;
  return HELP_ARTICLES.filter((article) => {
    const searchable = normalize([article.title, article.summary, ...article.paragraphs, ...article.keywords].join(" "));
    return tokens.every((token) => searchable.includes(token));
  });
}
