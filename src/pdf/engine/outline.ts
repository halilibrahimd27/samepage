import type { MupdfModule } from './mupdf';
import { loadMupdf } from './mupdf';

type PDFDoc = NonNullable<ReturnType<InstanceType<MupdfModule['Document']>['asPDF']>>;

/** Bookmark titles in depth-first order, plus the document title (P6.3). */
export async function readOutlineAndTitle(
  bytes: Uint8Array,
): Promise<{ outline: string[]; title: string }> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const titles: string[] = [];
    const visit = (items: { title?: string; down?: unknown }[] | null | undefined) => {
      for (const item of items ?? []) {
        titles.push(item.title ?? '');
        visit(item.down as typeof items);
      }
    };
    visit(doc.loadOutline());
    return { outline: titles, title: doc.getMetaData('info:Title') ?? '' };
  } finally {
    doc.destroy();
  }
}

/** Replaces bookmark titles (same depth-first order as readOutlineAndTitle). */
export function applyOutlineTitles(mupdf: MupdfModule, doc: PDFDoc, titles: string[]): void {
  const it = doc.outlineIterator();
  const AT_ITEM = mupdf.OutlineIterator.ITERATOR_AT_ITEM;
  let index = 0;
  const walk = () => {
    for (;;) {
      const item = it.item();
      if (item) {
        const title = titles[index++];
        if (title !== undefined && title !== item.title) it.update({ ...item, title });
        if (it.down() === AT_ITEM) {
          walk();
          it.up();
        } else {
          // down() may have moved to an empty child slot.
          if (!it.item()) it.up();
        }
      }
      if (it.next() !== AT_ITEM) return;
    }
  };
  if (it.item()) walk();
  it.destroy();
}
