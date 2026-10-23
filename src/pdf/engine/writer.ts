import type { Rect } from '../../core/ir/types';
import type { LayoutLine } from '../typeset/layout';
import { FACE_FILES } from '../typeset/types';
import type { LoadedFaces } from './fonts';
import { loadMupdf } from './mupdf';
import { applyOutlineTitles } from './outline';
import { sanitizePdf } from './sanitize';

export interface PageWrite {
  index: number;
  /** Areas whose text is removed (page space). Images, fills and rules survive. */
  redact: Rect[];
  lines: LayoutLine[];
  /** PDF notes (annotation fallback): the original text stays, the translation is in the note. */
  notes?: { rect: Rect; text: string }[];
}

/** Extra pages appended at the end (overflow notes), laid out in page space (y down). */
export interface AppendedPage {
  width: number;
  height: number;
  lines: LayoutLine[];
}

export interface WriteResult {
  mono: Uint8Array;
  dual: Uint8Array | null;
  linksRemoved: number;
  linksAdded: number;
  /** Characters without a glyph in the chosen face (reported as MISSING_GLYPH). */
  missingGlyphs: string[];
  /** Active content removed by sanitisation (P6.4). */
  sanitized: string[];
}

const fmt = (n: number) => (Math.abs(n) < 1e-6 ? '0' : Number(n.toFixed(4)).toString());

/**
 * Writes the translated layout on fresh copies of the original pages (ADR-006, ADR-010):
 * text-only redaction, then our own content stream with Type0/Identity-H Noto fonts
 * (ToUnicode included, so the text stays selectable and searchable).
 */
