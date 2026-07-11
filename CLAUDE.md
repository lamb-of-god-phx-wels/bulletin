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
- `instructions.md` (repo parent) — the client's framing for the spec-review process: act as an SW architect/UX lead with a team of domain experts; improve the spec, don't just accept it.

## Spec Conventions

- Normative language: `must` / `should` / `may` per the "Normative Language And Release Scope" section. Requirements default to `Required v1` unless labeled `Required, may be staged`, `Deferred`, or `Optional enhancement`.
- Markdown is hard-wrapped at 80 columns.
- When changing behavior in `spec.md`, check whether the affected element/document schemas in `schema/` need matching updates.
