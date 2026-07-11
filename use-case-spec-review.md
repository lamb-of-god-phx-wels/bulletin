## Overall assessment

  This is an excellent engineering and safety specification, but it is not yet a complete product/UX specification. It could produce a secure, deterministic layout engine while
  still making weekly bulletin work feel like desktop publishing software for experts.

  The most important change is to separate two experiences:

  - Weekly Content mode — default: protected layout, fillable fields, direct text editing, image replacement, checklist, preview, and export.
  - Customize Layout mode — advanced: grids, stacks, canvases, margins, page layers, dimensions, styles, bindings, and reusable definitions.

  A volunteer replacing readings on Thursday night should never accidentally move the church logo or break a footer.

  ## Highest-priority changes

  1. Make “Create this week’s bulletin” the primary action.

  The spec makes formal templates primary and duplicating last week secondary (spec.md:207). In practice, recurring announcements and seasonal content often come from the
  previous bulletin.

  Create the new bulletin from the current template, then optionally carry values forward from the last compatible bulletin. Each template field needs a rollover policy:

  - Clear every week: date, readings, hymns.
  - Keep until changed: church address, contact information.
  - Ask each week: announcements, prayers, special notes.
  - Derive and confirm: suggested next service date and filename.

  Flag inherited dates, “TBD,” placeholders, duplicate service dates, and suspiciously unchanged weekly content.

  2. Support conditional and repeatable sections.

  The field model supports booleans and arrays, but bindings cannot affect structure (spec.md:798). That makes ordinary variations—Communion, baptism, a variable announcement
  list, extra prayers—require layout editing.

  Templates need safe, template-authored behaviors such as:

  - “Include this section this week.”
  - Repeatable announcement, event, prayer, or reading rows.
  - Reordering where the template permits it.
  - Defined behavior when a section is empty.
  - “Not used this week” for required-but-conditional content.

  These are deterministic template features, not AI-driven layout mutations.

  3. Specify the no-code template-authoring experience.

  Templates are central, but the spec primarily defines their storage model and lifecycle. Add requirements for:

  - “Save this bulletin as a template.”
  - “Make this text a weekly field.”
  - Plain controls for label, help text, required status, default, group, and rollover behavior.
  - Visual setup-form ordering.
  - Sample values and template test mode.
  - “Change only this bulletin” versus “Update the template for future bulletins.”
  - Layout locks at document, section, and element level.

  Normal UI must never expose contract hashes, JSON pointers, wrapper IDs, binding scopes, or definition revisions.

  4. Add an interruption-friendly pastor-instructions workflow.

  The weekly job usually starts with an email, text message, Word document, or terse note—not a field contract.

  Add a private “This week’s instructions” scratchpad:

  - Paste notes without using AI.
  - Turn notes into checklist items.
  - Manually associate an item with a field or section.
  - Mark items handled or unresolved.
  - Keep the source visible while editing.
  - Resume at the same instruction, field, and page after closing.

  If AI is configured, it can suggest mappings and show the supporting source excerpt. Inferred values should be unmistakably labeled.

  5. Require direct, on-page content editing.

  The rich-text data model is detailed, but the editing interaction is not (spec.md:1165, spec.md:1859).

  Require:

  - Click text and type directly.
  - Familiar contextual controls for headings, bold, italic, lists, quotations, and scripture.
  - Local spellcheck, a church/pastor-name dictionary, find, and replace.
  - Click an image to replace or crop it.
  - Errors attached to the affected content with actions such as “Go to field.”
  - Clear behavior for caret movement, paste cleanup, keyboard shortcuts, validation timing, and undo grouping.

  Also promote basic drag-to-resize from optional to required in layout mode. A GUI-first builder that can move an image but requires entering inches to resize it will feel
  unfinished.

  6. Resolve the booklet-printing contradiction.

  Folded/booklet workflow is required, but direct printing and imposed PDFs are excluded (spec.md:2245). This leaves the most error-prone part of the process to a printer
  driver or another application.

  Preferably provide both:

  - Reading-order PDF for sharing and accessibility.
  - Print-ready booklet PDF with paper size, fold, duplex, and flip-edge settings expressed in plain language.

  Also provide sheet previews, printer-safe-margin checks, low-resolution-image warnings, unintended-blank-page checks, and a one-sheet test-print guide.

  If imposition cannot ship, stop describing v1 as a complete booklet workflow. Explicitly label the output: “Reading-order PDF—choose booklet printing in your PDF viewer.”

  7. Reverse the workspace-backup decision.

  The spec explicitly says a full-workspace backup is unnecessary (spec.md:347). I strongly disagree.

  Session-only undo plus aggressive autosave can preserve a mistake perfectly. Project-by-project exports are not a realistic church handoff strategy.

  Require:

  - Automatic snapshots at open, major edits, and final export.
  - Version history across restarts.
  - Trash/recently deleted instead of immediate permanent deletion.
  - One-click full-workspace backup and restore.
  - A simple handoff package for the next volunteer.

  8. Make “Review & Export” one required v1 workflow.

  Internal concepts such as build, artifact, readiness profile, final candidate, signature, and approval should remain internal.

  The final screen should use three understandable outputs:

  - Draft PDF
  - Print-ready PDF
  - Accessible PDF, when available

  It should show page thumbnails, “Must fix” versus “Please review,” missing information, overflow, image quality, blank pages, page size, fold choice, output filename, and
  destination. Each finding should navigate directly to the affected content. After success, offer “Open PDF” and “Show in folder.” A watermarked review-copy PDF would help
  pastor approval even before formal approval records ship.

  ## Frontend requirements that should be added

  The spec needs a dedicated application-UI chapter; the current Style Model describes bulletin output, not the app itself.

  At minimum, specify:

  - Information architecture: This Week, Bulletins, Templates, Saved Sections/Church Library, Settings, and Help.
  - Responsive desktop behavior: define a minimum supported logical window size and test at 125%, 150%, and 200% OS scaling. Side panels must collapse without losing focus or
    selection, and the application must not require horizontal scrolling.

  - Preview controls: Fit page, Fit width, zoom, page count, thumbnails, jump to selected content, and an unmistakable “Preview out of date” overlay. At least selection-to-
    preview navigation should be required; full synchronized scrolling can remain optional.

  - Inspector organization: Content, Layout, Appearance, and Accessibility, with technical controls collapsed under Advanced. Show one “Finished page size,” not separate editor
    and PDF sizes.

  - Validation behavior: validate after commit or leaving a field, not noisily on every keystroke. Preserve invalid input while explaining the problem. Review summaries must
    link to fields.

  - Accessible alternatives: every creation, reorder, move, or placement operation needed for normal work needs a labeled non-drag action. Make WCAG 2.2 AA a firm requirement
    if the product will claim it, including accessibility-tree roles, focus restoration, live status announcements, forced-colors support, and no color-only states.

  - Application design system: typography, spacing, control sizes, focus styling, semantic status treatments, icons with text labels, dialogs, banners, toasts, disabled states,
    loading/empty/error states, destructive actions, high contrast, and reduced motion.

  - Plain-language vocabulary: use “Saved section,” “Make independent,” “Needs 3 items,” and “Ready to print.” Keep “custom element,” “detach binding,” “artifact,” “contract
    hash,” and “portable reference” out of ordinary screens.

  The default library should lead with “Continue this week’s bulletin,” recent work, and favorite templates. Pack trust, provenance, conflict metadata, and advanced filtering
  belong under details.

  ## Recommended v1 rebalance

   Decision                     Recommendation
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Add or promote               Weekly Content mode, rollover rules, conditional/repeatable sections, direct editing, template wizard, generic starters, Church Profile, basic
                                resize/crop, preview navigation, Review & Export, version history, backup/restore, and trash.
  ───────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   Preserve                     Offline operation, deterministic rendering, autosave/recovery, undo, missing-asset placeholders, stale-preview labeling, page-count
                                constraints, plain-language diagnostics, and AI proposals requiring review.
  ───────────────────────────  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   Move to Advanced or later    Raw AI exchange files, managed AI-helper configuration, custom-definition terminology, arbitrary page layering, deep nested-container editing,
                                and pack-administration UI. If resource packs threaten the schedule, defer the complete feature rather than weakening its safety rules.

  The required .ai-template.json/.ai-import.json flow (spec.md:3250) is an integration capability, not usable AI assistance for the target audience. Put it under
  Advanced/Integrations or stage it. The valuable AI experience is “paste the pastor’s notes, review suggestions, accept/edit/reject each one.”

  ## Concrete inconsistencies to fix

  - Project names allow only a narrow character set despite being display labels stored independently of safe UUID paths (spec.md:555). This excludes ordinary names such as St.
    John’s, non-Latin churches, and punctuation. Permit Unicode and common punctuation with length/control-character limits.

  - Image stretch is schema-valid but silently renders as contain (spec.md:1237). Either implement it or reject/hide it. Add a crop preview and persisted focal point for cover.
  - Music is named as core content but is only a placeholder. Implement a useful Hymn/Song block—number, title, instruction, source, optional rich content and licensing—or
    remove it from the v1 palette.

  - The inspector exposes both editor and PDF page sizes even though editor pixels are derived. Show one finished-page size and treat zoom as view state.
  - Hidden and locked nodes must appear in the structure view, but their ownership and persisted/ephemeral state are not defined.
  - A canceled setup commits a draft before the form opens, but abandonment and cleanup behavior are unspecified. Avoid littering the library with unnamed drafts.
  - The global default of 7in × 8.5in appears congregation-specific. First-run setup should ask in task language—full sheet, folded booklet, paper size—rather than silently
    choosing an unusual global default.

  ## Release acceptance should be task-based

  Add a benchmark such as:

  > A returning volunteer can create next Sunday’s bulletin, paste the pastor’s notes, carry forward two announcements, omit one optional section, correct surfaced stale
  > content, close and resume after an interruption, and export the intended print-ready result in under 15 minutes—without seeing JSON, Typst, IDs, hashes, bindings, or
  > artifact terminology.

  Also require tests for:

  - Fresh install to first PDF without importing a pack or choosing filesystem paths.
  - Keyboard-only completion of the weekly workflow.
  - 200% UI scaling and screen-reader use on Windows and Linux.
  - Recovery from autosave failure, stale preview, missing image, and accidental deletion.
  - Long translated labels, Unicode church names, constrained-height dialogs, and duplicate document names.
  - Booklet output verified with an actual duplex test print.

  The underlying safeguards are unusually strong and worth preserving. The product now needs the same level of rigor around the ordinary human experience: starting quickly,
  surviving interruptions, avoiding stale content, printing confidently, and handing the role to the next volunteer.