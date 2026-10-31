import JSZip from 'jszip';

/**
 * Editable Word document of a translated PDF (P9.4): the text reflows in Word's own styles
 * (Title, Heading 1–3, Caption, Footnote Text, Bibliography), tables are Word tables, figures and
 * display formulas are pictures cut from the translated PDF.
 */

export interface EditableRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  mono?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  /** Part of an inline formula: its raised digits are exponents, never footnote marks. */
  math?: boolean;
  /** RGB hex without '#'; unset for black. */
  color?: string;
  link?: string;
  /** A line break before the text (code listings, manual breaks). */
  lineBreak?: boolean;
  /** A footnote reference (index into the footnotes); the run's text is not used. */
  footnote?: number;
}

export type ParagraphKind =
  | 'title'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'body'
  | 'caption'
  | 'footnote'
  | 'reference'
  | 'code';

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface TableCell {
  paragraphs: EditableRun[][];
  align?: Align;
}

/** Left and first-line indents in points, as the PDF sets the paragraph. */
export interface Indent {
  left?: number;
  /** Set in from the right too (an abstract, a quotation). */
  right?: number;
  firstLine?: number;
}

export type EditableItem =
  | {
      kind: 'paragraph';
      style: ParagraphKind;
      align: Align;
      runs: EditableRun[];
      indent?: Indent;
      /** Type size in points where the paragraph differs from its style (an affiliation). */
      size?: number;
      /** Across all text columns (the title block of a two-column paper). */
      wide?: boolean;
    }
  /**
   * Column widths in points; `rules`: the PDF's horizontal rules only (booktabs), `none`: no
   * borders (a grid of authors); `header`: rows above the header rule.
   */
  | {
      kind: 'table';
      columns: number[];
      rows: TableCell[][];
      borders?: 'grid' | 'rules' | 'none';
      header?: number;
      wide?: boolean;
    }
  /** `picture` indexes the PNGs passed to the writer; size in points. */
  | { kind: 'picture'; picture: number; width: number; height: number; wide?: boolean };

/** The PDF's page and type, measured from its running text (points). */
export interface WordLayout {
  margins: { top: number; right: number; bottom: number; left: number };
  /** Text columns of the running text and the gap between them. */
  columns: number;
  gap: number;
  /** Word fonts of the running text and of the title and headings. */
  font: string;
  headingFont: string;
  /** Type sizes by paragraph kind; `table` for table text. */
  sizes: Partial<Record<ParagraphKind | 'table', number>>;
  /** Baseline to baseline in running text, and the space after a paragraph. */
  leading: number;
  after: number;
}

export interface EditableOptions {
  /** w:lang of the text, e.g. "en-US". */
  locale: string;
  title?: string;
  /** Page size in points (the source PDF's first page). */
  page: { width: number; height: number };
  /** Footnotes the runs with `footnote` refer to. */
  footnotes?: EditableRun[][];
  /** The PDF's layout; without it, one column in Word's usual type. */
  layout?: WordLayout;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MARGIN_PT = 72;
const EMU_PER_PT = 12700;

// Characters XML 1.0 does not allow (control characters from broken text layers).
const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STYLE_IDS: Record<ParagraphKind, string> = {
  title: 'Title',
  heading1: 'Heading1',
  heading2: 'Heading2',
  heading3: 'Heading3',
  body: 'Normal',
  caption: 'Caption',
  footnote: 'FootnoteText',
  reference: 'Bibliography',
  code: 'Code',
};
const JC: Record<Align, string> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
};

/** Half-points, Word's unit of type size. */
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);

/** Code's font: narrower than Courier New, nearer the PDFs' Inconsolata and Latin Modern Mono. */
export const MONO = 'Consolas';
/** Consolas's advance, in em. */
export const MONO_WIDTH = 0.55;

function runXml(r: EditableRun, hyperlink: boolean, size?: number): string {
  if (r.footnote !== undefined)
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${r.footnote + 1}"/></w:r>`;
  const props = [
    hyperlink ? '<w:rStyle w:val="Hyperlink"/>' : '',
    r.mono ? `<w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/>` : '',
    r.bold ? '<w:b/><w:bCs/>' : '',
    r.italic ? '<w:i/><w:iCs/>' : '',
    r.color && !hyperlink ? `<w:color w:val="${r.color}"/>` : '',
    size ? `<w:sz w:val="${halfPoints(size)}"/><w:szCs w:val="${halfPoints(size)}"/>` : '',
    r.underline && !hyperlink ? '<w:u w:val="single"/>' : '',
    r.superscript ? '<w:vertAlign w:val="superscript"/>' : '',
    r.subscript ? '<w:vertAlign w:val="subscript"/>' : '',
  ].join('');
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  const parts = r.text.split('\t');
  const body = parts
    .map((p, i) => `${i ? '<w:tab/>' : ''}${p ? `<w:t xml:space="preserve">${esc(p)}</w:t>` : ''}`)
    .join('');
  return `<w:r>${rPr}${r.lineBreak ? '<w:br/>' : ''}${body}</w:r>`;
}

