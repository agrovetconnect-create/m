# Stage 4 — Dependency & Licensing Review
**AI Mark Entry System.**

## Decision: ZERO new dependencies

| Need | Considered | Decision & rationale |
|---|---|---|
| .xlsx read | in-repo `lib/vendor/xlsx-lite.ts` (already vendored + tested) | **reuse** — real ZIP/DEFLATE/OOXML parser, data-only, license already reviewed in Stage 1 |
| .xlsx write | SheetJS/xlsx (Apache-2.0, heavy), exceljs (MIT, Node-oriented) | **rejected both** — adding a 1–5 MB JS dependency to write a single-sheet register is unjustified; the Stage 4 in-repo writer (~250 lines, no deps) is round-trip-verified against the existing reader |
| CSV | papaparse etc. | **rejected** — RFC 4180 needs ~80 lines; vendored implementations are pure and fully tested |
| .xls (legacy binary) | — | **not supported, honestly** — would need a full BIFF parser; the import rejects `.xls` with a clear message instead of guessing |

## License posture
All Stage 4 code is original in-repo TypeScript (MIT-compatible with the product).
No new third-party code = no new license obligations. The prior dependency review
(Stage 1) remains the complete license picture.

## Security notes
- Import parsing is data-only: no formula evaluation, no macro handling, no dynamic
  code paths. The xlsx parser reads XML values; no entity expansion beyond the
  reader's existing guarded implementation.
- 5 MB pre-parse size guard; ZIP magic check before workbook parse.
- Imports never upload files anywhere — parsing is fully on-device.
