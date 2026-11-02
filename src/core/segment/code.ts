/**
 * Telling code from language in a typewriter font, for PDF blocks and Word runs alike.
 */

/**
 * A line opened by a keyword or a command, in lower case: "import hashlib", "pip install numpy",
 * "cd proje", "return total" are code without any of its signs.
 */
const CODE_START =
  /^(?:import|from|def|class|return|print|for|while|elif|else|try|except|finally|with|lambda|yield|async|await|var|let|const|function|public|private|protected|static|void|int|float|double|char|bool|struct|enum|using|namespace|package|select|insert|update|delete|create|drop|alter|cd|ls|mkdir|rm|cp|mv|cat|echo|pip3?|npm|npx|yarn|git|sudo|apt(?:-get)?|brew|python3?|node|java|javac|gcc|make|docker|kubectl|curl|wget|export|source|conda)\s+\S/u;

/**
 * Text in a typewriter font that reads as language, not code: a slide's labels ("TEMEL",
 * "BİLMEN GEREKEN", "1. HAFTA") are set in JetBrains Mono like its code, and stayed untranslated.
 * Code has its signs ({ } = $ < > |), paths and names (a.b, snake_case, camelCase, --flags).
 */
export const monoProse = (text: string): boolean => {
  const t = text.trim();
  if (!/\p{L}{2}/u.test(t)) return false;
  if (/[{}=$<>|`;@[\]]|::|=>|&&|\/\/|^\s*#|--\w|\w\.\w|\w_\w|\p{Ll}\p{Lu}|\w\(/u.test(t))
    return false;
  // Words, with the punctuation of prose.
  const words = t.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
  const signs = t.replace(/[\p{L}\p{M}\p{N}\s.,:;!?'’"“”()\-–—&%·•/+*]/gu, '');
  // One lower-case word is a name ("requests", "colors" in a package table), not a label.
  if (words.length === 1 && /^\p{Ll}/u.test(t)) return false;
  if (CODE_START.test(t)) return false;
  return words.length > 0 && signs.length <= 1;
};

/** A comment of a code listing, after its sign ("# ", "// ", "-- "). */
export const COMMENT = /^\s*(?:#|\/\/|--|%)\s*(.*)$/u;

/**
 * A comment line in words ("# KOTU: kalici erisim anahtari", "// the attacker's code"): language
 * to translate in its own place, the code around it kept as written. A comment of a value
 * ("# Beklenen: 7a4b58bb…", "# v4.1.7") is no sentence.
 */
export const commentInWords = (line: string): boolean => {
  const m = COMMENT.exec(line);
  if (!m || /[{}=$<>|@]/u.test(m[1]!)) return false;
  const tokens = m[1]!.split(/\s+/u).filter(Boolean);
  const words = tokens.filter((w) => /^[\p{L}\p{M}'’-]+[,.:;!?)]?$/u.test(w));
  return words.length >= 2 && words.length >= 0.6 * tokens.length;
};