class Package {
  private readonly links = new Map<string, string>();
  private pictureCount = 0;
  constructor(private readonly firstImageRel: number) {}

  linkId(url: string): string {
    let id = this.links.get(url);
    if (!id) {
      id = `rIdL${this.links.size + 1}`;
      this.links.set(url, id);
    }
    return id;
  }

  linkRels(): string {
    return [...this.links]
      .map(
        ([url, id]) =>
          `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${esc(url)}" TargetMode="External"/>`,
      )
      .join('');
  }

  runs(runs: EditableRun[], size?: number): string {
    let out = '';
    for (let i = 0; i < runs.length;) {
      const link = runs[i]!.link;
      if (!link) {
        out += runXml(runs[i]!, false, size);
        i++;
        continue;
      }
      let inner = '';
      while (i < runs.length && runs[i]!.link === link) inner += runXml(runs[i++]!, true, size);
      out += `<w:hyperlink r:id="${this.linkId(link)}">${inner}</w:hyperlink>`;
    }
    return out;
  }

  paragraph(item: Extract<EditableItem, { kind: 'paragraph' }>): string {
    const pStyle = item.style === 'body' ? '' : `<w:pStyle w:val="${STYLE_IDS[item.style]}"/>`;
    const { left, right, firstLine } = item.indent ?? {};
    // A negative first line hangs (a list item's bullet before the lines under it).
    const ind =
      left || right || firstLine
        ? `<w:ind${left ? ` w:left="${twips(left)}"` : ''}${right ? ` w:right="${twips(right)}"` : ''}${
            firstLine
              ? firstLine > 0
                ? ` w:firstLine="${twips(firstLine)}"`
                : ` w:hanging="${twips(-firstLine)}"`
              : ''
          }/>`
        : '';
    return `<w:p><w:pPr>${pStyle}${ind}<w:jc w:val="${JC[item.align]}"/></w:pPr>${this.runs(item.runs, item.size)}</w:p>`;
  }

