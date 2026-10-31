import { splitSentences } from '../../engines/plainText';

/**
 * "Suggests" that Google renders as "shows" in Turkish ("Dit suggereert dat …" → "… olduğunu
 * göstermektedir"): the claim reads stronger than the paper makes it. In a sentence whose source
 * suggests and shows nothing, "…dığını göstermektedir" becomes "…dığını düşündürmektedir"; the
 * caller keeps it only when the meaning check then finds the hedge again.
 */
const SUGGESTS: Record<string, string> = {
  en: 'suggest(?:s|ed|ing)?',
  nl: 'suggere\\p{L}*',
  de: 'leg(?:t|en) (?:\\p{L}+ )?nahe|nahe(?:legen|gelegt)',
  fr: 'sugg[èé]r\\p{L}*',
  es: 'sugier\\p{L}*|suger\\p{L}*',
  it: 'sugger\\p{L}*',
  pt: 'suger\\p{L}*|sugir\\p{L}*',
  ru: 'позволя\\p{L}* предположить|предполага\\p{L}*',
};
const SHOWS: Record<string, string> = {
  en: 'show(?:s|ed|n|ing)?|demonstrat\\p{L}*|reveal\\p{L}*|prov(?:e|es|ed|en)',
  nl: 'to(?:o)?n(?:t|en)? aan|aangetoond|laten zien|laat zien|blijkt',
  de: 'zeig\\p{L}*|beleg(?:t|en)|beweis\\p{L}*|nachgewiesen',
  fr: 'montr\\p{L}*|démontr\\p{L}*|prouv\\p{L}*',
  es: 'muestr\\p{L}*|mostr\\p{L}*|demuestr\\p{L}*|demostr\\p{L}*',
  it: 'mostr\\p{L}*|dimostr\\p{L}*',
  pt: 'mostr\\p{L}*|demonstr\\p{L}*',
  ru: 'показ\\p{L}*|демонстрир\\p{L}*|доказ\\p{L}*',
};
const word = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{M}])(?:${alternatives})(?![\\p{L}\\p{M}])`, 'iu');

/** "…olduğunu göstermektedir" (that … shows): a clause, then a finite form of "göstermek". */
const TR_SHOWS =
  /((?:d[ıiuü]ğ[ıiuü]n[ıiuü]|t[ıiuü]ğ[ıiuü]n[ıiuü]|[ae]c[ae]ğ[ıi]n[ıi])(?:\s*\([^)]*\))?\s+)göster(mektedir|iyor|ir|miştir|di|mekte)(ler)?(?![\p{L}\p{M}])/gu;
const TR_SUGGESTS: Record<string, string> = {
  mektedir: 'mektedir',
  iyor: 'üyor',
  ir: 'ür',
  miştir: 'müştür',
  di: 'dü',
  mekte: 'mekte',
};

function soften(source: string, target: string, lang: string): string {
  const suggests = SUGGESTS[lang];
  const shows = SHOWS[lang];
  if (!suggests || !shows || !word(suggests).test(source) || word(shows).test(source))
    return target;
  return target.replace(
    TR_SHOWS,
    (_, clause: string, ending: string, plural = '') =>
      `${clause}düşündür${TR_SUGGESTS[ending]!}${plural}`,
  );
}

/** The translation with "shows" put back to "suggests" where the source suggests. */
export function softenClaims(
  source: string,
  target: string,
  sourceLang: string,
  targetLang: string,
): string {
  if (targetLang !== 'tr' || !SUGGESTS[sourceLang]) return target;
  const src = splitSentences(source);
  const tgt = splitSentences(target);
  // Sentence by sentence when both sides have as many; the whole paragraph otherwise.
  if (src.length < 2 || src.length !== tgt.length) return soften(source, target, sourceLang);
  let out = '';
  let pos = 0;
  tgt.forEach((t, i) => {
    const at = target.indexOf(t, pos);
    out += target.slice(pos, at) + soften(src[i]!, t, sourceLang);
    pos = at + t.length;
  });
  return out + target.slice(pos);
}
