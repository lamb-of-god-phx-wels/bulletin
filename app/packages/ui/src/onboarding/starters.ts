import type {
  CbbDocument,
  FieldContract,
  NativeElement,
  RightsAttributionElement,
  TextElement,
} from "@cbb/core";

export type StarterId =
  | "simple-service"
  | "folded-letter"
  | "announcements"
  | "blank-accessible";

export interface StarterCatalogEntry {
  readonly id: StarterId;
  readonly name: string;
  readonly description: string;
  readonly outputDescription: string;
  readonly requiredItemCount: number;
  readonly document: CbbDocument;
}

function richText(id: string, name: string, text: string, level?: 1 | 2): TextElement {
  return {
    id,
    type: "text",
    name,
    width: "100%",
    height: "auto",
    data: {
      content: {
        kind: "richText",
        document: {
          type: "document",
          blocks: level === undefined
            ? [{ type: "paragraph", children: [{ type: "text", text }] }]
            : [{ type: "heading", level, children: [{ type: "text", text }] }],
        },
      },
    },
  };
}

function weeklyText(id: string, name: string, fieldId: string, fallback: string): TextElement {
  return {
    id,
    type: "text",
    name,
    width: "100%",
    height: "auto",
    bindings: [{
      id: `${id}Binding`,
      scope: "document",
      fieldId,
      target: "/data/content/text",
      fallback,
    }],
    data: { content: { kind: "plain" } },
  };
}

function rights(id: string): RightsAttributionElement {
  return {
    id,
    type: "rightsAttribution",
    name: "Copyrights & Permissions",
    width: "100%",
    height: "auto",
    authoringPolicy: { layoutLocked: true },
    data: {
      heading: "Copyrights & Permissions",
      groupOrder: ["scripture", "music", "other"],
      sortPolicy: "firstAppearance",
      includePublicDomainLines: false,
    },
  };
}

function fieldContract(id: string, name: string): FieldContract {
  return {
    id,
    version: 1,
    name,
    groups: [{ id: "serviceDetails", label: "Service details" }],
    fields: [
      {
        id: "publicationDate",
        label: "Publication date",
        description: "The date shown on this bulletin.",
        type: "date",
        required: true,
        groupId: "serviceDetails",
        semanticRole: "publicationDate",
        weeklyBehavior: {
          rolloverPolicy: "deriveConfirm",
          reviewExpectation: "everyBulletin",
          derivation: { kind: "nextScheduledServiceDate" },
        },
      },
      {
        id: "serviceName",
        label: "Service or gathering title",
        description: "For example, Sunday worship or Community gathering.",
        type: "text",
        required: true,
        groupId: "serviceDetails",
        weeklyBehavior: {
          rolloverPolicy: "keep",
          reviewExpectation: "whenCarried",
        },
      },
    ],
  };
}

function baseTemplate(
  name: string,
  contractId: string,
  elements: readonly NativeElement[],
  page: CbbDocument["page"],
): CbbDocument {
  return {
    version: 2,
    kind: "template",
    name,
    metadata: { title: name, language: "en-US" },
    page,
    authoringPolicy: { layoutLocked: true },
    rightsPolicy: { unknownRightsPolicy: "review" },
    publicationContexts: [
      "printedNonsalableChurchBulletin",
      "digitalNonsalableChurchBulletin",
    ],
    scripturePresentation: {
      referencePlacement: "before",
      verseNumberStyle: "superscript",
      paragraphPolicy: "publisher",
      paragraphSpacing: "6pt",
      translationLabelPlacement: "withReference",
    },
    fieldContract: fieldContract(contractId, `${name} weekly fields`),
    sampleFieldValues: {
      publicationDate: { value: "2026-01-04", origin: "manual" },
      serviceName: { value: "Weekly gathering", origin: "manual" },
    },
    elements,
  };
}

const simpleService = baseTemplate(
  "Simple service bulletin",
  "11111111-1111-4111-8111-111111111111",
  [
    richText("simpleTitle", "Bulletin title", "Service Bulletin", 1),
    weeklyText("simpleService", "Service title", "serviceName", "Weekly gathering"),
    {
      id: "simpleDate",
      type: "date",
      name: "Publication date",
      width: "100%",
      height: "auto",
      bindings: [{
        id: "simpleDateBinding",
        scope: "document",
        fieldId: "publicationDate",
        target: "/data/value",
        fallback: "2026-01-04",
      }],
      data: { format: "MMMM D, YYYY" },
    },
    richText("simpleWelcome", "Welcome", "Welcome. Add the order of service, readings, music, and announcements here.", 2),
    rights("simpleRights"),
  ],
  {
    typstWidth: "8.5in",
    typstHeight: "11in",
    layoutIntent: "singlePage",
    background: "#ffffff",
    marginMode: "fixed",
    margins: { top: "0.65in", right: "0.65in", bottom: "0.65in", left: "0.65in" },
  },
);

