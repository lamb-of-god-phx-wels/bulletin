/** Closed word vocabulary shared by the editor and Church Profile persistence. */
export const SPELLING_WORD_PATTERN = /^[\p{L}\p{M}]+(?:['’\u2010-\u2015-][\p{L}\p{M}]+)*$/u;
export const MAX_SPELLING_WORD_CODE_POINTS = 64;
export const MAX_CHURCH_DICTIONARY_WORDS = 4_096;

/** Return the canonical Church Profile representation, or undefined for non-words. */
export function canonicalSpellingWord(value: string): string | undefined {
  const normalized = value.trim().normalize("NFC").toLocaleLowerCase("en-US");
  return normalized.length > 0 &&
    [...normalized].length <= MAX_SPELLING_WORD_CODE_POINTS &&
    SPELLING_WORD_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export function canonicalSpellingDictionary(words: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const value of words) {
    const word = canonicalSpellingWord(value);
    if (word !== undefined) unique.add(word);
  }
  return [...unique]
    .sort((left, right) => left.localeCompare(right, "en-US"))
    .slice(0, MAX_CHURCH_DICTIONARY_WORDS);
}
