/**
 * Russian and Ukrainian set in a font whose Unicode table is the Windows-1251 code page read as
 * Latin-1: the page shows "АНТИКРИЗИСНЫЕ", the text reads "ÀÍÒÈÊÐÈÇÈÑÍÛÅ". Such a font's letters
 * are nearly all in À–ÿ; French, German or Turkish text has a few accented letters among plain
 * ones.
 */
const EXTRA: Record<string, string> = {
  '¨': 'Ё',
  '¸': 'ё',
  '¹': '№',
  ª: 'Є',
  º: 'є',
  '¯': 'Ї',
  '¿': 'ї',
  '²': 'І',
  '³': 'і',
  '¥': 'Ґ',
  '´': 'ґ',
};

const MISREAD = /[À-ÿ]/u;

/** The Cyrillic letter a Windows-1251 character read as Latin-1 stands for. */
export function fromCp1251(c: string): string {
  if (c.length === 1 && MISREAD.test(c)) return String.fromCharCode(0x410 + c.charCodeAt(0) - 0xc0);
  return EXTRA[c] ?? c;
}

/** Whether letters (with "×" and "÷", Ч and ч) read like misread Windows-1251. */
export function misreadCp1251(letters: string[]): boolean {
  const misread = letters.filter((c) => MISREAD.test(c)).length;
  return letters.length >= 20 && misread >= 0.6 * letters.length;
}

/** A text sample with its misread words read as Cyrillic (for language detection). */
export function repairCp1251(text: string): string {
  return text.replace(/\S+/gu, (word) => {
    const letters = [...word].filter((c) => /\p{L}|[×÷]/u.test(c));
    const misread = letters.filter((c) => MISREAD.test(c)).length;
    return misread >= 2 && misread >= 0.7 * letters.length
      ? [...word].map(fromCp1251).join('')
      : word;
  });
}
