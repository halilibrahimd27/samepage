# samepage

**Same page, new language.** samepage translates PDF and DOCX documents in your browser and
gives you back the same document — headings, paragraphs, tables, figures, charts, formulas,
footnotes, colours and page geometry — in another language.

It is built for academics who want an English, German or Russian version of their paper that
looks like the original, without uploading the paper anywhere and without paying for an API.

**Live:** https://halilibrahimd27.github.io/samepage/

## How it works

1. Drop a **DOCX** or a text-based **PDF**, choose the source and target language.
2. Press **Translate**. With the default engine the text is translated automatically by Google
   Translate into the language you chose — whatever your browser's own language is. If Google
   cannot be reached, a _translation sheet_ lets you use your browser's built-in page
   translation instead.
3. Review the **quality report**: anything suspicious is listed — including paragraphs whose
   meaning may have shifted (see _Meaning check_ below); you can correct any paragraph in place
   and rebuild without translating again.
4. Download the translated document — for PDFs also a side-by-side (original | translation)
   version — the JSON report, and for DOCX a **bilingual review document** for proofreading.

Works in desktop browsers and on phones. Finished translations are kept in
**History** on your device.

## Privacy and engines

- **There is no backend.** samepage is a static site. Your document is opened, analysed and
  rebuilt entirely inside your browser; the file itself never leaves your device.
- **Translation is free.** No account and no API key are needed:

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
  can be cleared in Settings. API keys (advanced engines) are kept in memory unless you choose
  to remember them on this device.

## Quality contract

1. **Meaning first.** Academic text must not drift in meaning. Every translation is checked for
   preserved numbers, units, citations, formulas and formatting; identifiers, abbreviations
   (`M/B`) and glossary terms are kept (also with engines that have no glossary support); a
   number the engine changed is retried with the numbers locked. The **meaning check** (on by
   default) then flags paragraphs whose claim may have shifted — a lost or added negation, a
   hedge that disappeared ("may improve" → "improves"), a changed quantifier ("most" → "all"):
   with Google and Chrome the translation is translated back and compared, and the
   back-translation is shown next to the finding; with Claude a second review pass does it.
   Anything suspicious is listed for review. You can correct any paragraph before downloading and
   export a bilingual review document. samepage never shortens or paraphrases body text to make
   it fit the page.
2. **DOCX — structure-perfect.** Word reflows text, so samepage only swaps the text and keeps
   everything else: styles, tables, equations, charts, text boxes, footnotes, comments, tracked
   changes. Fixed-size containers are repaired (rows may grow, text boxes fit their text) and
   every repair is reported.
3. **PDF (text-based) — near-identical layout.** Translations are typeset into the original
   boxes with matching fonts (Noto). When text does not fit, the layout repair engine uses free
   space, careful typography and consistent scaling; as a last resort it keeps a label in the
   original with the translation as a PDF note, or moves the end of a paragraph to _overflow
   notes_ at the end. **Every compromise is reported** with a page score. Nothing is silently
   dropped, and nothing is silently shrunk into illegibility.

## Limitations (v1)

- Not supported: scanned PDFs (no OCR), right-to-left scripts, vertical CJK, encrypted PDFs,
  form field values, and text inside raster images (left untouched and reported).
- Supported scripts: Latin, Cyrillic and Greek (Turkish, English, German, French, Spanish,
  Italian, Portuguese, Dutch, Polish, Czech, Romanian, Hungarian, Swedish, Russian, Ukrainian,
  Bulgarian, Greek).
- Inline math in PDFs is re-set in the Noto font (display formulas are left untouched).
- Very long PDFs (hundreds of pages) need a lot of memory; translate them in page ranges.
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
processing. Bundled Noto fonts are licensed under the SIL Open Font License
([public/fonts/OFL.txt](public/fonts/OFL.txt)).