const foldedLetter = baseTemplate(
  "Folded letter booklet",
  "22222222-2222-4222-8222-222222222222",
  [
    richText("foldedCover", "Front cover", "Service Bulletin", 1),
    weeklyText("foldedService", "Service title", "serviceName", "Weekly gathering"),
    { id: "foldedBreak1", type: "pageBreak", name: "Inside left page", data: { intent: "flowBreak" } },
    richText("foldedWelcome", "Welcome section", "Welcome", 1),
    richText("foldedWelcomeBody", "Welcome text", "Add opening information and the first part of the service here."),
    { id: "foldedBreak2", type: "pageBreak", name: "Inside right page", data: { intent: "flowBreak" } },
    richText("foldedServiceHeading", "Service section", "Order of Service", 1),
    richText("foldedServiceBody", "Service text", "Add readings, responses, music, and notes here."),
    { id: "foldedBreak3", type: "pageBreak", name: "Back cover page", data: { intent: "flowBreak" } },
    richText("foldedBack", "Back cover", "Announcements", 1),
    rights("foldedRights"),
  ],
  {
    typstWidth: "5.5in",
    typstHeight: "8.5in",
    layoutIntent: "foldedBooklet",
    background: "#ffffff",
    marginMode: "mirrored",
    binding: "left",
    margins: { top: "0.5in", bottom: "0.5in", inner: "0.6in", outer: "0.45in" },
    bookletPrintSetup: {
      sheetWidth: "11in",
      sheetHeight: "8.5in",
      duplexFlip: "shortEdge",
      scale: 1,
      safeInset: {
        top: "0.125in",
        right: "0.125in",
        bottom: "0.125in",
        left: "0.125in",
        fold: "0.0625in",
      },
    },
    finalPageCountRequirement: { multipleOf: 4 },
  },
);

const announcements = baseTemplate(
  "Announcements and news",
  "33333333-3333-4333-8333-333333333333",
  [
    richText("newsTitle", "News heading", "Community News", 1),
    weeklyText("newsService", "Issue title", "serviceName", "Weekly news"),
    {
      id: "newsDate",
      type: "date",
      name: "Publication date",
      bindings: [{
        id: "newsDateBinding",
        scope: "document",
        fieldId: "publicationDate",
        target: "/data/value",
        fallback: "2026-01-04",
      }],
      data: { format: "MMMM D, YYYY" },
    },
    richText("newsFeatured", "Featured announcement", "Featured announcement", 2),
    richText("newsFeaturedBody", "Featured announcement text", "Add the most important update here."),
    richText("newsUpcoming", "Upcoming events", "Upcoming events", 2),
    richText("newsUpcomingBody", "Upcoming events text", "Add dates, times, and contact details here."),
    rights("newsRights"),
  ],
  {
    typstWidth: "8.5in",
    typstHeight: "11in",
    layoutIntent: "singlePage",
    background: "#ffffff",
    marginMode: "fixed",
    margins: { top: "0.55in", right: "0.55in", bottom: "0.55in", left: "0.55in" },
  },
);

const blankAccessible = baseTemplate(
  "Blank accessible layout",
  "44444444-4444-4444-8444-444444444444",
  [
    richText("blankTitle", "Bulletin title", "Bulletin title", 1),
    richText("blankStart", "First section", "First section", 2),
    richText("blankBody", "First section text", "Start writing here."),
    rights("blankRights"),
  ],
  {
    typstWidth: "8.5in",
    typstHeight: "11in",
    layoutIntent: "singlePage",
    background: "#ffffff",
    marginMode: "fixed",
    margins: { top: "0.75in", right: "0.75in", bottom: "0.75in", left: "0.75in" },
  },
);

export const STARTER_CATALOG: readonly StarterCatalogEntry[] = Object.freeze([
  Object.freeze({
    id: "simple-service",
    name: "Simple service",
    description: "A calm single-column bulletin with clear headings and generous spacing.",
    outputDescription: "Full letter page",
    requiredItemCount: 2,
    document: simpleService,
  }),
  Object.freeze({
    id: "folded-letter",
    name: "Folded letter booklet",
    description: "Four half-letter pages arranged for two-sided printing and folding.",
    outputDescription: "Folded letter booklet",
    requiredItemCount: 2,
    document: foldedLetter,
  }),
  Object.freeze({
    id: "announcements",
    name: "Announcements and news",
    description: "A flexible news sheet for notices, events, and contact details.",
    outputDescription: "Full letter news sheet",
    requiredItemCount: 2,
    document: announcements,
  }),
  Object.freeze({
    id: "blank-accessible",
    name: "Blank accessible layout",
    description: "A confirmed letter page with semantic heading prompts and accessible defaults.",
    outputDescription: "Blank full letter page",
    requiredItemCount: 2,
    document: blankAccessible,
  }),
]);

export function findStarter(id: StarterId): StarterCatalogEntry {
  const starter = STARTER_CATALOG.find((candidate) => candidate.id === id);
  if (starter === undefined) throw new RangeError(`Unknown starter '${id}'`);
  return starter;
}
