/**
 * Locale-tolerant number comparison. Academic texts do not always follow their language's
 * separator conventions, so each numeric token gets every value it can validly denote
 * ("1,000" → {1000, 1}; "3,5" → {3.5}) and source/target tokens are matched bipartitely.
 */
/** Decimal/thousands separators: dot, comma, space, no-break space, narrow no-break space. */
const SEP = '[.,\\u0020\\u00a0\\u202f]';
const NUMBER_RE = new RegExp(`\\d+(?:${SEP}\\d+)*`, 'g');
const SEP_RE = new RegExp(SEP);
const SEP_RE_G = new RegExp(SEP, 'g');

export function candidateValues(token: string): number[] {
  const values = new Set<number>();
  const groups = token.split(SEP_RE);
  const seps = token.match(SEP_RE_G) ?? [];
  if (seps.length === 0) {
    values.add(Number(token));
    return [...values];
  }
  const thousandsOk = (sepIdxs: number[]) =>
    sepIdxs.every((i) => groups[i + 1]?.length === 3) && (groups[0]?.length ?? 0) <= 3;
  // Interpretation A: the last separator is a decimal point, earlier ones are thousands.
  const last = seps.length - 1;
  const earlier = seps.slice(0, last);
  const lastSep = seps[last]!;
  if (
    (lastSep === '.' || lastSep === ',') &&
    earlier.every((s) => s !== lastSep) &&
    thousandsOk(earlier.map((_, i) => i))
  ) {
    values.add(Number(`${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`));
  }
  // Interpretation B: every separator is a thousands separator (all the same character).
  if (seps.every((s) => s === seps[0]) && thousandsOk(seps.map((_, i) => i))) {
    values.add(Number(groups.join('')));
  }
  if (values.size === 0) {
    // Not a well-formed number (e.g. "1.2.3" section numbers): compare digit groups as-is.
    groups.forEach((g) => values.add(Number(g)));
  }
  return [...values];
}

export function extractNumbers(text: string): string[] {
  return [...text.matchAll(NUMBER_RE)].map((m) => m[0].trim());
}

/** Returns source tokens that have no matching target token, and vice versa. */
export function compareNumbers(
  source: string,
  target: string,
): { missing: string[]; extra: string[] } {
  const src = extractNumbers(source).map((t) => ({ t, v: candidateValues(t) }));
  const tgt = extractNumbers(target).map((t) => ({ t, v: candidateValues(t) }));
  const matchOf = new Array<number>(tgt.length).fill(-1);
  const compatible = (i: number, j: number) => src[i]!.v.some((x) => tgt[j]!.v.includes(x));
  const augment = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < tgt.length; j++) {
      if (seen[j] || !compatible(i, j)) continue;
      seen[j] = true;
      if (matchOf[j] === -1 || augment(matchOf[j]!, seen)) {
        matchOf[j] = i;
        return true;
      }
    }
    return false;
  };
  const missing: string[] = [];
  src.forEach((s, i) => {
    if (!augment(i, new Array<boolean>(tgt.length).fill(false))) missing.push(s.t);
  });
  const extra = tgt.filter((_, j) => matchOf[j] === -1).map((x) => x.t);
  return { missing, extra };
}
