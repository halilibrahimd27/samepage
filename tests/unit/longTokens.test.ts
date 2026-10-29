import { describe, expect, it } from 'vitest';
import { breakLongTokens } from '../../src/docx/paragraphs';

const ZWSP = '​';

describe('long tokens in fixed-width cells (D4_LONG_TOKEN)', () => {
  it('breaks a long path after its separators', () => {
    const { text, changed } = breakLongTokens('see src/very_long/module-name/file.ts here');
    expect(changed).toBe(true);
    expect(text).toContain(`src/${ZWSP}very_${ZWSP}long/`);
  });

  it('never puts a hidden character inside a link, an e-mail address or a DOI', () => {
    for (const address of [
      'https://example.org/articles/2024/very-long-path/index.html',
      '(www.example.org/very/long/path/to/a/page.html)',
      'doi:10.1145/3627106.3627138.extra',
      '10.1145/3627106.3627138-supplementary',
      'first.second.author@university-of-example.edu',
    ]) {
      const { text, changed } = breakLongTokens(`Link: ${address}`);
      expect(text).not.toContain(ZWSP);
      expect(changed).toBe(false);
    }
  });
});
