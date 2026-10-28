# Changelog

All notable changes to samepage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased] — 1.0.0 release candidate

### Added

- Fully client-side translation of PDF (text-based and scanned), DOCX and PPTX documents in 17
  languages, hosted on GitHub Pages.
- Default engine: Google Translate through Google's website translator in a same-site helper
  page — automatic, into the chosen language, on desktop and phones — with retries and a manual
  translation sheet as the fallback.
- Chrome built-in on-device translator; advanced engines: Anthropic Claude (bring your own key)
  and local OpenAI-compatible servers; deterministic pseudo engine.
- Meaning check: back-translation compared for negation, hedging and quantifier cues in all 17
  source languages; sentence-aligned review of source, translation and back-translation with the
  differing words marked.
- Hybrid quality: with the user's own Claude key, the sentences the meaning check flags are
  revised by Claude, validated like any translation and reported; British or American spelling
  for English targets.
- AI-use statement: a ready-to-copy disclosure naming the engine and the language pair, in the
  paper's language.
- Editable Word output of translated PDFs: headings, paragraphs, tables and footnotes as
  Word text in Word's styles, figures and display formulas as pictures from the translated PDF.
- Abstract mode: title, abstract and keywords found (labelled or not, structured, bilingual
  papers), editable, and translated on their own.
- Glossary with suggestions from the document (code-font words, tool names, field terms), CSV
  import/export and term protection for engines without glossary support.
- Tag/placeholder codec, validators (numbers, citations, placeholders, glossary terms, language,
  chatter, length) with retries — numbers locked, then sentence by sentence — and a translation
  cache.
- DOCX and PPTX: structure-preserving rebuild (runs, hyperlinks, fields, OMML, footnotes,
  comments, tracked changes, charts, SmartArt, text boxes, slides and speaker notes), structural
  repairs, slide text fitted with PowerPoint's shrink-on-overflow, sandboxed previews.
- PDF: MuPDF-based extraction and analysis (roles, columns, reading order, paragraph chains
  across columns, pages and display formulas, tables, formulas, figure labels), Noto typesetting
  into the original boxes, text-only redaction, selectable output text, moved links,
  side-by-side output; OCR of scanned pages with Tesseract (self-hosted models).
- Layout Repair Engine (micro-typography, expansion into free space, consistent group scaling,
  individual scaling, fallbacks with PDF notes and overflow notes), post-apply verification,
  per-page normalisation of pages whose text cannot be removed cleanly, page and document scores.
- Quality report with in-place editing and rebuild from the cache; bilingual review DOCX; page
  ranges; bookmark and title translation.
- Output sanitisation (document JavaScript and launch actions removed and reported).
- Offline app shell (PWA), TR/EN interface, accessibility audit (axe, WCAG 2.1 AA).

### Security

- Production-only CSP, no third-party scripts, guarded unzip (zip-bomb limits), hardened XML,
  API keys memory-only by default and redacted from errors, SHA-pinned GitHub Actions,
  CodeQL and Dependabot.
