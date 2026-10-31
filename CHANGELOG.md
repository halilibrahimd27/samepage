# Changelog

All notable changes to samepage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased] — 1.0.0 release candidate

### Added

- Real papers: tables with a single rule (ACM), ruled column groups, rules drawn per cell and
  tables without any rule, found from their caption; columns under spanning group headers;
  multi-line cells joined in Word. A caption whose table was not recognised is reported.
- Word output of PDFs: real Word footnotes (marks in ACM/Libertine sizes), every reference entry its
  own paragraph, author blocks as text (sections are Heading 1), margin stamps (arXiv) left out,
  figure labels only in the figure, chart legends no longer cut a sentence in two.
- Reference lists after any references heading in the 17 languages, split by entry (numbered,
  hanging or first-line indented); a paper's citation of itself ("ACM Reference Format") kept.
- Translation integrity with Google: formulas, LaTeX references and citations, and frozen numbers
  travel inside the sentence; percent signs locked with their numbers ("%81" in Turkish); software
  names never translated or re-cased ("Python", "npm"); numbers keep the source's spelling;
  brackets and spaces Google drops at its sentence breaks restored or reported; section names in
  headings ("Giriş" → "Introduction"); scanned numbers recognised with low confidence named.
- Compound hyphens at line ends kept when the paper writes the word with one ("self-attention"),
  in any of its forms ("hyper-parameter" for "hyper-parameters"), also in the abstract-only mode.
- Word output of PDFs: chart ticks and legends drawn with their chart instead of as dozens of tiny
  pictures, thumb-index letters left out, footnotes found from an asterisk set in the text's own
  size or a number set apart, unruled tables whose long cells wrap.
- Front matter in page order (a title over its author line is no author grid), affiliations
  translated (no longer taken for a list of names), journal page borders no longer read as a
  figure, a note without a mark above the footnotes kept with them.
- Structure benchmark on 19 open-access papers in 10 languages (`npm run bench`).
- Word output of PDFs laid out like the PDF: margins, text columns (Word sections, the title
  block, wide tables and figures across both), fonts, type sizes and leading measured from the
  paper; first-line and list indents, justification and centring per paragraph; numbered
  headings at the level of their number ("3.1" under "3"); tables with booktabs rules, numbers
  set flush right and columns wide enough for their words; captions above their table when the
  PDF sets them there; the author grid as a borderless table, affiliations line by line; text
  inside a numbered formula drawn with it, not written out again.
- Translation with Google: research question labels kept ("RQ1:"), citations no longer glued
  to the next word, a bold term no longer stretched over the rest of the sentence, structured
  abstract labels in the field's terms ("Results" → "Bulgular"), small raised footnote marks
  and the math asterisk read as marks; a plural in brackets ("package(s)") no longer reported
  as a lost bracket.
- LaTeX files saved with Windows line ends.
- Real papers in more languages: a ruled grid whose borders vary in weight stays one table,
  cells the PDF set as one line are cut at the column edge, a bold bulleted item is no heading,
  a line split at its sub- and superscripts is one line again ("p_u be Pᵀvᵁᵤ and item …") and a
  lone subscript joins its formula; a footnote that is only a citation ("K. Kautsky, …, bd. II,
  s. 365.") is kept as published; rules alone (crop marks, page frames, the borders of a caption
  bar) are no figure; a first-page title that repeats as the running head is the title, an
  abstract set a little larger no heading, a large ornament decoration; an accent a font draws
  apart is put back on its letter ("Róża").
- Word output of PDFs: code listings in Consolas, indented as on the page and fitted to their
  lines; inline formulas with real sub- and superscripts; three-column papers kept in three
  columns, justified columns hyphenated; a table's interval line ("(19,9–23,0)") in its cell;
  a caption set white on a coloured bar shown, and as wide as its table; a section number
  ("IV") stays text and its note mark is linked; a footnote going on to the next page is one
  note, an address line set under its note stays in it, a table's note links to its mark in a
  cell; a bar holding only the running head or the page number is no picture, nor an empty tab
  at the page's edge; a figure's caption and the journal's logo stay out of its picture; a
  table cell across columns spans them, a column is aligned one way; a short line at the
  column's right edge is set right, lines centred on a one-column page stay centred and an
  abstract set in from both sides is; a reference list without a heading is found from its
  entries; a two-column table of long cells is recognised whole.
- Translation with Google: lines a hair apart in type size no longer cut the sentence into
  formatted pieces, no space before punctuation or inside quotes, a paragraph whose only fault is
  a spelled-out number written in digits ("osiemnastego wieku" → "18. yüzyıl") translated and
  flagged instead of kept in the source language, a closing bracket Google dropped with the
  sentence end put back, and a comma it turned into a closing bracket; percentage points are no
  percent sign, French ordinals in Roman numerals ("XVIIIe") are numbers; decades in words in
  more languages ("los noventa" → 1990s); an NGO, a
  non-profit, "sin embargo" or "sans doute" is no negation for the meaning check.

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
- Browser extension (`extension/`, Chrome/Edge/Firefox): "Translate this PDF with samepage" on a
  PDF tab or link hands the file to samepage in a new tab; `npm run extension` packs it.
- Quality page (`#quality`): layout scores of the 88-paper corpus by language and field, with the
  script that builds them from a corpus run.
- Interface in German, French and Spanish (loaded when chosen), besides English and Turkish.
- Glossary packs: every glossary as one spreadsheet with a column per language, imported for any
  of its pairs; TBX termbases (IATE) and tab-separated files imported too.
- LaTeX: `.tex` files and project `.zip` files (Overleaf) translated with commands, mathematics,
  citations, references, labels, comments and verbatim text kept; footnotes, captions, section
  titles and table cells translated; babel/polyglossia switched to the target language.
- Reference titles in brackets (APA 7, optional): entries stay as published and titles in another
  language get their translation after them, in PDF, Word and PowerPoint; a PDF reference entry's
  lines are kept together as one paragraph.
- Project files (`.samepage`): the document, its translation, review corrections and glossary in
  one file, reopened in any browser without translating again; corrections are applied without
  calling the engine.
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
