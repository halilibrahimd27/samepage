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
import JSZip from 'jszip';

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

const mono = (text) => new TextRun({ text, font: 'Consolas' });
const cell = (text) => new TableCell({ children: [p(text)] });

/** A lab sheet with code: inline commands, a listing, a comment in words, a label in Consolas. */
function lab() {
  return new Document({
    creator: 'samepage fixtures',
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun('Hafta 2 Uygulama Föyü')],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. Kurulum')] }),
          new Paragraph({
            children: [
              new TextRun('Python sürümünü '),
              new TextRun({ text: 'mutlaka', bold: true }),
              new TextRun(' kontrol edin: '),
              mono('python3 --version'),
              new TextRun({ text: ' (3.10 veya üstü).', italics: true }),
            ],
          }),
          new Paragraph({ children: [mono('BİLMEN GEREKEN')] }),
          new Paragraph({ children: [mono('import hashlib')] }),
          new Paragraph({ children: [mono('mesaj = "Blokzincir".encode("utf-8")')] }),
          new Paragraph({ children: [mono('# İki bayt dizisi arasındaki farklı bit sayısı')] }),
          new Paragraph({ children: [mono('ozet = hashlib.sha256(mesaj).hexdigest()')] }),
          new Paragraph({ children: [mono('print(ozet)')] }),
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: [3000, 6000],
            rows: [
              new TableRow({ children: [cell('Oturum'), cell('Zaman')] }),
              new TableRow({ children: [cell('Birinci deneme'), cell('02.09., 14:03–14:12 UTC')] }),
            ],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Kaynakça')] }),
          p('Yılmaz, A. (2022). Kriptografiye giriş. Ankara: Bilim Yayınları.'),
        ],
      },
    ],
  });
}

/**
 * A Turkish paper with other languages in it: an English abstract (already in the target
 * language), an Arabic quotation set right to left, a German quotation; its reference list is an
 * appendix with a sub-heading and a note in prose, and another appendix follows it.
 */
function mixed() {
  return new Document({
    creator: 'samepage fixtures',
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.TITLE,
            children: [new TextRun('Çok dilli kaynaklarda şiir ve toplum')],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Öz')] }),
          p(
            'Bu çalışmada şiirin toplumsal işlevi, farklı dillerde yazılmış kaynaklar üzerinden incelenmiştir.',
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Abstract')] }),
          p(
            'This study examines the social function of poetry through sources that were written in different languages.',
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. Giriş')] }),
          new Paragraph({
            children: [
              new TextRun('Şiir, '),
              new TextRun({ text: 'toplumsal bellek', bold: true }),
              new TextRun(' için '),
              new TextRun({ text: 'temel', italics: true }),
              new TextRun(' bir araç olarak görülmüştür.'),
            ],
          }),
          new Paragraph({
            bidirectional: true,
            children: [
              new TextRun({
                text: 'لم يكن الشعر العربي مجرد لون من ألوان الأدب، بل كان مؤسسة ثقافية واجتماعية متكاملة.',
                rightToLeft: true,
                boldComplexScript: true,
                sizeComplexScript: 32,
              }),
            ],
          }),
          p(
            'Die Dichtung war nicht nur eine Form der Literatur, sondern eine kulturelle Institution der Gesellschaft.',
          ),
          new Table({
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: [4500, 4500],
            rows: [
              new TableRow({ children: [cell('Toplantı'), cell('Saat')] }),
              new TableRow({ children: [cell('Açılış oturumu'), cell('30.08., 19:00 UTC')] }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Ek B. Kaynakça ve yerel kaynaklar')],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Yayınlar')] }),
          p(
            'Erişim ve bibliyografik kontrol tarihi 22.09.2026 olup yıllar ilk yayımlanma tarihini gösterir ve aksi belirtilmedikçe bu şekilde kullanılmıştır.',
          ),
          p(
            '[F01] Yao, S. et al. (2023). ReAct: Synergizing Reasoning and Acting in Language Models. ICLR.',
          ),
          p('[F02] Demir, B. (2021). Şiirin toplumsal işlevi. Edebiyat Dergisi, 4(2), 10–25.'),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun('Ek C. Anket soruları')],
          }),
          p(
            'Katılımcılara şiir okuma alışkanlıkları ve tercih ettikleri diller hakkında sorular soruldu.',
          ),
        ],
      },
    ],
  });
}

/** Parts written with a byte-order mark first, as the .NET Open XML SDK writes them. */
async function withByteOrderMarks(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  for (const name of ['word/document.xml', 'word/styles.xml']) {
    const xml = await zip.file(name).async('string');
    zip.file(name, `\uFEFF${xml}`);
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

export async function buildDocxFixtures() {
  return {
    'academic.docx': new Uint8Array(await Packer.toBuffer(academic())),
    'lab.docx': new Uint8Array(await Packer.toBuffer(lab())),
    'mixed.docx': await withByteOrderMarks(new Uint8Array(await Packer.toBuffer(mixed()))),
  };
}
