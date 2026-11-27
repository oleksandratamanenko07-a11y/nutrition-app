/** Порція продукту (файл без імпортів — перевіряється в scripts/selftest.mjs). */

export interface PortionFields {
  portion_g: number | null;
  portion_name: string | null;
}

/** Перевірка пари «вага + назва»: некоректна або нульова вага → порції немає */
export function cleanPortion(g: unknown, name: unknown): PortionFields {
  const x = typeof g === 'number' ? g : typeof g === 'string' ? Number(g.replace(',', '.')) : NaN;
  if (!Number.isFinite(x) || x <= 0 || x > 5000) return { portion_g: null, portion_name: null };
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 20) : '';
  return { portion_g: Math.round(x * 100) / 100, portion_name: n === '' ? null : n };
}

/**
 * Для запису в базу: якщо клієнт не передав поле portion_g — повертаємо null (нічого не змінювати);
 * якщо передав (навіть null) — це явна зміна, null прибирає порцію.
 */
export function portionPatch(b: Record<string, unknown>): PortionFields | null {
  return 'portion_g' in b ? cleanPortion(b.portion_g, b.portion_name) : null;
}
