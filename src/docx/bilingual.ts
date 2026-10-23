import JSZip from 'jszip';

export interface BilingualRow {
  source: string;
  target: string;
  notes: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cell(text: string, opts: { bold?: boolean; width: number; shade?: string }): string {
  const rPr = opts.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const shade = opts.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>` : '';
  const paragraphs = (text || ' ')
    .split('\n')
    .map((line) => `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`)
    .join('');
  return `<w:tc><w:tcPr><w:tcW w:w="${opts.width}" w:type="dxa"/>${shade}</w:tcPr>${paragraphs}</w:tc>`;
}

/**
 * Bilingual review document (P1b.6): a landscape DOCX table source | translation | notes, for
 * proofreading by the author, a supervisor or an editor.
 */
export async function buildBilingualDocx(
  rows: BilingualRow[],
  labels: { title: string; source: string; target: string; notes: string },
): Promise<Uint8Array> {
  const widths = [6200, 6200, 2400];
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(labels.source, { bold: true, width: widths[0]!, shade: 'E2E8F0' })}${cell(labels.target, { bold: true, width: widths[1]!, shade: 'E2E8F0' })}${cell(labels.notes, { bold: true, width: widths[2]!, shade: 'E2E8F0' })}</w:tr>`;
  const body = rows
    .map(
      (r) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(r.source, { width: widths[0]! })}${cell(r.target, { width: widths[1]! })}${cell(r.notes, { width: widths[2]!, ...(r.notes ? { shade: 'FEF3C7' } : {}) })}</w:tr>`,
    )
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${esc(labels.title)}</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>
<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${header}${body}</w:tbl>
<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file('word/document.xml', document);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
