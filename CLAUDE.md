# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

Specification work for the **Church Bulletin Builder**: an offline-first, GUI-first desktop app that lets non-technical church volunteers build weekly bulletins. Layout/content state lives in JSON, Typst source is generated deterministically from that JSON, and PDFs are compiled locally with a bundled Typst CLI.

The current `typst` branch contains **no application code** — it is in the spec-refinement phase (nail down `spec.md` before architecture, planning, and implementation). The deliverables here are documents and JSON Schemas.

## Key Files

- `spec.md` — the source-of-truth behavior spec (~6,000 lines). Everything else supports refining this document.
- `spec-review.md` — decision record from the expert-team spec review (recommendations, risks, and decisions already made, e.g. offline packaged desktop app; Windows + Linux targets). Check it before re-litigating a settled question.
- `use-case-spec-review.md` — UX/volunteer-persona review of the spec; `user-case-expert-agent.md` is the persona prompt used to produce it.
- `todo.md` — feature backlog not yet folded into the spec.
- `schema/` — JSON Schemas (draft 2020-12) for the document model: `template.schema.json` plus one schema per element type (text, image, date, music, grid, stack, canvas, page break, custom). These mirror the spec's Document Model / Element Types sections and must stay consistent with it.
- `../instructions.md` (repo parent) — the client's framing for the spec-review process: act as an SW architect/UX lead with a team of domain experts; improve the spec, don't just accept it.

## Spec Conventions

- Normative language: `must` / `should` / `may` per the "Normative Language And Release Scope" section. Requirements default to `Required v1` unless labeled `Required, may be staged`, `Deferred`, or `Optional enhancement`.
- Markdown is hard-wrapped at 80 columns.
- When changing behavior in `spec.md`, check whether the affected element/document schemas in `schema/` need matching updates.

## The `demo` Worktree

A working prototype lives on the `demo` branch, checked out at `../worktrees/demo/`. It predates the fresh spec and informs it (todo.md items and spec sections trace back to prototype limitations). Useful when the spec references existing behavior:

- `typst/app/` — the GUI builder: a dependency-free Node.js (>=20) web app. Run with `cd typst/app && npm start`, open `http://localhost:5177`. Projects are disk-backed JSON (`typst/content/<name>/document.json`, `typst/app/templates/<name>/template.json`); the app regenerates Typst source and compiles PDFs to `typst/pdf/`.
- `bash typst/scripts/build.sh "MM DD YYYY"` (from the demo worktree root) — scaffolds a weekly bulletin from the template, generates `private-data.typ` from `assets/church/information.md`, and compiles the PDF. Requires the `typst` CLI on PATH; `pdfinfo` is optional (booklet page-count check — page counts must be a multiple of 4).
- `templates/`, `styles/`, `sections/` under the demo also contain an older LaTeX pipeline the Typst port replaced.

Privacy note carried from the demo: generated `private-data.typ` files contain PII (pastor cell, council contacts), are git-ignored, and should not be opened or printed to the terminal; build output is PII-filtered deliberately.
