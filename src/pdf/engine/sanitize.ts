import type { MupdfModule } from './mupdf';

type PDFDoc = NonNullable<ReturnType<InstanceType<MupdfModule['Document']>['asPDF']>>;
type PDFObj = ReturnType<PDFDoc['getTrailer']>;

const DANGEROUS = new Set([
  'JavaScript',
  'Launch',
  'ImportData',
  'SubmitForm',
  'Rendition',
  'GoToE',
]);

function actionType(action: PDFObj): string {
  const a = action.resolve();
  if (!a.isDictionary()) return '';
  const s = a.get('S');
  return s.isNull() ? '' : s.asName();
}

/**
 * Output sanitisation (SECURITY.md §6, P6.4): removes document JavaScript, launch-type actions
 * and additional-actions dictionaries from the translated PDF. Returns what was removed.
 */
export function sanitizePdf(doc: PDFDoc): string[] {
  const removed: string[] = [];
  const root = doc.getTrailer().get('Root').resolve();
  if (root.isDictionary()) {
    const open = root.get('OpenAction');
    if (!open.isNull() && DANGEROUS.has(actionType(open))) {
      root.delete('OpenAction');
      removed.push(`document open action (${actionType(open) || 'action'})`);
    }
    if (!root.get('AA').isNull()) {
      root.delete('AA');
      removed.push('document additional actions');
    }
    const names = root.get('Names').resolve();
    if (names.isDictionary() && !names.get('JavaScript').isNull()) {
      names.delete('JavaScript');
      removed.push('document-level JavaScript');
    }
  }
  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    const pageObj = doc.findPage(i);
    if (!pageObj.get('AA').isNull()) {
      pageObj.delete('AA');
      removed.push(`page ${i + 1} additional actions`);
    }
    const annots = pageObj.get('Annots').resolve();
    if (!annots.isArray()) continue;
    for (let k = 0; k < annots.length; k++) {
      const annot = annots.get(k).resolve();
      if (!annot.isDictionary()) continue;
      const a = annot.get('A');
      if (!a.isNull() && DANGEROUS.has(actionType(a))) {
        annot.delete('A');
        removed.push(`page ${i + 1} annotation action (${actionType(a)})`);
      }
      if (!annot.get('AA').isNull()) {
        annot.delete('AA');
        removed.push(`page ${i + 1} annotation additional actions`);
      }
    }
  }
  return removed;
}
