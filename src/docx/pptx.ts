import type { Element as XElement } from '@xmldom/xmldom';
import type { Role } from '../core/ir/types';
import type { DocxRepair } from './repair';
import { NS } from './xml';

/**
 * PowerPoint parts (P8.7). Slides, speaker notes, charts and SmartArt hold DrawingML paragraphs
 * (a:p), translated like the text boxes of a Word document. A slide shape has a fixed size, so a
 * longer translation is fitted with PowerPoint's own "shrink text on overflow".
 */

const ancestor = (el: XElement, ns: string, name: string): XElement | null => {
  for (let n = el.parentNode as XElement | null; n; n = n.parentNode as XElement | null) {
    if (n.localName === name && n.namespaceURI === ns) return n;
  }
  return null;
};

/** The role of a slide paragraph from its placeholder type (title, body, footer) or table. */
export function slideRole(para: XElement): Role {
  if (ancestor(para, NS.a, 'tc')) return 'table-cell';
  const shape = ancestor(para, NS.p, 'sp');
  const ph = shape?.getElementsByTagNameNS(NS.p, 'ph')[0];
  const type = ph?.getAttribute('type') ?? '';
  if (type === 'title' || type === 'ctrTitle') return 'heading';
  if (type === 'dt' || type === 'ftr' || type === 'sldNum' || type === 'hdr') return 'footer';
  return 'body';
}

/** The text body (p:txBody) a slide paragraph belongs to, for fitting. */
export const textBodyOf = (para: XElement): XElement | null =>
  para.parentNode && (para.parentNode as XElement).localName === 'txBody'
    ? (para.parentNode as XElement)
    : null;

/** Below this the text is too small to read on a slide; the rest is reported. */
const MIN_FONT_SCALE = 0.55;
/** Translations up to this much longer still fit the slack most text boxes have. */
const SLACK = 1.12;

/**
 * Fits shapes whose text grew: the area text needs grows with its length and with the square of
 * its size, so the font scale is the square root of the length ratio (with the slack the box had).
 * PowerPoint applies a:normAutofit/@fontScale when it draws the slide. Shapes that already grow
 * with their text (a:spAutoFit) and table cells (rows grow) are left alone.
 */
export function fitSlideText(
  part: string,
  bodies: Map<XElement, { source: number; target: number }>,
): DocxRepair[] {
  const repairs: DocxRepair[] = [];
  for (const [body, { source, target }] of bodies) {
    if (!source || target <= source * SLACK) continue;
    if (ancestor(body, NS.a, 'tc')) continue;
    const bodyPr = body.getElementsByTagNameNS(NS.a, 'bodyPr')[0];
    if (!bodyPr || bodyPr.getElementsByTagNameNS(NS.a, 'spAutoFit').length) continue;
    const wanted = Math.sqrt((source * SLACK) / target);
    const existing = bodyPr.getElementsByTagNameNS(NS.a, 'normAutofit')[0];
    const before = Number(existing?.getAttribute('fontScale') ?? 100000) / 100000;
    const scale = Math.max(MIN_FONT_SCALE, Math.min(before, wanted * before));
    for (const tag of ['noAutofit', 'normAutofit']) {
      for (const el of Array.from(bodyPr.getElementsByTagNameNS(NS.a, tag))) bodyPr.removeChild(el);
    }
    const fit = bodyPr.ownerDocument!.createElementNS(NS.a, 'a:normAutofit');
    fit.setAttribute('fontScale', String(Math.round(scale * 100) * 1000));
    // Tighter lines once the type is much smaller (PowerPoint does the same).
    if (scale < 0.8) fit.setAttribute('lnSpcReduction', '10000');
    bodyPr.appendChild(fit);
    repairs.push({
      code: 'P1_SLIDE_FIT',
      part,
      detail: `text scaled to ${Math.round(scale * 100)}% to fit its shape${
        wanted * before < MIN_FONT_SCALE ? ' (minimum reached: the text may still overflow)' : ''
      }`,
    });
  }
  return repairs;
}
