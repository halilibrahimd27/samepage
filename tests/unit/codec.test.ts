import { describe, expect, it } from 'vitest';
import { decode, encode, plainText, type InlineRun } from '../../src/core/segment/codec';

type Style = { b?: boolean; i?: boolean; sup?: boolean };
const key = (s: Style) => JSON.stringify(s);
const plain: Style = {};
const bold: Style = { b: true };
const italic: Style = { i: true };

describe('tag/placeholder codec', () => {
  it('uses the dominant style as base and tags the others', () => {
    const runs: InlineRun<Style>[] = [
      { type: 'text', text: 'We use ', style: plain },
      { type: 'text', text: 'Python', style: bold },
      { type: 'text', text: ' for ', style: plain },
      { type: 'text', text: 'parsing', style: italic },
      { type: 'text', text: ' PDFs.', style: plain },
    ];
    const enc = encode(runs, key);
    expect(enc.source).toBe('We use <t1>Python</t1> for <t2>parsing</t2> PDFs.');
    expect(enc.baseStyle).toBe(plain);
    expect(enc.tags.map((t) => t.style)).toEqual([bold, italic]);
  });

  it('round-trips every placeholder kind, URLs, DOIs, e-mails and markup-like literals', () => {
    const runs: InlineRun<Style>[] = [
      {
        type: 'text',
        text: 'Bkz. https://example.org/a?b=1, doi 10.1000/xyz123 ve ali@uni.edu.tr; ',
        style: plain,
      },
      { type: 'atom', kind: 'F', text: 'x^2', ref: 'm1' },
      { type: 'atom', kind: 'N', text: '1' },
      { type: 'atom', kind: 'C', text: 'npm ci' },
      { type: 'atom', kind: 'I', text: '' },
      { type: 'atom', kind: 'T', text: '\t' },
      { type: 'atom', kind: 'B', text: '\n' },
      { type: 'atom', kind: 'R', text: 'Şekil 3' },
      { type: 'text', text: ' literal <t9> and ⟦X⟧ stay text', style: plain },
    ];
    const enc = encode(runs, key);
    expect(enc.source).toBe(
      'Bkz. ⟦U1⟧, doi ⟦U2⟧ ve ⟦U3⟧; ⟦F1⟧⟦N1⟧⟦C1⟧⟦I1⟧⟦T1⟧⟦B1⟧⟦R1⟧ literal ⟦L1⟧ and ⟦L2⟧X⟦L3⟧ stay text',
    );
    const decoded = decode(enc.source, enc);
    const text = decoded
      .map((r) => (r.type === 'text' ? r.text : `{${r.placeholder!.kind}}`))
      .join('');
    expect(text).toBe(
      'Bkz. https://example.org/a?b=1, doi 10.1000/xyz123 ve ali@uni.edu.tr; {F}{N}{C}{I}{T}{B}{R} literal <t9> and ⟦X⟧ stay text',
    );
    expect(decoded.find((r) => r.placeholder?.kind === 'F')?.placeholder?.ref).toBe('m1');
  });

  it('protects identifiers and slash-joined abbreviations, not ordinary words', () => {
    const enc = encode(
      [
        {
          type: 'text',
          text: 'Per-class (M/B) scores of MalOSS and has_long_str, TP/FP and/or more',
          style: plain,
        },
      ],
      key,
    );
    expect(enc.source).toBe('Per-class (⟦U1⟧) scores of ⟦U2⟧ and ⟦U3⟧, ⟦U4⟧ and/or more');
  });

  it('decodes reordered tags with their styles', () => {
    const enc = encode<Style>(
      [
        { type: 'text', text: 'büyük ', style: plain },
        { type: 'text', text: 'veri', style: bold },
        { type: 'text', text: ' seti kullanıldı', style: plain },
      ],
      key,
    );
    const runs = decode('a large <t1>data</t1> set was used', enc);
    expect(runs).toEqual([
      { type: 'text', text: 'a large ', style: plain },
      { type: 'text', text: 'data', style: bold },
      { type: 'text', text: ' set was used', style: plain },
    ]);
    expect(plainText('a <t1>b</t1> ⟦F1⟧c')).toBe('a b c');
    expect(() => decode('<t1>x', enc)).toThrow(/Unclosed/);
  });
});
