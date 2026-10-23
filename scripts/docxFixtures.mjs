// Synthetic DOCX fixtures (TESTING.md §2), written in Turkish (main use case).
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HeightRule,
  InsertedTextRun,
  Math as OMath,
  MathFraction,
  MathRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  Textbox,
  TextRun,
  WidthType,
} from 'docx';
import { ChartRun } from 'docx/charts';

const DATE = '2026-01-01T00:00:00Z';
const p = (text, opts = {}) => new Paragraph({ children: [new TextRun(text)], ...opts });

function academic() {
  return new Document({
    creator: 'samepage fixtures',
    title: 'Türkçe akademik metinlerde anlam kayması',
    comments: {
      children: [
        {
          id: 0,
          author: 'Hakem',
          date: new Date(DATE),
          children: [p('Bu tümce daha açık yazılmalıdır.')],
        },
      ],
    },
    footnotes: {
      1: {
        children: [p('Derlem, 2019–2023 yılları arasında yayımlanmış makalelerden oluşmaktadır.')],
      },
    },
    sections: [
      {
        headers: { default: new Header({ children: [p('Samepage Dergisi · Cilt 3, Sayı 2')] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun('Sayfa '), new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun('Türkçe akademik metinlerde anlam kayması')],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. Giriş')] }),
          new Paragraph({
            children: [
              new TextRun('Bu çalışmada '),
              new TextRun({ text: 'makine çevirisi', bold: true }),
              new TextRun(' sistemlerinin '),
              new TextRun({ text: 'terim tutarlılığı', italics: true }),
              new TextRun(' incelenmiştir'),
              new FootnoteReferenceRun(1),
              new TextRun('. Ayrıntılar için '),
              new ExternalHyperlink({
                link: 'https://example.org/derlem',
                children: [new TextRun({ text: 'proje sayfasına', style: 'Hyperlink' })],
              }),
              new TextRun(' bakınız [3].'),
            ],
          }),
          new Paragraph({
            children: [
              new CommentRangeStart(0),
              new TextRun('Ortalama doğruluk %87,4 olarak ölçülmüştür'),
              new CommentRangeEnd(0),
              new TextRun({ children: [new CommentReference(0)] }),
              new TextRun('; '),
              new DeletedTextRun({
                text: 'eski değer %80 idi',
                id: 1,
                author: 'Yazar',
                date: DATE,
              }),
              new InsertedTextRun({ text: 'fark anlamlıdır', id: 2, author: 'Yazar', date: DATE }),
              new TextRun('.'),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun('F-ölçütü '),
              new OMath({
                children: [
                  new MathRun('F = '),
                  new MathFraction({
                    numerator: [new MathRun('2PR')],
                    denominator: [new MathRun('P+R')],
                  }),
                ],
              }),
              new TextRun(' biçiminde tanımlanır.'),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('2. Bulgular')],
          }),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: [3000, 6000],
            rows: [
              new TableRow({
                height: { value: 400, rule: HeightRule.EXACT },
                children: [
                  new TableCell({ children: [p('Ölçüt')] }),
                  new TableCell({ children: [p('Açıklama')] }),
                ],
              }),
              new TableRow({
                height: { value: 400, rule: HeightRule.EXACT },
                children: [
                  new TableCell({ children: [p('Kesinlik')] }),
                  new TableCell({ children: [p('Doğru olarak sınıflandırılan örneklerin oranı')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [p('Kaynak')] }),
                  new TableCell({
                    children: [
                      p('Veri kümesi: https://example.org/cok/uzun/bir/yol/adi/veri-kumesi-2023'),
                    ],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({
            children: [
              new ChartRun({
                type: 'column',
                title: 'Terim tutarlılığı',
                categories: ['Kısa tümce', 'Uzun tümce'],
                series: [{ name: 'Doğruluk', values: [87.4, 71.2] }],
                categoryAxis: { title: 'Tümce uzunluğu' },
                valueAxis: { title: 'Yüzde' },
                transformation: { width: 400, height: 250 },
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Şekil 1. Tümce uzunluğuna göre terim tutarlılığı.',
                italics: true,
              }),
            ],
            style: 'Caption',
          }),
          new Textbox({
            style: { width: '200pt', height: '40pt' },
            children: [p('Önemli not: sonuçlar genellenemez.')],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Kaynakça')] }),
          p(
            'Yılmaz, A. ve Demir, B. (2021). Türkçe metinlerde terim tutarlılığı. Dil Dergisi, 12(3), 45–67.',
          ),
        ],
      },
    ],
  });
}

export async function buildDocxFixtures() {
  return { 'academic.docx': new Uint8Array(await Packer.toBuffer(academic())) };
}
