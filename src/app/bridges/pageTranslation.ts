import { plainText, tokenize } from '../../core/segment/codec';

/**
 * Browser page translation (ADR-015): segments are rendered into the page, the user turns on the
 * browser's Translate, and the translated DOM is harvested back into tagged text.
 * Rendering uses DOM APIs only (no innerHTML). Tags become `span[data-t]`, placeholders become
 * `span[data-ph][translate=no]` so the browser leaves them alone.
 */
export function renderTagged(el: HTMLElement, tagged: string): void {
  el.replaceChildren();
  el.dataset.orig = plainText(tagged).replace(/\s+/g, ' ').trim();
  const stack: HTMLElement[] = [el];
  const top = () => stack[stack.length - 1]!;
  for (const tok of tokenize(tagged)) {
    if (tok.type === 'text') top().append(document.createTextNode(tok.text));
    else if (tok.type === 'open') {
      const span = document.createElement('span');
      span.dataset.t = tok.id;
      top().append(span);
      stack.push(span);
    } else if (tok.type === 'close') {
      if (stack.length > 1) stack.pop();
    } else {
      const ph = document.createElement('span');
      ph.dataset.ph = tok.id;
      ph.setAttribute('translate', 'no');
      ph.className = 'notranslate';
      ph.textContent = `⟦${tok.id}⟧`;
      top().append(ph);
    }
  }
}

/**
 * Rebuilds tagged text from a (possibly translated) segment element. Browsers wrap translated
 * text in extra elements (Chrome: <font>) and may split a styled span; only the first
 * occurrence of each tag keeps its markup so the result stays balanced.
 */
export function harvestTagged(el: HTMLElement): string {
  const seen = new Set<string>();
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const e = node as HTMLElement;
    if (e.dataset.ph) return `⟦${e.dataset.ph}⟧`;
    const inner = [...e.childNodes].map(walk).join('');
    const tag = e.dataset.t;
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      return `<${tag}>${inner}</${tag}>`;
    }
    return inner;
  };
  const text = [...el.childNodes].map(walk).join('');
  // Tags whose span disappeared entirely are re-added empty to keep the structure valid.
  const missing = (el.dataset.tags ?? '').split(',').filter((t) => t && !seen.has(t));
  return text.replace(/\s+/g, ' ').trim() + missing.map((t) => `<${t}></${t}>`).join('');
}

/** True once the browser has rewritten the element's text. */
export function looksTranslated(el: HTMLElement): boolean {
  if (el.querySelector('font')) return true; // Chrome / Google Translate wrapper
  const now = (el.textContent ?? '')
    .replace(/⟦[A-Z]\d+⟧/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const orig = (el.dataset.orig ?? '').replace(/\s+/g, ' ').trim();
  return now !== orig;
}

export interface PageTranslationState {
  /** Language the browser reports after translating (html[lang]), if any. */
  htmlLang: string;
  /** Chrome adds translated-ltr / translated-rtl to <html>. */
  chromeTranslated: boolean;
}

export function pageTranslationState(): PageTranslationState {
  const html = document.documentElement;
  return {
    htmlLang: html.lang,
    chromeTranslated:
      html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl'),
  };
}
