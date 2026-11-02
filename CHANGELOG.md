# Changelog

All notable changes to samepage are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-11-03

### Changed

- Translated PDFs are set like a typeset page: the paragraphs of a column follow one another at
  one size, the column's own spacing kept. Each paragraph used to be fitted into its own box, so a
  long one shrank the type of every paragraph and the short ones left gaps under them.
- A quieter, corporate look: one navy brand colour, a sticky header, a hero band, refined cards,
  form controls and buttons.

### Fixed

- Slides: labels and box titles set in a typewriter font ("TEMEL", "BİLMEN GEREKEN") and comments
  in code boxes are translated; Poppins, Montserrat, Inter and other sans faces stay sans in the
  translation; a bullet the slide draws twice over itself is translated once and its copy erased.
- Word: a table stays in one column with its caption.
- A name in code style ("libraries.io") keeps its style alone, not the rest of the sentence.

## [1.0.1] — 2026-11-02

Fixes found by translating 28 further papers in eight languages and reading every result.

### Fixed

- A reference page could come out blank: two invisible spaces of 1638 pt at a line end stretched
  the line over the page, and rewriting it removed everything under it. Boxes reaching off the
  page are no longer rewritten at all.
- Pages set in a font with a tiny declared ascent (TeX Gyre Termes X) were left untranslated with
  the translation in PDF notes; their paragraphs no longer split after "et al.".
- Tables ruled cell by cell keep the room of their rows: cells were shrunk to two thirds or kept
  in the original when their lines did not line up. A cell of a table without row rules has its
  own height and the room down to the next cell; a merged cell's fill no longer hides the row
  rules beside it, so such a table stays one table (also in Word).
- Russian set in a font mapped as Windows-1251 ("ÀÍÒÈÊÐÈÇÈÑÍÛÅ") is read as Cyrillic, so its
  language is detected and it is translated.
- Accents TeX draws apart ("Bouall`egue", "B¨ulte") are composed; variation selectors no longer
  reported as missing glyphs; a formula's index set in the text font stays in the formula.
- Fewer paragraphs left in the original: academic years broken at a line end ("2020- 21"),
  percentiles, ordinals and numbers written in words ("2-й группы" → "ikinci grupta", "yedi
  boyutun dördü", "yirmi iki makale", "twenty-two") and one-word labels ("Acidente vascular
  cerebral" → "İnme") no longer fail the checks; a paragraph with formatting across a sentence
  end is retried sentence by sentence, plain before its numbers are held.
- A label the translation leaves as written ("SECURICOM") stays without a PDF note; zero-width
  spaces Google writes into terms are dropped.
- Meaning kept where Google garbled it: such false alarms had made the retries hold every
  number in place, and Google then translated the words between them apart ("IgM V 1,9 Ve 2,9");
  words translated piece by piece and a sentence broken at a number ("2-3 курса") are now retried
  sentence by sentence. A code such as "19.00.01" turned into "19.00.2001" is caught; statistics
  heads, legal forms and the paper's acronyms stay as written ("Sig." was "Sonraki", "Inc" was
  "Inch", "Confirmed USPs" was "Unique Selling Points"); pre/post columns and an English
  "Abstract" in a non-English paper in the field's terms.

## [1.0.0] — 2026-11-02

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
- Structure benchmark on 21 open-access papers in 12 languages, a scanned one among them (`npm run bench`).
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
  entries; a two-column table of long cells is recognised whole; a running line a scan reads a
  little differently on each page is still one, and the author on page 1 no running head.
- Translation with Google: lines a hair apart in type size no longer cut the sentence into
  formatted pieces, no space before punctuation or inside quotes, a paragraph whose only fault is
  a spelled-out number written in digits ("osiemnastego wieku" → "18. yüzyıl") translated and
  flagged instead of kept in the source language, a closing bracket Google dropped with the
  sentence end put back, and a comma it turned into a closing bracket; percentage points are no
  percent sign, French ordinals in Roman numerals ("XVIIIe") are numbers; decades in words in
  more languages ("los noventa" → 1990s); an NGO, a
  non-profit, "sin embargo" or "sans doute" is no negation for the meaning check.
- Meaning never lost: a sentence the engine left out is caught and the paragraph translated again
  sentence by sentence; what the meaning check flags is translated again and kept when it checks
  out; the check reads a quotation in its own language and knows the fixed phrases that only look
  like a negation or a hedge in Turkish, French, German, Spanish, Portuguese, Italian and Russian
  ("olabilmesi için", "ne explétif", "nicht allein … sondern", "não obstante", "не менее").
  In Turkish, a "suggests" Google wrote as "shows" and a "seems" it left out are put back when
  the meaning check confirms the repair. A flag gets a second opinion: the translation in
  English, read against the source itself, so a back-translation's own slip no longer flags a
  sound paragraph; "no less important" must come back as "no less" or "at least as".
- Translation with Google: a number Google keeps changing is held in place alone, so the rest of
  the sentence is translated whole, and the paragraph is flagged for review when that number sits
  in running text; a note keeps its own number in front; a source year written once more is
  taken, flagged, instead of leaving the paragraph in the source language; an English term in
  brackets after a quoted term of a Cyrillic or Greek text goes back after that term; a formula
  sign ("p < 0.01") and short formulas travel as text, so Google no longer writes its usual
  "p < 0.05"; decimals without a leading zero (".05"), dates with the month in words and decades
  of any kind are read as the same numbers; no sentence is cut after "n.", "art." or "см.";
  authors with ORCID links keep their names. Small numbers the target writes in words ("fünf
  Items", "null und eins"), "χ²" for "χ2" and "2013/14" for "2013-2014" count as the same
  numbers; names and acronyms kept in Latin letters in a Cyrillic or Greek translation are no
  wrong script; bullets, brackets and the commas of a list set in a math font travel as
  themselves; ligatures ("insuﬃcient") are read as letters by the meaning check. A chemical
  formula stays whole with its subscripts ("CO₂", "CH₃NH₃I" no longer becomes "CH … 3NH3Ben"); a
  bracket Google kept a space before a formula is not opened twice; "c.f. Theorem 3.1" and other
  abbreviations end no sentence; a sentence that runs on into its formula is translated.

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
