# samepage

**Same page, new language.** samepage translates PDF and DOCX documents in your browser and
gives you back the same document — headings, paragraphs, tables, figures, charts, formulas,
footnotes, colours and page geometry — in another language.

[![Live](https://img.shields.io/badge/live-halilibrahimd27.github.io%2Fsamepage-0b7a3e)](https://halilibrahimd27.github.io/samepage/)
[![CI](https://github.com/halilibrahimd27/samepage/actions/workflows/ci.yml/badge.svg)](https://github.com/halilibrahimd27/samepage/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

It is built for academics who want an English, German or Turkish version of their paper that
looks like the original — without uploading the paper anywhere, without an account and without
paying for an API — and who cannot afford a translation that quietly changes what the paper says.

**Try it:** https://halilibrahimd27.github.io/samepage/

![A paper translated from English into Turkish: quality report and side-by-side preview](media/result.png)

## Features

- **Same layout.** PDFs are re-typeset into the original boxes with matching fonts; DOCX files
  keep every style, table, equation, chart, footnote and tracked change. A side-by-side PDF
  (original | translation) is produced as well.
- **Automatic, into the language you choose.** The default engine translates directly into the
  selected language on desktop and phones (iPhone, Android) — no browser setting to change. The
  source language is detected from the document.
- **Meaning first.** Numbers, units, citations, formulas, identifiers (`has_long_str`, `PyPI`),
  abbreviations (`M/B`) and glossary terms are kept; a paragraph whose numbers changed is
  translated again with the numbers locked. A **meaning check** translates the result back and
  flags lost or added negations, hedges that disappeared ("results suggest" → "results reveal")
  and changed quantifiers ("most" → "all"), with the back-translation shown next to the finding.
- **Academic details.** Running heads, journal citation lines, author lines, page numbers,
  formulas set in text fonts and reference lists are recognised and left alone; metric terms
  (precision, recall, F1-score) stay consistent between tables and text.
- **Abstract only.** For journals that ask for the abstract in a second language: samepage
  finds the title, abstract and keywords (labelled or not, structured, bilingual papers), lets
  you check and edit them, and translates just those — with the meaning check, word counts and a
  copy button.
- **Quality report.** A layout score per page, every compromise listed (nothing is dropped or
  shrunk silently), a "needs attention" view and a "meaning check" view. Any paragraph can be
  corrected in place and the document rebuilt without translating again; DOCX also exports a
  bilingual review table.
- **Private by design.** No backend, no account, no analytics. History, glossary and the
  translation cache stay in your browser.

<img src="media/phone.png" alt="samepage on a phone" width="260" align="right">

## How it works

1. Drop a **DOCX** or a text-based **PDF**. The source language is detected; choose the target
   language (⇄ swaps them).
2. Choose **Whole document**, or **Title, abstract and keywords** to translate only those.
   Press **Translate**. Progress shows the translation, then the meaning check.
3. Open the **quality report**: the score and counts are in its summary line; "needs attention"
   and "meaning check" list what deserves a look. Correct a paragraph and rebuild if you like.
4. Download the translated document, the side-by-side PDF, the JSON report or (DOCX) the
   bilingual review document. Finished translations are kept in **History** on your device.

**Languages:** Turkish, English, German, French, Spanish, Italian, Portuguese, Dutch, Polish,
Czech, Romanian, Hungarian, Swedish, Russian, Ukrainian, Bulgarian and Greek — in any
direction.

<br clear="right">

## Privacy and engines

- **There is no backend.** samepage is a static site. Your document is opened, analysed and
  rebuilt entirely inside your browser; the file itself never leaves your device.
- **No account and no API key are needed:**

  | Engine                           | Where your text goes                                             |
  | -------------------------------- | ---------------------------------------------------------------- |
  | **Google Translate** (default)   | Google, through Google's website translator. Works on phones.    |
  | Chrome built-in translator       | Nowhere — translated on your device (desktop Chrome and Edge)    |
  | Advanced: Claude API / local LLM | Anthropic under your own key, or your own computer (`localhost`) |

  Only the text that needs translating is sent, and only to the engine you choose.

- **No analytics, no telemetry and no third-party scripts in the app.** Fonts and WebAssembly
  are self-hosted, and a Content Security Policy limits the app's own network connections.
  The one exception is the Google engine: Google's translator script runs in a separate,
  invisible helper page (`translate.html`, same site, its own stricter policy) that is loaded
  only when you translate with Google. That script may set Google's own `googtrans` cookie.
- **History, glossary and the translation cache** are stored only in this browser (IndexedDB) and
  can be cleared in Settings; a private window forgets them when it is closed. API keys
  (advanced engines) are kept in memory unless you choose to remember them on this device.

## Quality contract

1. **Meaning first.** Academic text must not drift in meaning. Every translation is validated
   (numbers, citations, formulas, formatting, language) and retried when it fails; the meaning
   check flags what validation cannot see. Anything suspicious is listed for review. samepage
   never shortens or paraphrases body text to make it fit the page.
2. **DOCX — structure-perfect.** Word reflows text, so samepage only swaps the text and keeps
   everything else. Fixed-size containers are repaired (rows may grow, text boxes fit their
   text) and every repair is reported.
3. **PDF (text-based) — near-identical layout.** When a translation does not fit, the layout
   repair engine uses free space, careful typography and consistent scaling; as a last resort it
   keeps a label or table cell in the original with the translation as a PDF note, or moves the
   end of a paragraph to _overflow notes_ at the end. **Every compromise is reported** with a
   page score. Nothing is silently dropped, and nothing is silently shrunk into illegibility.

## How it is tested

Besides unit, golden and end-to-end tests, samepage is checked against real open-access papers:
86 papers in 17 languages — engineering, mathematics, physics, chemistry, medicine, nursing,
public health, computer science, biology, agronomy, economics and law — translated with the
Google engine, plus round trips (a paper translated into another language and back) to measure
meaning drift. The papers are not part of the repository.

## Limitations

- Not supported: scanned PDFs (no OCR), right-to-left scripts, vertical CJK, encrypted PDFs,
  form field values, and text inside raster images (left untouched and reported).
- Inline math in PDFs is re-set in the Noto fonts (display formulas are left untouched).
- Very long PDFs (hundreds of pages) need a lot of memory; translate them in page ranges.
- PDFs with unusual internal glyph encodings or private-use symbols without a Unicode meaning
  can lose a symbol or show a small change outside the text; both are reported per page.
- Translation quality depends on the engine. Always review academic text before publishing.

## Development

Requirements: Node.js 24+.

```sh
npm ci
npm run dev          # local dev server
npm run build        # production build (base /samepage/, CSP injected)
npm run test         # unit + property tests
npm run test:golden  # DOCX/PDF golden, identity and layout-fidelity tests
npm run test:e2e     # Playwright end-to-end tests (production build)
npm run fixtures     # regenerate the synthetic corpus (LaTeX needs tectonic)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture overview and the rules contributions
must follow.

### Self-hosting

The site is fully static: serve the `dist/` folder from any web server. The CSP is a `<meta>`
tag generated from [`build/csp.ts`](build/csp.ts); widen `connect-src` there if you want to use
another translation endpoint.

## License

[AGPL-3.0-only](LICENSE). samepage uses [MuPDF.js](https://mupdf.com/) (AGPL) for PDF
processing. Bundled Noto fonts (including Noto Sans Math) are licensed under the SIL Open Font
License ([public/fonts/OFL.txt](public/fonts/OFL.txt)).
