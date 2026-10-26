import type { Rect } from '../../core/ir/types';
import type { LayoutLine } from '../typeset/layout';
import { FACE_FILES } from '../typeset/types';
import type { LoadedFaces } from './fonts';
import { loadMupdf, type MupdfModule } from './mupdf';
import { applyOutlineTitles } from './outline';
import { sanitizePdf } from './sanitize';

export interface PageWrite {
  index: number;
  /** Areas whose text is removed (page space). Images, fills and rules survive. */
  redact: Rect[];
  /** Underline rules of translated text, removed (the translation draws its own). */
  lineArt?: Rect[];
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
  /** The same characters by output page. */
  missingByPage: { pageIndex: number; chars: string[] }[];
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
  const missing = new Map<number, Set<string>>();
  let linksRemoved = 0;
  let linksAdded = 0;

  /** Content-stream operators for laid-out lines; registers fonts in `fontDict`. */
  const buildOps = (
    lines: LayoutLine[],
    fontDict: ReturnType<typeof doc.newDictionary>,
    inv: [number, number, number, number, number, number],
    pageIndex: number,
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
            if (!missing.has(pageIndex)) missing.set(pageIndex, new Set());
            missing.get(pageIndex)!.add(ch);
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
        if (run.underline && !line.origin) {
          // Drawn in page space (y down) through the page's inverse transform.
          const thick = Math.max(0.4, 0.05 * run.size);
          const y = line.baseline - run.rise + 0.12 * run.size;
          ops += `q ${inv.map(fmt).join(' ')} cm ${fmt(r)} ${fmt(g)} ${fmt(b)} rg ${fmt(ox)} ${fmt(y)} ${fmt(run.width)} ${fmt(thick)} re f Q\n`;
        }
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
        if (pw.lineArt?.length) {
          for (const r of pw.lineArt) {
            const annot = page.createAnnotation('Redact');
            annot.setRect([r.x0 - 0.5, r.y0 - 0.5, r.x1 + 0.5, r.y1 + 0.5]);
          }
          page.applyRedactions(
            false,
            mupdf.PDFPage.REDACT_IMAGE_NONE,
            mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
            mupdf.PDFPage.REDACT_TEXT_NONE,
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
          const ops = buildOps(pw.lines, fontDict, inv, pw.index);
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
      const ops = buildOps(extra.lines, fontDict, [1, 0, 0, -1, 0, extra.height], doc.countPages());
      const pageObj = doc.addPage([0, 0, extra.width, extra.height], 0, resources, ops);
      doc.insertPage(doc.countPages(), pageObj);
    }
    if (opts.outline?.length) applyOutlineTitles(mupdf, doc, opts.outline);
    if (opts.title) doc.setMetaData('info:Title', opts.title);
    const sanitized = opts.sanitize === false ? [] : sanitizePdf(doc);
    doc.subsetFonts();
    const mono = doc.saveToBuffer('compress,garbage=compact').asUint8Array().slice();
    const dual = opts.dual ? await sideBySide(source, mono) : null;
    const missingByPage = [...missing]
      .sort(([a], [b]) => a - b)
      .map(([pageIndex, chars]) => ({ pageIndex, chars: [...chars].sort() }));
    const missingGlyphs = [...new Set(missingByPage.flatMap((m) => m.chars))].sort();
    return { mono, dual, linksRemoved, linksAdded, missingGlyphs, missingByPage, sanitized };
  } finally {
    doc.destroy();
  }
}

type PDFDoc = NonNullable<ReturnType<InstanceType<MupdfModule['Document']>['asPDF']>>;
type PDFObj = ReturnType<PDFDoc['newDictionary']>;

/**
 * A page as a Form XObject in `out`: its content streams, resources and visible box, plus the
 * matrix that draws it upright at the origin (honours /Rotate and the crop box).
 */
function pageAsXObject(
  mupdf: MupdfModule,
  out: PDFDoc,
  map: ReturnType<PDFDoc['newGraftMap']>,
  src: PDFDoc,
  index: number,
): { xobject: PDFObj; matrix: number[]; width: number; height: number } {
  const page = src.loadPage(index) as InstanceType<MupdfModule['PDFPage']>;
  try {
    const obj = page.getObject();
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0;
    const height = y1 - y0;
    // Page space → fitz space (y down, rotated) → PDF space of the new page (y up).
    const matrix = mupdf.Matrix.concat(
      mupdf.Matrix.concat(page.getTransform(), mupdf.Matrix.translate(-x0, -y0)),
      [1, 0, 0, -1, 0, height],
    );
    const parts: Uint8Array[] = [];
    const contents = obj.get('Contents');
    const streams = contents.isArray()
      ? Array.from({ length: contents.length }, (_, i) => contents.get(i))
      : contents.isNull()
        ? []
        : [contents];
    for (const stream of streams) {
      if (!stream.isStream()) continue;
      const buf = stream.readStream();
      parts.push(buf.asUint8Array().slice(), new Uint8Array([10]));
      buf.destroy();
    }
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    const box = obj.getInheritable('CropBox');
    const dict = out.newDictionary();
    dict.put('Type', out.newName('XObject'));
    dict.put('Subtype', out.newName('Form'));
    dict.put('BBox', map.graftObject(box.isNull() ? obj.getInheritable('MediaBox') : box));
    const resources = obj.getInheritable('Resources');
    dict.put('Resources', resources.isNull() ? out.newDictionary() : map.graftObject(resources));
    return { xobject: out.addStream(bytes, dict), matrix, width, height };
  } finally {
    page.destroy();
  }
}

/**
 * Dual output: each page = original (left) + translation (right). Built at the PDF object level
 * (pages become Form XObjects), so every font type — including Type 3 — and every vector is
 * kept exactly. Annotations (links, notes) live in the single translated PDF.
 */
async function sideBySide(original: Uint8Array, translated: Uint8Array): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const a = mupdf.Document.openDocument(original, 'application/pdf').asPDF()!;
  const b = mupdf.Document.openDocument(translated, 'application/pdf').asPDF()!;
  const out = new mupdf.PDFDocument();
  const mapA = out.newGraftMap();
  const mapB = out.newGraftMap();
  try {
    for (let i = 0; i < a.countPages(); i++) {
      const left = pageAsXObject(mupdf, out, mapA, a, i);
      const right = pageAsXObject(mupdf, out, mapB, b, i);
      const xobjects = out.newDictionary();
      xobjects.put('L', left.xobject);
      xobjects.put('R', right.xobject);
      const resources = out.newDictionary();
      resources.put('XObject', xobjects);
      const cm = (m: number[], dx: number) =>
        `q ${[m[0], m[1], m[2], m[3], m[4]! + dx, m[5]].map((v) => +v!.toFixed(4)).join(' ')} cm`;
      const contents = `${cm(left.matrix, 0)} /L Do Q\n${cm(right.matrix, left.width)} /R Do Q\n`;
      const page = out.addPage(
        [0, 0, left.width + right.width, Math.max(left.height, right.height)],
        0,
        resources,
        contents,
      );
      out.insertPage(-1, page);
    }
    const buf = out.saveToBuffer('compress,garbage=compact');
    try {
      return buf.asUint8Array().slice();
    } finally {
      buf.destroy();
    }
  } finally {
    mapA.destroy();
    mapB.destroy();
    out.destroy();
    a.destroy();
    b.destroy();
  }
}
