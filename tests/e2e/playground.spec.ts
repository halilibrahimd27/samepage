import type { Route } from '@playwright/test';
import { expect, test } from './fixtures';

test('pseudo engine translates the Turkish sample and re-uses the cache', async ({ page }) => {
  await page.goto('./#playground');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByRole('button', { name: 'Load Turkish academic sample' }).click();

  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('summary')).toContainText('5 accepted', { timeout: 30_000 });
  await expect(page.getByTestId('segment').first()).toContainText('[');

  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('summary')).toContainText('5 from cache', { timeout: 30_000 });
});

test.describe('Anthropic engine (mocked API)', () => {
  test.use({ allowedOrigins: ['https://api.anthropic.com'] });

  test('sends segments to api.anthropic.com, validates and reports fidelity findings', async ({
    page,
    context,
  }) => {
    const seen: { key: string | null; url: string }[] = [];
    await context.route('https://api.anthropic.com/**', async (route: Route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
      // SDK 1.x sends API keys as `Authorization: Bearer …`.
      seen.push({ key: (await req.allHeaders()).authorization ?? null, url: req.url() });
      const body = req.postDataJSON() as {
        system: { text: string }[];
        messages: { content: string }[];
      };
      const user = body.messages[0]!.content;
      const ids = [...user.matchAll(/<(?:s|pair) id="([^"]+)"/g)].map((m) => m[1]!);
      const payload = body.system[0]!.text.includes('meticulous bilingual reviewer')
        ? {
            findings: ids.includes('s3')
              ? [
                  {
                    id: 's3',
                    severity: 'major',
                    issue: 'hedging "olabileceğine" rendered as certainty',
                  },
                ]
              : [],
          }
        : {
            segments: [...user.matchAll(/<s id="([^"]+)"[^>]*>([\s\S]*?)<\/s>/g)].map((m) => ({
              id: m[1],
              text: m[2]!.replace(/[ğĞ]/g, 'g').replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's'),
              over: false,
            })),
          };
      await route.fulfill({
        status: 200,
        headers: { ...cors(), 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      });
    });

    await page.goto('./#playground');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Show advanced engines (Claude API, local LLM)').check();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: /Claude/ }).check();
    await page.getByLabel('Anthropic API key').fill('sk-ant-TEST-0000000000000000');
    await page.getByRole('button', { name: 'Load Turkish academic sample' }).click();
    await expect(page.getByTestId('estimate')).toContainText('requests');
    await page.getByRole('button', { name: 'Translate', exact: true }).click();

    await expect(page.getByTestId('summary')).toContainText('4 accepted · 1 with warnings', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('issue')).toContainText('MEANING_DRIFT');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(
      seen.every(
        (s) => s.key === 'Bearer sk-ant-TEST-0000000000000000' && !s.url.includes('sk-ant'),
      ),
    ).toBe(true);
    // The key is memory-only unless the user opts in.
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-ant-TEST');
  });
});

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}
