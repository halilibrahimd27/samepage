// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  harvestTagged,
  looksTranslated,
  renderTagged,
} from '../../src/app/bridges/pageTranslation';

/** Mimics Chrome: every text node becomes <font><font>translated</font></font>. */
function chromeLike(el: HTMLElement, translate: (s: string) => string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    if ((n.parentElement as HTMLElement).closest('[translate="no"]')) continue;
    const outer = document.createElement('font');
    const inner = document.createElement('font');
    inner.textContent = translate(n.textContent ?? '');
    outer.append(inner);
    n.replaceWith(outer);
  }
}

describe('page translation harvest', () => {
  const source = 'Bu çalışmada <t1>yeni</t1> bir yöntem ⟦F1⟧ önerilmiştir [12].';

  it('renders without markup injection and harvests a Chrome-style rewrite', () => {
    const el = document.createElement('p');
    el.dataset.tags = 't1';
    renderTagged(el, source);
    expect(el.querySelector('[data-ph="F1"]')?.getAttribute('translate')).toBe('no');
    expect(looksTranslated(el)).toBe(false);

    const dict: Record<string, string> = {
      'Bu çalışmada ': 'In this study a ',
      yeni: 'new',
      ' bir yöntem ': ' method ',
      ' önerilmiştir [12].': ' is proposed [12].',
    };
    chromeLike(el, (s) => dict[s] ?? s);
    expect(looksTranslated(el)).toBe(true);
    expect(harvestTagged(el)).toBe('In this study a <t1>new</t1> method ⟦F1⟧ is proposed [12].');
  });

  it('keeps tags balanced when the browser splits or drops a styled span', () => {
    const el = document.createElement('p');
    el.dataset.tags = 't1';
    renderTagged(el, source);
    const span = el.querySelector('[data-t="t1"]')!;
    el.append(span.cloneNode(true)); // duplicated span
    expect(harvestTagged(el).match(/<t1>/g)).toHaveLength(1);
    el.querySelectorAll('[data-t]').forEach((s) => s.replaceWith(...s.childNodes));
    expect(harvestTagged(el)).toMatch(/<t1><\/t1>$/);
  });

  it('never interprets document text as HTML', () => {
    const el = document.createElement('p');
    renderTagged(el, '<img src=x onerror=alert(1)> metin');
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});
