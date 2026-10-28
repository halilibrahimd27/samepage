import { languageName } from './languages';

/**
 * The statement journals ask for when machine translation was used (P9.2), in the wording of
 * the common publisher template (Elsevier's "Declaration of generative AI and AI-assisted
 * technologies"): which tool, for what, and that the authors reviewed the result and take
 * responsibility. Written in the manuscript's language: the target, when it is English or
 * Turkish, otherwise English.
 */

const SITE = 'https://halilibrahimd27.github.io/samepage/';

/** Engines as a journal statement names them. */
const ENGINE_NAMES: Record<string, { en: string; tr: string }> = {
  browser: { en: 'Google Translate', tr: 'Google Çeviri' },
  'chrome-builtin': {
    en: 'the translator built into Google Chrome',
    tr: 'Google Chrome’un yerleşik çevirmeni',
  },
  anthropic: { en: 'Claude (Anthropic)', tr: 'Claude (Anthropic)' },
  'openai-compatible': {
    en: 'a language model run locally',
    tr: 'yerel olarak çalıştırılan bir dil modeli',
  },
  pseudo: { en: 'a test engine', tr: 'bir test motoru' },
};

/**
 * A Turkish language name with the ablative or dative ending ("Türkçe" → "Türkçeden",
 * "Almanca" → "Almancaya"). The names end in a vowel; another ending takes "dili".
 */
function trCase(name: string, kind: 'from' | 'to'): string {
  const last = /[aeıioöuü](?=[^aeıioöuü]*$)/iu.exec(name)?.[0]?.toLowerCase();
  if (!/[aeıioöuü]$/iu.test(name) || !last)
    return `${name} ${kind === 'from' ? 'dilinden' : 'diline'}`;
  const back = 'aıou'.includes(last);
  return name + (kind === 'from' ? (back ? 'dan' : 'den') : back ? 'ya' : 'ye');
}

export interface Disclosure {
  lang: 'en' | 'tr';
  text: string;
}

export function aiDisclosure(engine: string, pair: { source: string; target: string }): Disclosure {
  const lang = pair.target === 'tr' ? 'tr' : 'en';
  const tool = ENGINE_NAMES[engine] ?? { en: engine, tr: engine };
  if (lang === 'tr') {
    const from = trCase(languageName(pair.source, 'tr'), 'from');
    const to = trCase(languageName(pair.target, 'tr'), 'to');
    return {
      lang,
      text:
        `Bu çalışmanın hazırlanması sırasında yazarlar, makaleyi ${from} ${to} çevirmek için ` +
        `samepage (${SITE}) aracını kullanmıştır (çeviri motoru: ${tool.tr}). Yazarlar bu aracı ` +
        'kullandıktan sonra içeriği gerektiği gibi gözden geçirip düzenlemiştir ve yayının ' +
        'içeriğinin tüm sorumluluğunu üstlenmektedir.',
    };
  }
  const from = languageName(pair.source, 'en');
  const to = languageName(pair.target, 'en');
  return {
    lang,
    text:
      `During the preparation of this work the authors used samepage (${SITE}) with ${tool.en} ` +
      `to translate the manuscript from ${from} into ${to}. After using this tool, the authors ` +
      'reviewed and edited the content as needed and take full responsibility for the content ' +
      'of the publication.',
  };
}
