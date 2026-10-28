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
}

export type EditableItem =
  | { kind: 'paragraph'; style: ParagraphKind; align: Align; runs: EditableRun[] }
  /** Column widths in points. */
  | { kind: 'table'; columns: number[]; rows: TableCell[][] }
  /** `picture` indexes the PNGs passed to the writer; size in points. */
  | { kind: 'picture'; picture: number; width: number; height: number };

export interface EditableOptions {
  /** w:lang of the text, e.g. "en-US". */
  locale: string;
  title?: string;
  /** Page size in points (the source PDF's first page). */
  page: { width: number; height: number };
  /** Footnotes the runs with `footnote` refer to. */
  footnotes?: EditableRun[][];
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

function runXml(r: EditableRun, hyperlink: boolean): string {
  if (r.footnote !== undefined)
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${r.footnote + 1}"/></w:r>`;
  const props = [
    hyperlink ? '<w:rStyle w:val="Hyperlink"/>' : '',
    r.mono ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>' : '',
    r.bold ? '<w:b/><w:bCs/>' : '',
    r.italic ? '<w:i/><w:iCs/>' : '',
    r.color && !hyperlink ? `<w:color w:val="${r.color}"/>` : '',
    r.underline && !hyperlink ? '<w:u w:val="single"/>' : '',
    r.superscript ? '<w:vertAlign w:val="superscript"/>' : '',
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

  runs(runs: EditableRun[]): string {
    let out = '';
    for (let i = 0; i < runs.length;) {
      const link = runs[i]!.link;
      if (!link) {
        out += runXml(runs[i]!, false);
        i++;
        continue;
      }
      let inner = '';
      while (i < runs.length && runs[i]!.link === link) inner += runXml(runs[i++]!, true);
      out += `<w:hyperlink r:id="${this.linkId(link)}">${inner}</w:hyperlink>`;
    }
    return out;
  }

  paragraph(style: ParagraphKind, align: Align, runs: EditableRun[]): string {
    const pStyle = style === 'body' ? '' : `<w:pStyle w:val="${STYLE_IDS[style]}"/>`;
    return `<w:p><w:pPr>${pStyle}<w:jc w:val="${JC[align]}"/></w:pPr>${this.runs(runs)}</w:p>`;
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

  table(columns: number[], rows: TableCell[][], textWidth: number): string {
    const total = columns.reduce((a, b) => a + b, 0) || 1;
    const fit = Math.min(1, textWidth / total);
    const twips = columns.map((c) => Math.max(200, Math.round(c * fit * 20)));
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:color="808080"/>`;
    const body = rows
      .map(
        (row) =>
          `<w:tr>${row
            .map((cell, c) => {
              const paragraphs = cell.paragraphs.length ? cell.paragraphs : [[]];
              return `<w:tc><w:tcPr><w:tcW w:w="${twips[c] ?? 200}" w:type="dxa"/></w:tcPr>${paragraphs
                .map(
                  (p) => `<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>${this.runs(p)}</w:p>`,
                )
                .join('')}</w:tc>`;
            })
            .join('')}</w:tr>`,
      )
      .join('');
    return (
      `<w:tbl><w:tblPr><w:tblW w:w="${twips.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/>` +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>` +
      `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${twips.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>` +
      // Word needs a paragraph between two tables, and after a table at the end of the body.
      `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`
    );
  }
}

function stylesXml(locale: string): string {
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
  const heading = (level: number, size: number) =>
    style(
      'paragraph',
      `Heading${level}`,
      `heading ${level}`,
      `<w:keepNext/><w:spacing w:before="${level === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/>`,
      `<w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
      based,
    );
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>` +
    `<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${locale}" w:eastAsia="${locale}" w:bidi="${locale}"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    style('paragraph', 'Normal', 'Normal', '', '', '<w:qFormat/>').replace(
      '<w:style w:type="paragraph"',
      '<w:style w:type="paragraph" w:default="1"',
    ) +
    style(
      'paragraph',
      'Title',
      'Title',
      '<w:jc w:val="center"/><w:spacing w:after="240"/>',
      '<w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/>',
      based,
    ) +
    heading(1, 28) +
    heading(2, 26) +
    heading(3, 24) +
    style(
      'paragraph',
      'Caption',
      'caption',
      '<w:spacing w:before="60" w:after="200"/>',
      '<w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/>',
      based,
    ) +
    style(
      'paragraph',
      'FootnoteText',
      'footnote text',
      '<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>',
      '<w:sz w:val="18"/><w:szCs w:val="18"/>',
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'Bibliography',
      'Bibliography',
      '<w:ind w:left="360" w:hanging="360"/>',
      '<w:sz w:val="20"/><w:szCs w:val="20"/>',
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'Code',
      'Code',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="18"/><w:szCs w:val="18"/>',
      '<w:basedOn w:val="Normal"/><w:qFormat/>',
    ) +
    style(
      'paragraph',
      'Figure',
      'Figure',
      '<w:keepNext/><w:spacing w:before="120" w:after="60"/>',
      '',
      '<w:basedOn w:val="Normal"/>',
    ) +
    style(
      'paragraph',
      'TableText',
      'Table Text',
      '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
      '<w:sz w:val="20"/><w:szCs w:val="20"/>',
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
  const textWidth = Math.max(144, opts.page.width - 2 * MARGIN_PT);
  const textHeight = Math.max(144, opts.page.height - 2 * MARGIN_PT);
  const pkg = new Package(10);
  const body = items
    .map((item) => {
      if (item.kind === 'paragraph') return pkg.paragraph(item.style, item.align, item.runs);
      if (item.kind === 'table') return pkg.table(item.columns, item.rows, textWidth);
      // Pictures keep their size on the page, shrunk to the text area when larger.
      const fit = Math.min(1, textWidth / item.width, (0.9 * textHeight) / item.height);
      return pkg.picture(item.picture, item.width * fit, item.height * fit);
    })
    .join('');
  const twips = (pt: number) => Math.round(pt * 20);
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}" xmlns:r="${R}" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="${twips(opts.page.width)}" w:h="${twips(opts.page.height)}"/>` +
    `<w:pgMar w:top="${twips(MARGIN_PT)}" w:right="${twips(MARGIN_PT)}" w:bottom="${twips(MARGIN_PT)}" w:left="${twips(MARGIN_PT)}" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`;
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
    `<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>` +
    (notes.length
      ? `<Relationship Id="rId2" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rId3" Type="${R}/settings" Target="settings.xml"/>`
      : '') +
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
        ? `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>` +
          `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`
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
  add('word/styles.xml', stylesXml(opts.locale));
  add('word/_rels/document.xml.rels', rels);
  if (notes.length) {
    add('word/footnotes.xml', footnotesXml);
    add('word/settings.xml', settings);
  }
  pictures.forEach((png, i) => add(`word/media/image${i + 1}.png`, png));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
