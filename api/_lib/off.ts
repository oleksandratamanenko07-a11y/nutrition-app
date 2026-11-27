// Розбір відповідей Open Food Facts. Жодних вигаданих значень: якщо поля немає — null.

export interface FoodProduct {
  id: string | null;
  barcode: string | null;
  name: string;
  brand: string | null;
  country: string | null;
  image_url: string | null;
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  carbs_100: number | null;
  /** Додатково, на 100 г; null — «не вказано» */
  fiber_100: number | null;
  sugar_100: number | null;
  salt_100: number | null;
  /** Порція (лише для збережених продуктів): вага в грамах і назва */
  portion_g?: number | null;
  portion_name?: string | null;
  source: 'saved' | 'openfoodfacts' | 'usda';
  /** Для збережених продуктів: звідки вони з’явилися (manual / openfoodfacts / usda / recipe) */
  origin?: string | null;
  /** Калорії розраховано з кДж, бо в базі вказано лише енергію в кДж. */
  kcal_from_kj: boolean;
  /** Значення виглядають неправдоподібними — користувачу варто перевірити з упаковкою. */
  suspicious: boolean;
}

export const OFF_FIELDS =
  'code,product_name,product_name_uk,product_name_pl,product_name_en,generic_name,brands,countries,image_front_small_url,image_front_url,nutriments';

export const OFF_USER_AGENT = 'NutritionTracker/1.0 (Telegram Mini App)';

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function firstText(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** Додаткові показники на 100 г. Сіль, якщо її немає, — з натрію (сіль = натрій × 2,5). */
export function parseExtrasOff(n: Record<string, unknown>): { fiber_100: number | null; sugar_100: number | null; salt_100: number | null } {
  const cap = (v: number | null) => (v !== null && v <= 100 ? v : null);
  let salt = numOrNull(n['salt_100g']);
  if (salt === null) {
    const sodium = numOrNull(n['sodium_100g']);
    if (sodium !== null) salt = Math.round(sodium * 2.5 * 100) / 100;
  }
  return { fiber_100: cap(numOrNull(n['fiber_100g'])), sugar_100: cap(numOrNull(n['sugars_100g'])), salt_100: cap(salt) };
}

export function flagSuspicious(p: {
  kcal_100: number | null;
  protein_100: number | null;
  fat_100: number | null;
  carbs_100: number | null;
}): boolean {
  const { kcal_100: k, protein_100: pr, fat_100: f, carbs_100: c } = p;
  if (k !== null && k > 900) return true;
  for (const m of [pr, f, c]) if (m !== null && m > 100) return true;
  if (pr !== null && f !== null && c !== null && pr + f + c > 105) return true;
  return false;
}

/** Перетворює продукт Open Food Facts у наш формат. Повертає null, якщо назви немає. */
export function parseOffProduct(raw: unknown, fallbackCode: string | null = null): FoodProduct | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  const name = firstText(
    p.product_name_uk, p.product_name_pl, p.product_name, p.product_name_en, p.generic_name,
  );
  if (!name) return null;

  const n = (p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}) as Record<string, unknown>;

  let kcal = numOrNull(n['energy-kcal_100g']);
  let fromKj = false;
  if (kcal === null) {
    const kj = numOrNull(n['energy-kj_100g']) ?? numOrNull(n['energy_100g']);
    if (kj !== null) {
      kcal = Math.round((kj / 4.184) * 10) / 10;
      fromKj = true;
    }
  }

  const protein = numOrNull(n['proteins_100g']);
  const fat = numOrNull(n['fat_100g']);
  const carbs = numOrNull(n['carbohydrates_100g']);

  const code = firstText(p.code, fallbackCode);
  const brand = firstText(typeof p.brands === 'string' ? p.brands.split(',')[0] : null);
  const country = firstText(typeof p.countries === 'string' ? p.countries.slice(0, 80) : null);
  const image = firstText(p.image_front_small_url, p.image_front_url);

  const values = { kcal_100: kcal, protein_100: protein, fat_100: fat, carbs_100: carbs };
  return {
    id: null,
    barcode: code && /^\d{8,14}$/.test(code) ? code : null,
    name: name.slice(0, 120),
    brand: brand ? brand.slice(0, 80) : null,
    country,
    image_url: image && /^https:\/\//.test(image) ? image : null,
    ...values,
    ...parseExtrasOff(n),
    source: 'openfoodfacts',
    kcal_from_kj: fromKj,
    suspicious: flagSuspicious(values),
  };
}
