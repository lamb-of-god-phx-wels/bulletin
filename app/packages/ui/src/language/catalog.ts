export const TASK_LANGUAGE = Object.freeze({
  bulletin: "Bulletin",
  bulletins: "Bulletins",
  template: "Template",
  templates: "Templates",
  savedSection: "Saved section",
  savedSections: "Saved Sections",
  linkedWeeklyField: "Linked weekly field",
  makeIndependent: "Make independent",
  changeOnlyThisItem: "Change only this item",
  sharedChurchLibrary: "Shared church library",
  publishChanges: "Publish changes",
  checkForUpdates: "Check for updates",
  updateSharedLibrary: "Update shared library",
  copyrightsAndPermissions: "Copyrights & Permissions",
  updatePreview: "Update preview",
  createPdf: "Create PDF",
  pdf: "PDF",
  draftPdf: "Draft PDF",
  printReadyPdf: "Print-ready PDF",
  readingOrderPdf: "Reading-order PDF — email, screen, or archive",
  bookletPrintPdf: "Booklet-print PDF — print two-sided and fold",
  accessiblePdf: "Accessible PDF",
  needsAttention: "Needs attention",
  readyToPrint: "Ready to print",
  weeklyContent: "Weekly Content",
  customizeLayout: "Customize Layout",
  thisWeek: "This Week",
  churchLibrary: "Church Library",
  settings: "Settings",
  help: "Help",
  allChangesSaved: "All changes saved",
  saving: "Saving",
  changesNotProtected: "Changes not protected",
  updatingPreview: "Updating preview",
  previewCurrent: "Preview current",
  previewOutOfDate: "Preview out of date",
  previewFailed: "Preview failed",
  bulletinLibrary: "Your bulletin library",
} as const);

export type TaskLanguageKey = keyof typeof TASK_LANGUAGE;

/** The only normal-screen vocabulary source for architecture terms. */
export function taskText(key: TaskLanguageKey): string {
  return TASK_LANGUAGE[key];
}

export const NORMAL_UI_FORBIDDEN_TERMS = Object.freeze([
  "JSON pointer",
  "artifact signature",
  "canonical revision token",
  "resource id",
  "Typst source",
] as const);
