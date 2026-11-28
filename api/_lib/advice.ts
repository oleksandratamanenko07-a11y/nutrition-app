/**
 * Поради до аналітики харчування. Спираються на ВЛАСНІ записи користувача: які продукти дали найбільше
 * калорій/жирів/вуглеводів, що з білкового він уже їсть, у який прийом їжі білка бракує.
 * Нічого не вигадуємо: якщо даних про продукти немає, порада стає загальною й позначена як «приблизно».
 * Файл без імпортів значень — перевіряється окремо (scripts/selftest.mjs).
 */
import type { Review, ReviewEntry, ReviewGoal } from './review.js';

export interface AdviceEntry extends ReviewEntry {
  meal?: string | null;
  name?: string | null;
  sugar_100?: number | string | null;
}

export const MAX_TIPS = 3;

const scaled = (per100: number, grams: number) => (Math.round(per100 * 100) * Math.round(grams * 100)) / 1e6;
const r5 = (n: number) => Math.round(n / 5) * 5;
const r10 = (n: number) => Math.round(n / 10) * 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const key = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const q = (name: string) => `«${name.length > 32 ? `${name.slice(0, 31).trim()}…` : name}»`;

interface Prod {
  name: string;
  days: Set<string>;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  sugar: number;
  /** на 100 г, зважено за грамами */
  protein100: number;
  kcal100: number;
}

function aggregate(entries: AdviceEntry[], days: string[]): Map<string, Prod> {
  const map = new Map<string, Prod>();
  for (const e of entries) {
    if (!days.includes(e.entry_date) || !e.name) continue;
    const g = Number(e.amount_g);
    const k = key(e.name);
    const p =
      map.get(k) ??
      { name: e.name, days: new Set<string>(), grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, protein100: 0, kcal100: 0 };
    p.days.add(e.entry_date);
    p.grams += g;
    p.kcal += scaled(Number(e.kcal_100), g);
    p.protein += scaled(Number(e.protein_100), g);
    p.fat += scaled(Number(e.fat_100), g);
    p.carbs += scaled(Number(e.carbs_100), g);
    if (e.sugar_100 !== null && e.sugar_100 !== undefined) p.sugar += scaled(Number(e.sugar_100), g);
    map.set(k, p);
  }
  for (const p of map.values()) {
    p.protein100 = p.grams > 0 ? (p.protein / p.grams) * 100 : 0;
    p.kcal100 = p.grams > 0 ? (p.kcal / p.grams) * 100 : 0;
  }
  return map;
}

/** Загальні орієнтири, коли власних білкових продуктів у щоденнику немає. Значення приблизні, на 100 г. */
const GENERIC_PROTEIN = [
  { name: 'куряча грудка', protein: 22, kcal: 110 },
  { name: 'нежирний сир (творог)', protein: 18, kcal: 90 },
  { name: 'яйця', protein: 13, kcal: 145 },
  { name: 'тунець у власному соку', protein: 24, kcal: 110 },
];
const GENERIC_SNACKS = [
  { text: 'жменя горіхів (30 г)', kcal: 180 },
  { text: 'банан із грецьким йогуртом', kcal: 200 },
  { text: 'бутерброд із сиром і хлібом', kcal: 250 },
  { text: 'склянка кефіру з вівсянкою (50 г)', kcal: 250 },
];

const dayLabel = (window: string[], date: string): string => {
  const i = window.length - 1 - window.indexOf(date);
  return i === 0 ? 'Вчора' : i === 1 ? 'Позавчора' : `${i + 1} дні тому`;
};

