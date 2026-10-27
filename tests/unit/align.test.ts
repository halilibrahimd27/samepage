import { describe, expect, it } from 'vitest';
import { reviewRows, wordDiff } from '../../src/core/validate/align';

describe('side-by-side review', () => {
  it('pairs sentences when source, translation and back-translation line up', () => {
    expect(
      reviewRows(
        'The results suggest a link. It was not significant.',
        'Sonuçlar bir bağlantıya işaret ediyor. Anlamlı değildi.',
        'The results point to a link. It was not significant.',
      ),
    ).toEqual([
      {
        source: 'The results suggest a link.',
        target: 'Sonuçlar bir bağlantıya işaret ediyor.',
        back: 'The results point to a link.',
      },
      {
        source: 'It was not significant.',
        target: 'Anlamlı değildi.',
        back: 'It was not significant.',
      },
    ]);
    expect(reviewRows('One. Two.', 'Bir iki.', 'One two.')).toHaveLength(1);
  });

  it('marks the words that differ, numbers apart', () => {
    const d = wordDiff('Most patients (85%) did not respond.', 'All patients (58%) responded.');
    const changed = (tokens: { text: string; changed: boolean }[]) =>
      tokens.filter((t) => t.changed).map((t) => t.text);
    // "respond" / "responded" share their stem; the negation is what changed.
    expect(changed(d.source)).toEqual(['Most', '(85%)', 'did', 'not']);
    expect(changed(d.back)).toEqual(['All', '(58%)']);
    expect(d.back.find((t) => t.text === '(58%)')?.number).toBe(true);
    // Long words share their stem ("analyses" / "analysis").
    expect(changed(wordDiff('The analyses confirm it.', 'The analysis confirms it.').back)).toEqual(
      [],
    );
  });
});
