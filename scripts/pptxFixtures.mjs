// Synthetic PPTX fixture (P8.7), in Turkish like the other fixtures: a conference talk with a
// title slide, formatted bullets, a table, a chart, speaker notes and a tight text box.
import PptxGenJS from 'pptxgenjs';

function talk() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'samepage fixtures';
  pptx.title = 'Akademik metinlerde anlam kayması';
  pptx.company = 'samepage';

  const title = pptx.addSlide();
  title.addText('Türkçe Akademik Metinlerde Anlam Kayması', {
    x: 0.5,
    y: 1.6,
    w: 9,
    h: 1.2,
    fontSize: 32,
    bold: true,
    align: 'center',
  });
  title.addText('Ayşe Yılmaz, Mehmet Demir · Ankara Üniversitesi', {
    x: 0.5,
    y: 3,
    w: 9,
    h: 0.6,
    fontSize: 18,
    align: 'center',
  });
  title.addNotes('Konuşmaya teşekkür ederek başlayın. Sunum yaklaşık on beş dakika sürecektir.');

  const bullets = pptx.addSlide();
  bullets.addText('Yöntem', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
  bullets.addText(
    [
      { text: 'Derlem: ', options: { bold: true } },
      { text: '412 makale (2019–2023)', options: { breakLine: true } },
      { text: 'Uzmanlar arası uyum ', options: {} },
      { text: 'κ = 0,81', options: { italic: true, breakLine: true } },
      { text: 'Bulgular istatistiksel olarak anlamlıdır (p < 0,01).', options: {} },
    ],
    { x: 0.5, y: 1.3, w: 9, h: 2.5, fontSize: 20, bullet: true },
  );
  bullets.addNotes('Derlemin nasıl oluşturulduğunu kısaca açıklayın.');

  const table = pptx.addSlide();
  table.addText('Sonuçlar', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
  table.addTable(
    [
      [
        { text: 'Tümce uzunluğu', options: { bold: true } },
        { text: 'Terim tutarlılığı', options: { bold: true } },
      ],
      ['Kısa (≤ 20 sözcük)', '%87,4'],
      ['Uzun (> 40 sözcük)', '%71,2'],
    ],
    { x: 0.5, y: 1.3, w: 6, fontSize: 16, border: { type: 'solid', pt: 1, color: '999999' } },
  );

  const chart = pptx.addSlide();
  chart.addText('Tutarlılık ve uzunluk', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 0.8,
    fontSize: 28,
    bold: true,
  });
  chart.addChart(
    pptx.ChartType.bar,
    [
      {
        name: 'Terim tutarlılığı',
        labels: ['Kısa tümceler', 'Uzun tümceler'],
        values: [87.4, 71.2],
      },
    ],
    { x: 0.5, y: 1.3, w: 6, h: 3.5, showTitle: true, title: 'Tümce uzunluğuna göre tutarlılık' },
  );

  // A box sized for the Turkish text: the longer translation has to be fitted.
  const tight = pptx.addSlide();
  tight.addText('Sonuç', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
  tight.addText(
    'Uzun tümcelerde terim tutarlılığı belirgin biçimde azalmaktadır; çeviri sonrası gözden geçirme önerilir.',
    { x: 0.5, y: 1.3, w: 4, h: 1.1, fontSize: 18, fit: 'none' },
  );
  return pptx;
}

export async function buildPptxFixtures() {
  const bytes = await talk().write({ outputType: 'uint8array', compression: true });
  return { 'talk.pptx': new Uint8Array(bytes) };
}