const goalForDay = (goals: ReviewGoal[], date: string): number | null => {
  const sorted = [...goals].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  if (sorted.length === 0) return null;
  let g = sorted[0];
  for (const x of sorted) if (x.effective_from <= date) g = x;
  const v = Number(g.kcal_goal);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * Поради (не більше MAX_TIPS), від найважливішої. `entries` можуть охоплювати довший період за вікно
 * (наприклад, 14 днів): аналіз іде по вікну, а «власні білкові продукти» беруться з усієї історії.
 */
export function buildAdvice(r: Review, entries: AdviceEntry[], window: string[], goals: ReviewGoal[]): string[] {
  const logged = window.filter((d) => entries.some((e) => e.entry_date === d));
  const n = Math.max(1, logged.length);
  const prods = [...aggregate(entries, logged).values()];
  const history = [...aggregate(entries, [...new Set(entries.map((e) => e.entry_date))]).values()];
  const perDay = (x: number) => x / n;

  const goalK = r.goal.kcal!;
  const tips: string[] = [];
  const named = new Set<string>();
  const severeLow = r.status.kcal === 'low' && r.avg.kcal / goalK < 0.7;

  // ---- Калорії забагато ----
  if (r.status.kcal === 'high') {
    const excess = r.avg.kcal - goalK;
    if (r.avg.kcal / goalK > 1.5) {
      tips.push(`Це дуже багато (${Math.round((r.avg.kcal / goalK) * 100)}% норми). Спершу перевірте записи: чи немає помилки в порції (наприклад, 1000 г замість 100 г) або задвоєного запису.`);
    }
    const top = [...prods].sort((a, b) => b.kcal - a.kcal);
    const first = top[0];
    if (first && perDay(first.kcal) >= 0.12 * r.avg.kcal) {
      const kd = perDay(first.kcal);
      const share = Math.round((kd / r.avg.kcal) * 100);
      let action: string;
      if (excess <= kd * 0.6) {
        const cut = clamp(r5((excess / kd) * 100), 5, 60);
        action = `скоротіть ${q(first.name)} приблизно на ${cut}% (з ≈${r5(perDay(first.grams))} до ≈${r5(perDay(first.grams) * (1 - cut / 100))} г на день)`;
      } else if (top[1]) {
        action = `одного продукту мало: скоротіть ${q(first.name)} удвічі та зменште ${q(top[1].name)} (≈${r10(perDay(top[1].kcal))} ккал на день)`;
      } else {
        action = `скоротіть ${q(first.name)} удвічі`;
      }
      named.add(key(first.name));
      tips.push(`Найбільше калорій дає ${q(first.name)}: ≈${r10(kd)} ккал на день (${share}%). Щоб повернутися до норми, треба прибрати ≈${r10(excess)} ккал: ${action}.`);
    } else {
      tips.push(`Калорії набираються з багатьох продуктів, тому найпростіше зменшити порції приблизно на ${clamp(r5((excess / r.avg.kcal) * 100), 5, 30)}% (це ≈${r10(excess)} ккал на день).`);
    }
  }

  // ---- Білків замало ----
  if (r.status.protein === 'low' && !severeLow) {
    const deficit = r.goal.protein! - r.avg.protein;
    const own = history
      .filter((p) => p.protein100 >= 10 && p.kcal100 > 0 && p.kcal100 / p.protein100 <= 12)
      .sort((a, b) => b.days.size - a.days.size || b.protein100 - a.protein100);
    const pick = (cands: { name: string; protein100: number; kcal100: number }[]) => {
      const out: { name: string; g: number; p: number; k: number }[] = [];
      let need = Math.min(deficit, 35);
      for (const c of cands.slice(0, 2)) {
        if (need < 8) break;
        const g = clamp(r5(need / (c.protein100 / 100)), 30, 200);
        const p = (g * c.protein100) / 100;
        out.push({ name: c.name, g, p, k: (g * c.kcal100) / 100 });
        need -= p;
      }
      return out;
    };
    const ownPick = pick(own);
    const generic = ownPick.length === 0;
    const picked = generic
      ? pick(GENERIC_PROTEIN.map((x) => ({ name: x.name, protein100: x.protein, kcal100: x.kcal })))
      : ownPick;
    if (picked.length > 0) {
      named.add(key(picked[0].name));
      const list = picked.map((x) => `${generic ? x.name : q(x.name)} ≈${x.g} г (+${Math.round(x.p)} г білка, +${r5(x.k)} ккал)`).join(' і ');
      const sumK = picked.reduce((s, x) => s + x.k, 0);
      let text: string;
      if (r.status.kcal === 'high') {
        const swap = [...prods].filter((p) => p.protein100 < 10).sort((a, b) => b.kcal - a.kcal)[0];
        text = swap
          ? `Білків замало (≈${Math.round(r.avg.protein)} із ${Math.round(r.goal.protein!)} г), а калорій забагато, тож не додавайте, а замінюйте: частину ${q(swap.name)} на ${list}.`
          : `Білків замало (≈${Math.round(r.avg.protein)} із ${Math.round(r.goal.protein!)} г), а калорій забагато: замініть частину звичної їжі на ${list}, а не додавайте зверху.`;
      } else {
        text = `Щоб добрати ≈${Math.round(Math.min(deficit, 35))} г білка, додайте ${generic ? 'на вибір: ' : 'зі своїх продуктів: '}${list}${generic ? ' (значення приблизні)' : ''}.`;
        if (r.status.kcal === 'ok' && r.avg.kcal + sumK > goalK * 1.1) text += ' Це підніме калорії вище норми, тож уберіть щось менш поживне.';
      }
      // де саме бракує білка
      const meals = new Map<string, { p: number; days: Set<string> }>();
      for (const e of entries) {
        if (!logged.includes(e.entry_date) || !e.meal) continue;
        const m = meals.get(e.meal) ?? { p: 0, days: new Set<string>() };
        m.p += scaled(Number(e.protein_100), Number(e.amount_g));
        m.days.add(e.entry_date);
        meals.set(e.meal, m);
      }
      const b = meals.get('breakfast');
      if (b && b.days.size >= 2 && b.p / b.days.size < 12 && deficit > 10) {
        text += ` Найлегше це зробити на сніданку: зараз у ньому лише ≈${Math.round(b.p / b.days.size)} г білка.`;
      }
      if (r.status.kcal === 'low') text += ` Калорій теж бракує (≈${r10(goalK - r.avg.kcal)} ккал на день), тож ці добавки частково закриють і це.`;
      tips.push(text);
    }
  }

  // ---- Калорії замало ----
  if (r.status.kcal === 'low') {
    const ratio = r.avg.kcal / goalK;
    const lack = goalK - r.avg.kcal;
    const mealsPerDay =
      logged.reduce((s, d) => s + new Set(entries.filter((e) => e.entry_date === d && e.meal).map((e) => e.meal)).size, 0) / n;
    if (ratio < 0.7) {
      tips.push(
        `Це помітно менше за норму (${Math.round(ratio * 100)}%). Спершу перевірте, чи внесено всі прийоми їжі та напої з калоріями. Якщо ви справді їли стільки, не тримайте такий недобір довго: додайте повноцінний прийом їжі.`,
      );
    } else if (mealsPerDay > 0 && mealsPerDay < 2.5) {
      tips.push(`У середньому записано лише ${mealsPerDay.toFixed(1).replace('.', ',')} прийому їжі на день. Якщо їли частіше, внесіть усе, і картина стане точнішою. Бракує ≈${r10(lack)} ккал на день.`);
    } else if (r.status.protein !== 'low' || tips.length === 0) {
      const snack = [...GENERIC_SNACKS].sort((a, b) => Math.abs(a.kcal - lack) - Math.abs(b.kcal - lack))[0];
      tips.push(`Бракує ≈${r10(lack)} ккал на день. Додайте поживний перекус, наприклад ${snack.text} (≈${snack.kcal} ккал, значення приблизне).`);
    }
  }

  // ---- Жири забагато ----
  if (r.status.fat === 'high') {
    const top = [...prods].sort((a, b) => b.fat - a.fat)[0];
    const totalFat = r.avg.fat * n;
    if (top && named.has(key(top.name))) {
      // вже розібрано вище
    } else if (top && top.fat / totalFat >= 0.25) {
      tips.push(
        `Жири: головне джерело ${q(top.name)} (≈${Math.round(perDay(top.fat))} г жиру на день, ${Math.round((top.fat / totalFat) * 100)}%). Щоб знизити жири, зменште його порцію або оберіть менш жирний варіант; перевірте також олію й соуси.`,
      );
    } else if (!(top && named.has(key(top.name)))) {
      tips.push('Жири набираються з багатьох продуктів: зменште олію, соуси та жирні м’ясні й молочні варіанти.');
    }
  }

  // ---- Вуглеводи забагато ----
  if (r.status.carbs === 'high') {
    const totalCarbs = r.avg.carbs * n;
    const sugar = prods.reduce((s, p) => s + p.sugar, 0);
    const top = [...prods].sort((a, b) => b.carbs - a.carbs)[0];
    if (top && named.has(key(top.name)) && sugar < 0.35 * totalCarbs) {
      // вже розібрано вище
    } else if (sugar >= 0.35 * totalCarbs) {
      const src = [...prods].filter((p) => p.sugar > 0).sort((a, b) => b.sugar - a.sugar).slice(0, 2).map((p) => q(p.name)).join(' і ');
      tips.push(`Вуглеводів багато, і ≈${Math.round(perDay(sugar))} г із них цукор. Основні джерела: ${src}. Замініть солодке менш цукровим варіантом.`);
    } else if (top && top.carbs / totalCarbs >= 0.25) {
      tips.push(`Вуглеводи: головне джерело ${q(top.name)} (≈${Math.round(perDay(top.carbs))} г на день, ${Math.round((top.carbs / totalCarbs) * 100)}%). Зменшіть порцію або замініть частину на овочі.`);
    } else if (!(top && named.has(key(top.name)))) {
      tips.push('Вуглеводи набираються з багатьох продуктів: зменшіть порції гарнірів, хліба й солодкого.');
    }
  }

  // ---- Додаткові спостереження ----
  const kcalTotal = r.avg.kcal * n;
  const snackKcal = entries.filter((e) => logged.includes(e.entry_date) && e.meal === 'snack').reduce((s, e) => s + scaled(Number(e.kcal_100), Number(e.amount_g)), 0);
  if (r.status.kcal === 'high' && kcalTotal > 0 && snackKcal / kcalTotal >= 0.3) {
    tips.push(`Перекуси дають ${Math.round((snackKcal / kcalTotal) * 100)}% калорій (≈${r10(snackKcal / n)} ккал на день): саме з них легше всього зрізати зайве.`);
  }

  // Середнє в нормі, але один день різко вибивається
  if (r.status.kcal === 'ok') {
    let worst: { d: string; ratio: number } | null = null;
    for (const d of logged) {
      const gk = goalForDay(goals, d);
      if (!gk) continue;
      const k = entries.filter((e) => e.entry_date === d).reduce((s, e) => s + scaled(Number(e.kcal_100), Number(e.amount_g)), 0);
      const ratio = k / gk;
      if (Math.abs(ratio - 1) > 0.3 && (!worst || Math.abs(ratio - 1) > Math.abs(worst.ratio - 1))) worst = { d, ratio };
    }
    if (worst) {
      const pct = Math.round(worst.ratio * 100);
      tips.push(
        worst.ratio > 1
          ? `${dayLabel(window, worst.d)} калорій було ${pct}% від норми. Середнє виглядає добре, але такі стрибки легше вирівнювати, плануючи вечерю заздалегідь.`
          : `${dayLabel(window, worst.d)} записано лише ${pct}% від норми: або не все внесено, або день був надто «голодним», а це може призвести до переїдання наступного дня.`,
      );
    }
  }

  return tips.slice(0, MAX_TIPS);
}
