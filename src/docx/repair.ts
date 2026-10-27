import type { Element as XElement } from '@xmldom/xmldom';
import { NS } from './xml';

export type DocxRepairCode =
  'D1_ROW_HEIGHT' | 'D2_TEXTBOX' | 'D3_FRAME' | 'D4_LONG_TOKEN' | 'P1_SLIDE_FIT';

export interface DocxRepair {
  code: DocxRepairCode;
  part: string;
  detail: string;
}

const W = NS.w;
const ancestors = (el: XElement): XElement[] => {
  const out: XElement[] = [];
  for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) out.push(n as XElement);
  return out;
};
const child = (el: XElement, ns: string, local: string): XElement | undefined => {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (
      n.nodeType === 1 &&
      (n as XElement).namespaceURI === ns &&
      (n as XElement).localName === local
    )
      return n as XElement;
  }
  return undefined;
};

/** True when the paragraph sits in a table whose layout is fixed (D4 candidate). */
export function inFixedTableCell(para: XElement): boolean {
  const tbl = ancestors(para).find((a) => a.namespaceURI === W && a.localName === 'tbl');
  if (!tbl) return false;
  const layout = child(child(tbl, W, 'tblPr') ?? tbl, W, 'tblLayout');
  return layout?.getAttributeNS(W, 'type') === 'fixed';
}

/**
 * Structural repair for fixed-size containers whose text was translated (LAYOUT_REPAIR.md §10).
 * Each changed container is reported once.
 */
export function repairContainers(part: string, translated: XElement[]): DocxRepair[] {
  const repairs: DocxRepair[] = [];
  const done = new Set<XElement>();
  const once = (el: XElement, fn: () => DocxRepair | null) => {
    if (done.has(el)) return;
    done.add(el);
    const r = fn();
    if (r) repairs.push(r);
  };

  for (const para of translated) {
    for (const anc of ancestors(para)) {
      // D1: exact row heights clip translated text → keep the height as a minimum.
      if (anc.namespaceURI === W && anc.localName === 'tr') {
        const h = child(child(anc, W, 'trPr') ?? anc, W, 'trHeight');
        if (h?.getAttributeNS(W, 'hRule') === 'exact') {
          once(h, () => {
            h.setAttributeNS(W, 'w:hRule', 'atLeast');
            return {
              code: 'D1_ROW_HEIGHT',
              part,
              detail: `table row height ${h.getAttributeNS(W, 'val')} twips: exact → at least`,
            };
          });
        }
      }
      // D2: DrawingML text box → resize shape to fit text.
      if (anc.namespaceURI === NS.wps && anc.localName === 'wsp') {
        const bodyPr = child(anc, NS.wps, 'bodyPr');
        if (bodyPr && !child(bodyPr, NS.a, 'spAutoFit')) {
          once(bodyPr, () => {
            for (const tag of ['noAutofit', 'normAutofit']) {
              const old = child(bodyPr, NS.a, tag);
              if (old) bodyPr.removeChild(old);
            }
            bodyPr.appendChild(bodyPr.ownerDocument!.createElementNS(NS.a, 'a:spAutoFit'));
            return { code: 'D2_TEXTBOX', part, detail: 'text box set to resize shape to fit text' };
          });
        }
      }
      // D2 (VML fallback): mso-fit-shape-to-text on the shape that owns the v:textbox.
      if (anc.localName === 'textbox' && anc.namespaceURI === 'urn:schemas-microsoft-com:vml') {
        const shape = anc.parentNode as XElement | null;
        if (shape?.nodeType === 1) {
          once(shape, () => {
            const style = shape.getAttribute('style') ?? '';
            if (/mso-fit-shape-to-text\s*:\s*t/.test(style)) return null;
            shape.setAttribute(
              'style',
              `${style}${style && !style.endsWith(';') ? ';' : ''}mso-fit-shape-to-text:t`,
            );
            return { code: 'D2_TEXTBOX', part, detail: 'VML text box set to fit text' };
          });
        }
      }
    }
    // D3: frame paragraphs with an exact height.
    const framePr = child(child(para, W, 'pPr') ?? para, W, 'framePr');
    if (framePr?.getAttributeNS(W, 'hRule') === 'exact') {
      once(framePr, () => {
        framePr.setAttributeNS(W, 'w:hRule', 'atLeast');
        return { code: 'D3_FRAME', part, detail: 'frame height: exact → at least' };
      });
    }
  }
  return repairs;
}