export async function writePdf(
  source: Uint8Array,
  pages: PageWrite[],
  faces: LoadedFaces,
  opts: {
    dual: boolean;
    appendix?: AppendedPage[];
    sanitize?: boolean;
    /** Translated bookmark titles (depth-first order) and document title (P6.3). */
    outline?: string[];
    title?: string;
  },
): Promise<WriteResult> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(source, 'application/pdf').asPDF();
  if (!doc) throw new Error('Not a PDF');
  const fontRefs = new Map<string, { name: string; ref: ReturnType<typeof doc.addFont> }>();
  const missing = new Set<string>();
  let linksRemoved = 0;
  let linksAdded = 0;

  /** Content-stream operators for laid-out lines; registers fonts in `fontDict`. */
  const buildOps = (
    lines: LayoutLine[],
    fontDict: ReturnType<typeof doc.newDictionary>,
    inv: [number, number, number, number, number, number],
  ): string => {
    let ops = 'q\n';
    for (const line of lines) {
      for (const run of line.runs) {
        const file = FACE_FILES[run.face];
        let entry = fontRefs.get(file);
        if (!entry) {
          entry = { name: `SP${fontRefs.size + 1}`, ref: doc.addFont(faces.font(run.face)) };
          fontRefs.set(file, entry);
        }
        fontDict.put(entry.name, entry.ref);
        const font = faces.font(run.face);
        let hex = '';
        for (const ch of run.text) {
          const cp = ch.codePointAt(0)!;
          if (cp === 0x200b || cp === 0xad) continue;
          const gid = font.encodeCharacter(cp);
          if (gid === 0) {
            missing.add(ch);
            continue;
          }
          hex += gid.toString(16).padStart(4, '0');
        }
        if (!hex) continue;
        // Text matrix in page space (x along the line, y = glyph up), then into PDF space.
        const [dx, dy] = line.dir ?? [1, 0];
        const [ux, uy] = [dy, -dx];
        const ox = line.origin ? line.origin.x + dx * run.x + ux * run.rise : run.x;
        const oy = line.origin
          ? line.origin.y + dy * run.x + uy * run.rise
          : line.baseline - run.rise;
        const tm = mupdf.Matrix.concat(
          [dx * run.size, dy * run.size, ux * run.size, uy * run.size, ox, oy],
          inv,
        );
        const [r, g, b] = run.color;
        const tc = run.tracking ? `${fmt(run.tracking)} Tc ` : '';
        ops += `BT /${entry.name} 1 Tf ${tc}${fmt(r)} ${fmt(g)} ${fmt(b)} rg ${tm.map(fmt).join(' ')} Tm <${hex}> Tj ET\n`;
      }
    }
    ops += 'Q\n';
    return ops;
  };

  try {
    for (const pw of pages) {
      const loaded = doc.loadPage(pw.index);
      if (!(loaded instanceof mupdf.PDFPage)) throw new Error('Not a PDF page');
      const page = loaded;
      try {
        for (const r of pw.redact) {
          const annot = page.createAnnotation('Redact');
          annot.setRect([r.x0, r.y0, r.x1, r.y1]);
        }
        if (pw.redact.length) {
          page.applyRedactions(
            false,
            mupdf.PDFPage.REDACT_IMAGE_NONE,
            mupdf.PDFPage.REDACT_LINE_ART_NONE,
            mupdf.PDFPage.REDACT_TEXT_REMOVE,
          );
        }

        // Links over translated text move with the text.
        for (const link of page.getLinks()) {
          const [x0, y0, x1, y1] = link.getBounds();
          const overlaps = pw.redact.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
          if (overlaps && link.isExternal()) {
            page.deleteLink(link);
            linksRemoved++;
          }
          link.destroy();
        }
        for (const line of pw.lines) {
          let cur: { uri: string; rect: Rect } | null = null;
          const flush = () => {
            if (cur) {
              page
                .createLink([cur.rect.x0, cur.rect.y0, cur.rect.x1, cur.rect.y1], cur.uri)
                .destroy();
              linksAdded++;
            }
            cur = null;
          };
          for (const run of line.runs) {
            if (!run.linkUri) {
              flush();
              continue;
            }
            const rect = {
              x0: run.x,
              y0: line.baseline - run.size * 0.8,
              x1: run.x + run.width,
              y1: line.baseline + run.size * 0.2,
            };
            if (cur && (cur as { uri: string }).uri === run.linkUri)
              (cur as { rect: Rect }).rect.x1 = rect.x1;
            else {
              flush();
              cur = { uri: run.linkUri, rect };
            }
          }
          flush();
        }

        if (pw.lines.length) {
          const inv = mupdf.Matrix.invert(page.getTransform());
          const pageObj = page.getObject();
          if (pageObj.get('Resources').isNull())
            pageObj.put('Resources', pageObj.getInheritable('Resources'));
          let resources = pageObj.get('Resources');
          if (resources.isNull()) {
            resources = doc.newDictionary();
            pageObj.put('Resources', resources);
          }
          let fontDict = resources.get('Font');
          if (fontDict.isNull()) {
            fontDict = doc.newDictionary();
            resources.put('Font', fontDict);
          }
          const ops = buildOps(pw.lines, fontDict, inv);
          const contents = pageObj.get('Contents');
          const arr = doc.newArray();
          arr.push(doc.addStream('q\n', null));
          if (contents.isArray())
            for (let i = 0; i < contents.length; i++) arr.push(contents.get(i));
          else if (!contents.isNull()) arr.push(contents);
          arr.push(doc.addStream('Q\n', null));
          arr.push(doc.addStream(ops, null));
          pageObj.put('Contents', arr);
        }
        for (const note of pw.notes ?? []) {
          const annot = page.createAnnotation('Text');
          annot.setRect([note.rect.x1 - 2, note.rect.y0, note.rect.x1 + 14, note.rect.y0 + 16]);
          annot.setContents(note.text);
          annot.setIcon('Note');
          annot.update();
        }
        page.update();
      } finally {
        page.destroy();
      }
    }
    for (const extra of opts.appendix ?? []) {
      const resources = doc.newDictionary();
      const fontDict = doc.newDictionary();
      resources.put('Font', fontDict);
      const ops = buildOps(extra.lines, fontDict, [1, 0, 0, -1, 0, extra.height]);
      const pageObj = doc.addPage([0, 0, extra.width, extra.height], 0, resources, ops);
      doc.insertPage(doc.countPages(), pageObj);
    }
    if (opts.outline?.length) applyOutlineTitles(mupdf, doc, opts.outline);
    if (opts.title) doc.setMetaData('info:Title', opts.title);
    const sanitized = opts.sanitize === false ? [] : sanitizePdf(doc);
    doc.subsetFonts();
    const mono = doc.saveToBuffer('compress,garbage=compact').asUint8Array().slice();
    const dual = opts.dual ? await sideBySide(source, mono) : null;
    return { mono, dual, linksRemoved, linksAdded, missingGlyphs: [...missing].sort(), sanitized };
  } finally {
    doc.destroy();
  }
}

/** Dual output: each page = original (left) + translation (right). */
async function sideBySide(original: Uint8Array, translated: Uint8Array): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const a = mupdf.Document.openDocument(original, 'application/pdf');
  const b = mupdf.Document.openDocument(translated, 'application/pdf');
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, 'pdf', 'compress');
  try {
    for (let i = 0; i < a.countPages(); i++) {
      const pa = a.loadPage(i);
      const pb = b.loadPage(i);
      const [x0, y0, x1, y1] = pa.getBounds();
      const w = x1 - x0;
      const dev = writer.beginPage([0, 0, 2 * w, y1 - y0]);
      pa.run(dev, mupdf.Matrix.translate(-x0, -y0));
      pb.run(dev, mupdf.Matrix.translate(w - x0, -y0));
      writer.endPage();
      pa.destroy();
      pb.destroy();
    }
    writer.close();
    return buf.asUint8Array().slice();
  } finally {
    a.destroy();
    b.destroy();
    buf.destroy();
  }
}
