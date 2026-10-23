# samepage

**Same page, new language.** samepage translates PDF and DOCX documents in your browser and
gives you back the same document — headings, paragraphs, tables, figures, charts, formulas,
footnotes, colors and page geometry — in another language.

It is built for academics who want an English, German or Russian version of their paper that
looks like the original.

**Live:** https://halilibrahimd27.github.io/samepage/

> **Status: early development.** The roadmap is being implemented phase by phase. Features
> listed below describe the target of v1.0; the app may not do all of this yet.

## Privacy

- **There is no backend.** samepage is a static site. Your document is opened, analysed and
  rebuilt entirely inside your browser.
- **Your file never leaves your device.** Only the text segments that need translating are
  sent — and only to the translation engine you pick:

  | Engine                                                  | Where your text goes                    |
  | ------------------------------------------------------- | --------------------------------------- |
  | Chrome built-in translator                              | Nowhere — translated on your device     |
  | Local LLM server (Ollama, LM Studio, OpenAI-compatible) | Your own computer (`localhost`)         |
  | Anthropic Claude (bring your own key)                   | Anthropic's API, under your own account |

- **No analytics, no telemetry, no cookies, no third-party scripts.** Fonts and WebAssembly are
  self-hosted. A Content Security Policy only allows network connections to the engines above.
- **API keys** stay in memory for the session unless you explicitly choose to remember them on
  this device. Use a dedicated key with a low spend limit.

## Quality contract

1. **Meaning first.** Academic text must not drift in meaning. Translations are checked for
   preserved numbers, units, citations, equation and figure references, terminology and
   formatting markers. With the Claude engine an additional fidelity check compares source and
   translation and flags possible meaning differences for your review. samepage never shortens
   or paraphrases body text to make it fit the page.
2. **DOCX — structure-perfect.** Word reflows text, so samepage only swaps the text and keeps
   everything else.
3. **PDF (text-based) — near-identical layout.** When a translation does not fit, the layout
   repair engine fixes it (spacing, careful scaling, using free space) and **every compromise is
   reported** in the Quality Report. Nothing is silently dropped, and nothing is silently shrunk
   into illegibility.

## Limitations (v1)

Not supported: scanned PDFs (no OCR), right-to-left scripts, vertical CJK, encrypted PDFs,
form field values, and text inside raster images (it stays untouched and is reported).

## Development

Requirements: Node.js 24+.

```sh
npm ci
npm run dev         # local dev server
npm run build       # production build (base /samepage/, CSP injected)
npm run test        # unit + property tests
npm run test:e2e    # Playwright end-to-end tests
```

### Self-hosting

The site is fully static: serve the `dist/` folder from any web server. The CSP is a `<meta>`
tag generated from [`build/csp.ts`](build/csp.ts); widen `connect-src` there if you want to use
another translation endpoint.

## License

[AGPL-3.0-only](LICENSE). samepage uses [MuPDF.js](https://mupdf.com/) (AGPL) for PDF
processing. Bundled Noto fonts are licensed under the SIL Open Font License.
