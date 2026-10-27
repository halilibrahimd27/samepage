import { describe, expect, it } from 'vitest';
import { equationLike, mathFragments } from '../../src/pdf/analyze/analyze';

describe('mathFragments', () => {
  it('recognises formula pieces set in a text font, not words or labels', () => {
    // Sub-figure marks ("a) b)") stay as they are too.
    for (const t of [
      'O m m',
      'T T',
      'j j j',
      '(W',
      'n z Max w x wx Min wx w x',
      'm j mj j',
      'a) b)',
      'τ exp',
      '�exp',
      'max|',
      '|Opm|',
    ])
      expect(mathFragments(t), t).toBe(true);
    for (const t of ['Да Нет', 'Table 1', 'Fig. 3', 'The', '1.2', 'et al.', 'Results'])
      expect(mathFragments(t), t).toBe(false);
  });

  it('recognises short equations, not sentences with a relation sign', () => {
    for (const t of ['Prev = 3.940⋅Fn', '; Φ = cos−1R −Prev R', 'HT = 1,75⋅250 3,809', 'P='])
      expect(equationLike(t), t).toBe(true);
    for (const t of ['p = 0.05 was considered significant', 'Total = 100 students', 'Results'])
      expect(equationLike(t), t).toBe(false);
  });
});
