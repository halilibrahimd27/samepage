# Changelog

All notable changes to samepage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased] — 1.0.0 release candidate

### Added

- Fully client-side translation of DOCX and text-based PDF documents, hosted on GitHub Pages.
- Free default engine: the browser's own page translation (Google in Chrome, Microsoft in Edge,
  Apple in Safari), driven through a translation sheet; works on phones.
- Chrome built-in on-device translator; advanced engines: Anthropic Claude (bring your own key,
  with a fidelity check) and local OpenAI-compatible servers; deterministic pseudo engine.
- Tag/placeholder codec, validators (numbers, citations, placeholders, glossary terms, language,
  chatter, length) with retries, translation cache and token estimates.
- Glossary with term suggestions, CSV import/export and term protection for engines without
  glossary support.
- DOCX: structure-preserving rebuild (runs, hyperlinks, fields, OMML, footnotes, comments,
  tracked changes, charts, SmartArt, text boxes), structural repairs D1–D4, sandboxed previews.
- PDF: MuPDF-based extraction and analysis (roles, columns, reading order, paragraph chains,
  tables, formulas, figure labels), Noto typesetting into the original boxes, text-only redaction,
  selectable output text, moved links, side-by-side output.
- Layout Repair Engine (micro-typography, expansion into free space, consistent group scaling,
  individual scaling, fallbacks with PDF notes and overflow notes), post-apply verification,
  page and document scores.
- Quality report with in-place editing and rebuild from the cache; bilingual review DOCX;
  translation history on the device; page ranges; bookmark and title translation.
- Output sanitisation (document JavaScript and launch actions removed and reported).
- Offline app shell (PWA), TR/EN interface, accessibility audit (axe, WCAG 2.1 AA).

### Security

- Production-only CSP, no third-party scripts, guarded unzip (zip-bomb limits), hardened XML,
  API keys memory-only by default and redacted from errors, SHA-pinned GitHub Actions,
  CodeQL and Dependabot.
