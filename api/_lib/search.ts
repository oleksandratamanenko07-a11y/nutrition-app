/**
 * Нормалізація пошукового запиту та зіставлення слів.
 * Файл без імпортів — його можна перевіряти окремо (scripts/selftest.mjs).
 */

export const MAX_QUERY_LEN = 60;
export const MAX_TOKENS = 6;

/** Прибирає зайві пробіли (в тому числі нерозривні та в середині), приводить до NFC */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\s ​]+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LEN)
    .trim();
}

/**
 * Згортання для порівняння: нижній регістр, без діакритики (ą→a, ł→l, ó→o …).
 * «МОЛОКО», «Молоко» і «молоко» дають однаковий результат.
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/đ/g, 'd')
    .replace(/ø/g, 'o')
    .replace(/ß/g, 'ss')
    .replace(/ё/g, 'е');
}

/** Слова запиту: без службових символів, без повторів, не більше MAX_TOKENS */
export function tokenize(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of fold(normalizeQuery(raw)).split(/[^\p{L}\p{N}-]+/u)) {
    const tok = part.replace(/^-+|-+$/g, '');
    if (tok === '' || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

/** Слово збігається, якщо воно є в тексті; закінчення відкидаємо («лактозы» ≈ «лактози») */
export function tokenMatches(hay: string, tok: string): boolean {
  if (hay.includes(tok)) return true;
  return tok.length >= 5 && hay.includes(tok.slice(0, -1));
}

/** Скільки слів запиту знайдено у назві/бренді (порядок слів не важливий) */
export function matchCount(text: string, tokens: string[]): number {
  const hay = fold(text);
  return tokens.reduce((n, tok) => n + (tokenMatches(hay, tok) ? 1 : 0), 0);
}

/**
 * Відбирає й впорядковує елементи за кількістю знайдених слів.
 * strict — потрібні всі слова; інакше — хоча б одне.
 */
export function rankByTokens<T>(items: T[], textOf: (x: T) => string, tokens: string[], strict: boolean): T[] {
  const need = strict ? tokens.length : 1;
  return items
    .map((item, i) => ({ item, i, n: matchCount(textOf(item), tokens) }))
    .filter((x) => x.n >= need)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.item);
}
