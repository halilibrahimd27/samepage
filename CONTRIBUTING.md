# Contributing to samepage

Thank you for helping. samepage is a static, fully client-side document translator; please read
this page before opening a pull request.

## Non-negotiable rules

1. **Static only.** No server, serverless function, proxy, analytics or telemetry. The app's own
   network calls go only to the translation engine the user selected.
2. **Documents never leave the device**, except as text segments sent to that engine.
3. **No runtime third-party scripts or CDNs.** Fonts, WASM and assets are self-hosted.
4. **No SharedArrayBuffer / cross-origin isolation** (GitHub Pages cannot send COOP/COEP).
5. **`mupdf` is imported only inside `src/pdf/engine/`** (enforced by ESLint). Check MuPDF calls
   against the installed type definitions, never from memory.
6. **Never silently lose content.** Every untranslated, shrunk, fallback-rendered or manually
   edited segment must appear in the quality report.
7. **Determinism.** Same input and same engine responses ⇒ identical layout decisions.
8. **AGPL-3.0-only.** New dependencies must be AGPL-compatible; say why they are needed.
9. **No secrets** in code, tests, fixtures, logs or commits.

## Architecture in one minute

```
src/app/            React UI (screens, components, i18n TR/EN, main-thread bridges)
src/workers/        pipeline worker (Comlink) — all heavy work runs here
src/core/           IR types/geometry, segment codec (tags ⟦placeholders⟧), validators,
                    translation pipeline (batching, retries, cache), glossary
src/engines/        browser page translation, Chrome built-in, Anthropic, local LLM, pseudo
src/docx/           guarded unzip, paragraph extraction/rebuild, structural repair
src/pdf/engine/     MuPDF adapter (extraction, rendering, writer, sanitisation)
src/pdf/analyze/    blocks, roles, columns, reading order, chains, tables
src/pdf/typeset/    fonts, segments, line breaking, layout
src/layout-repair/  policy, repair loop (R1–R6), scoring
```

Layout logic is pure functions over plain data; side effects (MuPDF, IndexedDB, network) live at
the edges. Every MuPDF object created in a loop must be destroyed.

## Workflow

```sh
npm ci
npm run typecheck && npm run lint && npm test
npm run test:golden   # DOCX/PDF golden, identity check, layout fidelity
npm run test:e2e      # Playwright against the production build
```

- Small, focused pull requests with tests. Conventional Commits (`feat:`, `fix:`, `test:` …).
- Do not update a golden snapshot to make a test pass unless the change is an intended
  improvement — explain the visual or behavioural change in the commit body
  (`npm run test:golden -- -u`).
- UI strings go into `src/app/i18n/en.ts` and `tr.ts` (the types make a missing key a build error).
- The synthetic corpus lives in `tests/corpus/` (`npm run fixtures`; LaTeX needs tectonic).
  Third-party documents need a license entry in `tests/corpus/LICENSES.md`.

## Reporting security issues

Please do not open a public issue for vulnerabilities. Use GitHub's private vulnerability
reporting on this repository.
