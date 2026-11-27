/** Порції в інтерфейсі: перерахунок «порції ↔ грами» (без імпортів — перевіряється в scripts/selftest.mjs). */

export const DEFAULT_PORTION_NAME = 'порція';

/** Грами за кількістю порцій, з округленням до сотих */
export function gramsFromPortions(count: number, portionG: number): number {
  return Math.round(count * portionG * 100) / 100;
}

/** Скільки порцій у грамах, якщо це ціле або «з половиною» (0,5; 1; 1,5…); інакше null */
export function portionCountFor(grams: number, portionG: number): number | null {
  if (!(portionG > 0) || !(grams > 0)) return null;
  const halves = (grams / portionG) * 2;
  const r = Math.round(halves);
  return r >= 1 && Math.abs(halves - r) < 1e-6 ? r / 2 : null;
}

/** Крок кнопок «−»/«+»: від 1 порції вниз на 1, нижче — до півпорції */
export function stepCount(count: number, dir: 1 | -1): number {
  if (dir === 1) return Math.round((count + 1) * 2) / 2;
  if (count > 1) return Math.max(0.5, Math.round((count - 1) * 2) / 2);
  return 0.5;
}

export function formatCount(n: number): string {
  return String(n).replace('.', ',');
}