  picture(index: number, widthPt: number, heightPt: number): string {
    const n = ++this.pictureCount;
    const cx = Math.round(widthPt * EMU_PER_PT);
    const cy = Math.round(heightPt * EMU_PER_PT);
    const rel = `rId${this.firstImageRel + index}`;
    return (
      `<w:p><w:pPr><w:pStyle w:val="Figure"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>` +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${n}" name="image${index + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }

  table(item: Extract<EditableItem, { kind: 'table' }>, textWidth: number): string {
    const { columns, rows } = item;
    const borders = item.borders ?? 'grid';
    const total = columns.reduce((a, b) => a + b, 0) || 1;
    // A table across most of its column fills it: translations run longer than the PDF's text.
    const fit = total > 0.6 * textWidth ? textWidth / total : 1;
    const widths = columns.map((c) => Math.max(200, Math.round(c * fit * 20)));
    const line = (side: string, sz = 4, color = '808080') =>
      `<w:${side} w:val="single" w:sz="${sz}" w:color="${color}"/>`;
    const none = (side: string) => `<w:${side} w:val="nil"/>`;
    const tableBorders =
      borders === 'grid'
        ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => line(s))
        : borders === 'rules'
          ? [
              line('top', 8, '000000'),
              none('left'),
              line('bottom', 8, '000000'),
              none('right'),
              none('insideH'),
              none('insideV'),
            ]
          : ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(none);
    // Booktabs: a thin rule under the header rows.
    const header = borders === 'rules' ? Math.max(1, item.header ?? 1) : 0;
    const body = rows
      .map(
        (row, r) =>
          `<w:tr>${row
            .map((cell, c) => {
              const paragraphs = cell.paragraphs.length ? cell.paragraphs : [[]];
              const under =
                r === header - 1 && rows.length > header
                  ? `<w:tcBorders>${line('bottom', 4, '000000')}</w:tcBorders>`
                  : '';
              const jc = cell.align ? `<w:jc w:val="${JC[cell.align]}"/>` : '';
              return `<w:tc><w:tcPr><w:tcW w:w="${widths[c] ?? 200}" w:type="dxa"/>${under}</w:tcPr>${paragraphs
                .map(
                  (p) =>
                    `<w:p><w:pPr><w:pStyle w:val="TableText"/>${jc}</w:pPr>${this.runs(p)}</w:p>`,
                )
                .join('')}</w:tc>`;
            })
            .join('')}</w:tr>`,
      )
      .join('');
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/>` +
      `<w:tblBorders>${tableBorders.join('')}</w:tblBorders>` +
      `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>` +
      // Word needs a paragraph between two tables, and after a table at the end of the body.
      `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`
    );
  }
}

function stylesXml(locale: string, layout?: WordLayout): string {
  // Word's usual type without a layout; the PDF's fonts, sizes and leading with one.
  const size = (kind: ParagraphKind | 'table', fallback: number) =>
    halfPoints(layout?.sizes[kind] ?? fallback / 2);
  const font = (name: string) =>
    `<w:rFonts w:ascii="${esc(name)}" w:hAnsi="${esc(name)}" w:eastAsia="${esc(name)}" w:cs="${esc(name)}"/>`;
  const sz = (v: number) => `<w:sz w:val="${v}"/><w:szCs w:val="${v}"/>`;
  const heading_ = layout ? font(layout.headingFont) : '';
  // At least the PDF's leading: inline pictures and superscripts still fit.
  const lines = layout
    ? `w:line="${twips(layout.leading)}" w:lineRule="atLeast"`
    : 'w:line="276" w:lineRule="auto"';
  const after = layout ? twips(layout.after) : 120;
  const space = (before: number, below: number) =>
    layout
      ? `w:before="${twips(before * layout.leading)}" w:after="${twips(below * layout.leading)}"`
      : `w:before="${twips(before * 12)}" w:after="${twips(below * 12)}"`;
  const style = (
    type: 'paragraph' | 'character',
    id: string,
    name: string,
    pPr: string,
    rPr: string,
    extra = '',
  ) =>
    `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${extra}${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`;
  const based = '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>';
  const heading = (level: number, fallback: number) =>
    style(
      'paragraph',
      `Heading${level}`,
      `heading ${level}`,
      `<w:keepNext/><w:spacing ${level === 1 ? space(1.5, 0.5) : space(1, 0.4)}/><w:outlineLvl w:val="${level - 1}"/>`,
      `${heading_}<w:b/><w:bCs/>${sz(size(`heading${level}` as ParagraphKind, fallback))}`,
      based,
    );
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    font(layout?.font ?? 'Times New Roman') +
    `${sz(size('body', 24))}<w:lang w:val="${locale}" w:eastAsia="${locale}" w:bidi="${locale}"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${after}" ${lines}/></w:pPr></w:pPrDefault></w:docDefaults>` +
    style('paragraph', 'Normal', 'Normal', '', '', '<w:qFormat/>').replace(
      '<w:style w:type="paragraph"',
      '<w:style w:type="paragraph" w:default="1"',
    ) +
    style(
      'paragraph',
      'Title',
      'Title',
      `<w:jc w:val="center"/><w:spacing ${space(0, 1)}/>`,
      `${heading_}<w:b/><w:bCs/>${sz(size('title', 36))}`,
      based,
    ) +
    heading(1, 28) +
    heading(2, 26) +
    heading(3, 24) +
    style(
      'paragraph',
      'Caption',
      'caption',
      `<w:spacing ${space(0.3, 0.8)}/>`,
      // The PDF's captions keep their own emphasis ("Table 1:" in bold).
      `${layout ? '' : '<w:i/><w:iCs/>'}${sz(size('caption', 20))}`,
      based,
    ) +
    style(
      'paragraph',
      'FootnoteText',
      'footnote text',
      '<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>',
      sz(size('footnote', 18)),
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'Bibliography',
      'Bibliography',
      `<w:spacing w:after="${layout ? twips(0.2 * layout.leading) : 120}"/><w:ind w:left="360" w:hanging="360"/>`,
      sz(size('reference', 20)),
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'Code',
      'Code',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      `<w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}" w:cs="${MONO}"/>${sz(size('code', 18))}`,
      '<w:basedOn w:val="Normal"/><w:qFormat/>',
    ) +
    style(
      'paragraph',
      'Figure',
      'Figure',
      `<w:keepNext/><w:spacing ${space(0.5, 0.3)}/>`,
      '',
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'TableText',
      'Table Text',
      '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>',
      sz(size('table', 20)),
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'character',
      'Hyperlink',
      'Hyperlink',
      '',
      '<w:color w:val="0563C1"/><w:u w:val="single"/>',
    ) +
    style(
      'character',
      'FootnoteReference',
      'footnote reference',
      '',
      '<w:vertAlign w:val="superscript"/>',
    ) +
    `</w:styles>`
  );
}

/** Builds the DOCX package; `pictures` are the PNGs the picture items point to. */
export async function buildEditableDocx(
  items: EditableItem[],
  pictures: Uint8Array[],
  opts: EditableOptions,
): Promise<Uint8Array> {
  const layout = opts.layout;
  const margins = layout?.margins ?? {
    top: MARGIN_PT,
    right: MARGIN_PT,
    bottom: MARGIN_PT,
    left: MARGIN_PT,
  };
  const textWidth = Math.max(144, opts.page.width - margins.left - margins.right);
  const textHeight = Math.max(144, opts.page.height - margins.top - margins.bottom);
  const columns = Math.max(1, layout?.columns ?? 1);
  const gap = layout?.gap ?? 0;
  const columnWidth = (textWidth - gap * (columns - 1)) / columns;
  const pkg = new Package(10);
  const wide = (item: EditableItem) => columns > 1 && !!item.wide;
  const xml = (item: EditableItem) => {
    const width = wide(item) ? textWidth : columnWidth;
    if (item.kind === 'paragraph') return pkg.paragraph(item);
    if (item.kind === 'table') return pkg.table(item, width);
    // Pictures keep their size on the page, shrunk to the text area when larger.
    const fit = Math.min(1, width / item.width, (0.9 * textHeight) / item.height);
    return pkg.picture(item.picture, item.width * fit, item.height * fit);
  };
  const section = (cols: number, first: boolean) =>
    `<w:sectPr>${first ? '' : '<w:type w:val="continuous"/>'}` +
    `<w:pgSz w:w="${twips(opts.page.width)}" w:h="${twips(opts.page.height)}"/>` +
    `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="${twips(Math.min(36, margins.top / 2))}" w:footer="${twips(Math.min(36, margins.bottom / 2))}" w:gutter="0"/>` +
    (cols > 1 ? `<w:cols w:num="${cols}" w:space="${twips(gap)}"/>` : '') +
    `</w:sectPr>`;
  // Runs of items across the columns (the title block, a wide figure) and in them, each a Word
  // section; a section's properties close it, in an empty paragraph or at the body's end.
  let body = '';
  let first = true;
  for (let i = 0; i < items.length;) {
    const across = wide(items[i]!);
    let j = i;
    while (j < items.length && wide(items[j]!) === across) body += xml(items[j++]!);
    if (j < items.length) {
      body += `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${section(across ? 1 : columns, first)}</w:pPr></w:p>`;
      first = false;
    } else body += section(across ? 1 : columns, first);
    i = j;
  }
  if (!items.length) body = section(1, true);
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}` +
    `</w:body></w:document>`;
  const notes = opts.footnotes ?? [];
  // Word's own separators (ids -1 and 0); the notes are numbered from 1. Links inside a note
  // would need relationships of their own: their text is kept.
  const footnotesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="${W}" xmlns:r="${R}">` +
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    notes
      .map(
        (runs, i) =>
          `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>` +
          `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` +
          `${new Package(0).runs(runs.map(({ link: _link, ...r }) => r))}</w:p></w:footnote>`,
      )
      .join('') +
    `</w:footnotes>`;
  const settings =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}">` +
    // Laid out like the PDF: justified columns hyphenated as the paper's are, in its language.
    (layout ? '<w:autoHyphenation/>' : '') +
    (notes.length
      ? `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>`
      : '') +
    `</w:settings>`;
  const withSettings = notes.length > 0 || !!layout;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
    (notes.length ? `<Relationship Id="rId2" Type="${R}/footnotes" Target="footnotes.xml"/>` : '') +
    (withSettings ? `<Relationship Id="rId3" Type="${R}/settings" Target="settings.xml"/>` : '') +
    pictures
      .map(
        (_, i) =>
          `<Relationship Id="rId${10 + i}" Type="${R}/image" Target="media/image${i + 1}.png"/>`,
      )
      .join('') +
    pkg.linkRels() +
    `</Relationships>`;
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `${opts.title ? `<dc:title>${esc(opts.title)}</dc:title>` : ''}<dc:language>${esc(opts.locale)}</dc:language>` +
    `</cp:coreProperties>`;
  const zip = new JSZip();
  // Fixed dates: the same input gives the same file.
  const date = new Date(Date.UTC(2000, 0, 1));
  const add = (name: string, data: string | Uint8Array) => zip.file(name, data, { date });
  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      (notes.length
        ? `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`
        : '') +
      (withSettings
        ? `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
        : '') +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  add('docProps/core.xml', core);
  add('word/document.xml', document);
  add('word/styles.xml', stylesXml(opts.locale, layout));
  add('word/_rels/document.xml.rels', rels);
  if (notes.length) add('word/footnotes.xml', footnotesXml);
  if (withSettings) add('word/settings.xml', settings);
  pictures.forEach((png, i) => add(`word/media/image${i + 1}.png`, png));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
