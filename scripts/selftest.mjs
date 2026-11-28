// Самоперевірка: розрахунки КБЖУ та перевірка підпису Telegram.
// Запуск: node scripts/selftest.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { bmr, computeGoals, portion, sum, round1 } from '../src/lib/calc.ts';
import { verifyInitData } from '../api/_lib/auth.ts';
import { parseOffProduct } from '../api/_lib/off.ts';
import { isValidBarcode } from '../src/lib/barcode.ts';
import { computeAchievements } from '../src/lib/achievements.ts';
import { goalStatus } from '../src/lib/calc.ts';
import { macroBreakdown } from '../src/lib/breakdown.ts';
import { fold, matchCount, normalizeQuery, rankByTokens, tokenize } from '../api/_lib/search.ts';
import { addDays as addD, barGeometry, compare, macroShare, periodOf, periodStats, shiftPeriod, topProducts } from '../src/lib/stats.ts';
import { analyze, goalOn, issues, reviewMessage, reviewWindow, shownPct, zone } from '../api/_lib/review.ts';
import { addDaysStr, confirmReminders, dueByTime, localParts, validTz } from '../api/_lib/reminders.ts';
import { chartGeometry, lastDays, needsRecalc, weightStats } from '../src/lib/weight.ts';
import { aggregateFrequent, cleanTemplateItems, orderedTimestamps, toTemplateItems } from '../api/_lib/quick.ts';
import { descriptionStates, parseUsdaFoods, parseUsdaQuery, stateFit } from '../api/_lib/usda.ts';
import { goalForDate, monthGrid, summarizeMonth } from '../src/lib/history.ts';
import { dishTotals, dishPer100, weightIsPlausible, dishExtrasPer100 } from '../src/lib/recipe.ts';
import { cleanPortion, portionPatch } from '../api/_lib/portion.ts';
import { formatCount, gramsFromPortions, portionCountFor, stepCount } from '../src/lib/portion.ts';
import { addDaysStr as wkAdd, barPx, lastDates, scaleMax, weekAverage } from '../src/lib/week.ts';
import { ringFill, ringPercent } from '../src/lib/ring.ts';
import { CATEGORIES, normCategory } from '../api/_lib/library.ts';
import { cleanExtra, knownExtras, parseExtras } from '../api/_lib/extras.ts';
import { parseExtrasOff } from '../api/_lib/off.ts';
import { cleanItem, fromBase, newInviteCode, normCode, planMerge, toBase } from '../api/_lib/shopping.ts';
import { formatQty, groupHistory, progress, sortItems, timeLeft } from '../src/lib/shoppingCalc.ts';
import { extraPct, extrasBreakdown, extrasTotal, extraZone, referenceFor } from '../src/lib/extras.ts';

// --- Розрахунки ---
assert.equal(bmr('female', 60, 165, 30), 1320.25);
assert.equal(bmr('male', 80, 180, 30), 1780);

const g = computeGoals({ sex: 'female', age: 30, heightCm: 165, weightKg: 60, activity: 'sedentary', goal: 'maintain' });
assert.equal(g.kcal, 1584); // 1320.25 * 1.2 = 1584.3
assert.equal(g.protein, 96);
const kcalFromMacros = g.protein * 4 + g.fat * 9 + g.carbs * 4;
assert.ok(Math.abs(kcalFromMacros - g.kcal) <= 6, `макроси дають ${kcalFromMacros} ккал замість ${g.kcal}`);

const lose = computeGoals({ sex: 'female', age: 50, heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'lose' });
assert.ok(lose.kcal >= 1200, 'нижня межа калорій');

// Порції: 52.5 ккал/100 г × 150 г = 78.75
const p = portion({ kcal: 52.5, protein: 0.3, fat: 0.2, carbs: 14 }, 150);
assert.equal(p.kcal, 78.75);
assert.equal(p.protein, 0.45);
assert.equal(p.carbs, 21);
assert.equal(round1(p.kcal), 78.8);

// Класична пастка float: 0.1 + 0.2 повинно давати рівно 0.3
const s = sum([
  { kcal: 0.1, protein: 0, fat: 0, carbs: 0 },
  { kcal: 0.2, protein: 0, fat: 0, carbs: 0 },
]);
assert.equal(round1(s.kcal), 0.3);

// --- Підпис Telegram ---
const botToken = '123456:TEST-TOKEN';
function sign(fields) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}
const now = Math.floor(Date.now() / 1000);
const user = JSON.stringify({ id: 42, first_name: 'Тест', username: 'tester' });

const good = sign({ auth_date: String(now), query_id: 'AAA', user });
assert.equal(verifyInitData(good, botToken)?.id, 42, 'вірний підпис має проходити');

assert.equal(verifyInitData(good, 'інший:токен'), null, 'інший токен бота має відхилятись');
assert.equal(verifyInitData(good.replace('tester', 'hacker'), botToken), null, 'підроблені дані мають відхилятись');
assert.equal(verifyInitData(good.replace(/hash=[0-9a-f]+/, 'hash=00'), botToken), null, 'неправильний hash');
assert.equal(verifyInitData('auth_date=1&user=%7B%7D', botToken), null, 'без hash');

const old = sign({ auth_date: String(now - 3 * 24 * 3600), user });
assert.equal(verifyInitData(old, botToken), null, 'застарілі дані мають відхилятись');

// --- Ціль по вазі ---
const base = { sex: 'male', age: 35, heightCm: 180, weightKg: 90, activity: 'light', goal: 'lose' };
const tdeeM = bmr('male', 90, 180, 35) * 1.375;
const l1 = computeGoals({ ...base, targetKg: 80 });
assert.equal(l1.kcal, Math.round(tdeeM - 550), 'схуднення: −550 ккал');
assert.ok(Math.abs(l1.weeklyKg + 0.5) < 0.01, 'темп −0,5 кг/тиж.');
assert.equal(l1.weeks, 20, '10 кг / 0,5 = 20 тижнів');
assert.equal(l1.protein, Math.round(80 * 1.8), 'білок від бажаної ваги');
assert.equal(l1.conflict, false);

const l2 = computeGoals({ ...base, targetKg: 89.7 }); // менше 0,5 кг — точність
assert.equal(l2.kcal, Math.round(tdeeM), 'різниця <0,5 кг = підтримання');
assert.equal(l2.weeks, null);

const l3 = computeGoals({ ...base, targetKg: 95 }); // «схуднення», але ціль вище ваги
assert.equal(l3.kcal, Math.round(tdeeM));
assert.equal(l3.conflict, true, 'суперечність мети і ваги');

const l4 = computeGoals({ ...base, goal: 'gain', targetKg: 95 });
assert.equal(l4.kcal, Math.round(tdeeM + 275));
assert.equal(l4.weeks, 20, '5 кг / 0,25 = 20 тижнів');

const l5 = computeGoals({ sex: 'female', age: 50, heightCm: 150, weightKg: 45, targetKg: 40, activity: 'sedentary', goal: 'lose' });
assert.ok(l5.kcal >= 1200, 'нижня межа калорій');

// --- Штрихкоди ---
assert.ok(isValidBarcode('3017620422003'), 'EAN-13 Nutella');
assert.ok(isValidBarcode('5901234123457'), 'EAN-13 приклад GS1');
assert.ok(isValidBarcode('96385074'), 'EAN-8');
assert.ok(isValidBarcode('036000291452'), 'UPC-A');
assert.ok(!isValidBarcode('3017620422004'), 'неправильна контрольна цифра');
assert.ok(!isValidBarcode('12345'), 'неправильна довжина');
assert.ok(!isValidBarcode('30176204220a3'), 'не цифри');

// --- Розбір Open Food Facts: нічого не вигадуємо ---
const full = parseOffProduct({
  code: '5901234123457', product_name: 'Test', product_name_pl: 'Przykład', brands: 'Marka, Inna',
  countries: 'Poland', image_front_small_url: 'https://img.example/x.jpg',
  nutriments: { 'energy-kcal_100g': 250, proteins_100g: '10,5', fat_100g: 5, carbohydrates_100g: 40 },
});
assert.equal(full.name, 'Przykład', 'польська назва має пріоритет над загальною');
assert.equal(full.brand, 'Marka');
assert.equal(full.kcal_100, 250);
assert.equal(full.protein_100, 10.5);
assert.equal(full.suspicious, false);

const partial = parseOffProduct({ code: '5901234123457', product_name: 'Без БЖВ', nutriments: { 'energy-kcal_100g': 100 } });
assert.equal(partial.protein_100, null, 'відсутнє значення залишається null');
assert.equal(partial.fat_100, null);
assert.equal(partial.carbs_100, null);

const kj = parseOffProduct({ product_name: 'КДж', nutriments: { energy_100g: 1000 } });
assert.equal(kj.kcal_100, 239);
assert.equal(kj.kcal_from_kj, true, 'перерахунок із кДж позначається');

const none = parseOffProduct({ product_name: 'Порожній', nutriments: {} });
assert.equal(none.kcal_100, null, 'без даних — null, а не 0');
assert.equal(parseOffProduct({ nutriments: {} }), null, 'без назви продукту немає');
assert.equal(parseOffProduct({ product_name: 'X', image_front_url: 'http://insecure/x.jpg' }).image_url, null, 'лише https');
assert.equal(parseOffProduct({ product_name: 'Bad', nutriments: { 'energy-kcal_100g': 1200 } }).suspicious, true);

// --- Колір цілі: <90 % жовтий, 90–110 % зелений, >110 % червоний ---
assert.equal(goalStatus(1799, 2000), 'low');
assert.equal(goalStatus(1800, 2000), 'ok', 'рівно 90 %');
assert.equal(goalStatus(2200, 2000), 'ok', 'рівно 110 %');
assert.equal(goalStatus(2201, 2000), 'high');
assert.equal(goalStatus(0, 2000), 'low');
assert.equal(goalStatus(5, 0), 'low', 'без цілі — не червоний');

// --- Медалі і серії ---
const A = (days, today) => computeAchievements(days, today);
assert.equal(A([], '2026-11-25').totalDays, 0);
assert.equal(A([], '2026-11-25').next.days, 1);
assert.equal(A(['2026-11-25', '2026-11-25'], '2026-11-25').totalDays, 1, 'день рахується один раз');
const streak = A(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'], '2026-11-25');
assert.equal(streak.currentStreak, 4);
assert.equal(streak.earned.length, 2, 'медалі за 1 і 3 дні');
assert.equal(streak.daysToNext, 3, 'до медалі за 7 днів ще 3');
assert.equal(A(['2026-11-23', '2026-11-24'], '2026-11-25').currentStreak, 2, 'серія жива до кінця сьогодні');
const broken = A(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-24'], '2026-11-25');
assert.equal(broken.currentStreak, 1, 'пропуск дня обриває серію');
assert.equal(broken.bestStreak, 3);
assert.equal(broken.totalDays, 4, 'загальна кількість не зменшується');
assert.equal(A(['2026-11-10'], '2026-11-25').currentStreak, 0);
assert.equal(A(['2026-02-28', '2026-03-01'], '2026-03-01').currentStreak, 2, 'перехід місяця');
const many = Array.from({ length: 100 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
assert.equal(A(many, '2026-04-10').next, null, 'усі медалі отримано');

// --- Страви ---
const bread = { food_id: null, name: 'Хліб', amount_g: 50, kcal_100: 250, protein_100: 8, fat_100: 2, carbs_100: 50 };
const butter = { food_id: null, name: 'Масло', amount_g: 10, kcal_100: 740, protein_100: 0.7, fat_100: 82, carbs_100: 0.6 };
const sausage = { food_id: null, name: 'Ковбаса', amount_g: 30, kcal_100: 300, protein_100: 12, fat_100: 27, carbs_100: 1 };
const sand = dishTotals([bread, butter, sausage]);
assert.equal(sand.weight, 90, 'вага бутерброда');
assert.equal(sand.kcal, 289, '125 + 74 + 90');
assert.equal(Math.round(sand.protein * 100) / 100, 7.67);
assert.equal(Math.round(sand.fat * 100) / 100, 17.3);
assert.equal(Math.round(sand.carbs * 100) / 100, 25.36);
assert.equal(sand.missing.length, 0);
const sp = dishPer100(sand);
assert.equal(sp.kcal, 321.11, 'на 100 г страви');
// Два бутерброди = 180 г: калорії рівно вдвічі більші
const two = (sp.kcal * 180) / 100;
assert.ok(Math.abs(two - 578) < 0.1, 'два бутерброди ≈ 578 ккал');
assert.ok(weightIsPlausible(sand));

// Відсутні дані не стають нулем мовчки
const unknown = dishTotals([bread, { ...butter, fat_100: null }]);
assert.deepEqual(unknown.missing, ['fat'], 'жир не вказано — фіксуємо');
assert.equal(dishPer100(unknown), null, 'неповні дані не перетворюються на значення на 100 г');

// Вага готової страви: вручну
const cooked = dishTotals([bread, butter, sausage], 80);
assert.equal(cooked.weight, 80);
assert.equal(dishPer100(cooked).kcal, 361.25, '289 ккал на 80 г готової страви');
assert.ok(!weightIsPlausible(dishTotals([bread, butter, sausage], 20)), 'БЖВ не можуть важити більше за страву');

// --- Розбивка БЖВ: суми збігаються з головною до останнього знака ---
const E = (id, name, g, k, p, f, c, snap = null) => ({ id, name, meal: 'lunch', amount_g: g, kcal_100: k, protein_100: p, fat_100: f, carbs_100: c, recipe_snapshot: snap });
const dayEntries = [
  E('1', 'Хліб', 50, 250, 9.1, 3.2, 49, null),
  E('2', 'Масло', 10, 740, 0.7, 82, 0.6, null),
  E('3', 'Ковбаса', 33.3, 300, 17.4, 27.1, 1, null),
  E('4', 'Бутерброд', 180, 321.11, 8.52, 19.22, 28.18, [{ name: 'Хліб', amount_g: 50 }]),
  E('5', 'Яйця', 126.5, 155, 9.97, 11.1, 0.7, null),
];
const homeTotals = sum(dayEntries.map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g)));
for (const m of ['protein', 'fat', 'carbs']) {
  const b = macroBreakdown(dayEntries, m);
  assert.equal(b.total, homeTotals[m], `сума по «${m}» збігається з головною`);
  assert.equal(b.rows.length, 5, 'страва — одна позиція, інгредієнти не дублюються');
  assert.ok(b.rows.every((r, i, a) => i === 0 || a[i - 1].value >= r.value), 'сортування за внеском');
}
assert.equal(macroBreakdown(dayEntries, 'protein').rows.find((r) => r.id === '4').isDish, true);
assert.equal(macroBreakdown([], 'fat').total, 0);
// після видалення запису розбивка перераховується з тих самих даних
const afterDelete = dayEntries.filter((e) => e.id !== '5');
const hd = sum(afterDelete.map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g)));
assert.equal(macroBreakdown(afterDelete, 'protein').total, hd.protein);

// --- Календар ---
assert.deepEqual(monthGrid(2026, 10), { lead: 6, days: 30 }, 'листопад 2026 починається в неділю');
assert.deepEqual(monthGrid(2026, 9), { lead: 3, days: 31 }, 'жовтень 2026 — четвер');
assert.deepEqual(monthGrid(2028, 1), { lead: 1, days: 29 }, 'лютий 2028, високосний');
assert.deepEqual(monthGrid(2026, 5), { lead: 0, days: 30 }, 'червень 2026 — понеділок');

const goals = [
  { effective_from: '2026-11-10', kcal_goal: 1800, protein_goal_g: 120, fat_goal_g: 60, carbs_goal_g: 200 },
  { effective_from: '2026-11-20', kcal_goal: 2200, protein_goal_g: 150, fat_goal_g: 70, carbs_goal_g: 250 },
];
assert.equal(goalForDate(goals, '2026-11-05').kcal_goal, 1800, 'до першого запису — найраніша ціль');
assert.equal(goalForDate(goals, '2026-11-10').kcal_goal, 1800);
assert.equal(goalForDate(goals, '2026-11-19').kcal_goal, 1800, 'зміна цілі не зачіпає минулі дні');
assert.equal(goalForDate(goals, '2026-11-20').kcal_goal, 2200);
assert.equal(goalForDate([...goals].reverse(), '2026-11-25').kcal_goal, 2200, 'порядок вхідних даних не важливий');
assert.equal(goalForDate([], '2026-11-25'), null);

// 1 день = одна кількість: 4 записи по 100 г із 500 ккал/100 г
const CE = (id, date, g, k) => ({ id, entry_date: date, meal: 'lunch', name: 'x', amount_g: g, kcal_100: k, protein_100: 10, fat_100: 5, carbs_100: 20, recipe_snapshot: null });
const monthEntries = [
  CE('a', '2026-11-12', 100, 1700),   // 1700 з 1800 = 94 % → ok
  CE('b', '2026-11-13', 100, 1000),   // 1000 з 1800 = 56 % → low
  CE('c', '2026-11-14', 100, 1000), CE('d', '2026-11-14', 100, 1000), // 2000 з 1800 = 111 % → high; один день
  CE('e', '2026-11-18', 100, 1620),   // 90 % рівно → ok (ціль 1800)
  CE('f', '2026-11-19', 100, 1980),   // 110 % рівно → ok
  CE('g', '2026-11-22', 100, 1980),   // ціль 2200 уже діє: 90 % → ok
  CE('h', '2026-11-23', 100, 2500),   // 114 % від 2200 → high
];
const ms = summarizeMonth(monthEntries, goals, goalStatus);
assert.deepEqual(ms.stats, { logged: 7, ok: 4, low: 1, high: 2 }, 'статистика місяця');
assert.equal(ms.days['2026-11-14'].count, 2, 'день, у якому два записи, рахується один раз');
assert.equal(ms.days['2026-11-14'].status, 'high');
assert.equal(ms.days['2026-11-22'].status, 'ok', 'мають діяти нові 2200, а не старі 1800');
assert.equal(ms.days['2026-11-15'], undefined, 'дні без записів у статистику не потрапляють');
assert.equal(ms.stats.logged, ms.stats.ok + ms.stats.low + ms.stats.high);
// сума дня збігається з головною (calc.sum + calc.portion), як і колір
const dayTot = sum(monthEntries.filter((e) => e.entry_date === '2026-11-14').map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g)));
assert.equal(ms.days['2026-11-14'].kcal, dayTot.kcal);
assert.equal(ms.days['2026-11-14'].protein, dayTot.protein);
// без цілі статус не вигадується, але день рахується як «із записами»
const noGoal = summarizeMonth(monthEntries.slice(0, 1), [], goalStatus);
assert.deepEqual(noGoal.stats, { logged: 1, ok: 0, low: 0, high: 0 });
assert.equal(noGoal.days['2026-11-12'].status, null);

// --- Пошук ---
const catalog = [
  'Молоко безлактозне 2,5%', 'Молоко Яготинське 2.6%', 'Безлактозне молоко Лактонія', 'Вершки 10%',
  'Mleko bez laktozy 2%', 'Mleko UHT 3,2%', 'Chleb pełnoziarnisty żytni', 'Chleb pszenny', 'Pełnoziarnisty chleb Putka',
  'Масло сливочное 82%', 'Масло вершкове Селянське', 'Масло соняшникове', 'Cukier', 'Łosoś wędzony', 'Żółty ser',
];
const find = (q, strict = true) => rankByTokens(catalog, (x) => x, tokenize(q), strict);
const same = (a, b) => assert.deepEqual(find(a), find(b), `«${a}» ≡ «${b}»`);

assert.equal(normalizeQuery('  молоко  без   лактозы  '), 'молоко без лактозы');
assert.equal(normalizeQuery('молоко\u00a0без'), 'молоко без', 'нерозривний пробіл');
assert.equal(normalizeQuery('   '), '');
assert.deepEqual(tokenize('   '), [], 'порожній запит — жодних слів');
assert.deepEqual(tokenize('молоко  без  лактозы'), ['молоко', 'без', 'лактозы']);
assert.deepEqual(tokenize('молоко, (2,5%)_'), ['молоко', '2', '5'], 'службові символи LIKE не потрапляють у слова');

assert.ok(find('молоко').length >= 3, 'молоко');
assert.deepEqual(find('молоко без лактозы').sort(), ['Молоко безлактозне 2,5%', 'Безлактозне молоко Лактонія'].sort(), 'молоко без лактозы знаходить безлактозне молоко');
assert.ok(find('молоко лактозы', true).includes('Молоко безлактозне 2,5%'), 'лактозы ≈ лактозне/лактоза (закінчення)');
same('молоко ', 'молоко'); same(' молоко', 'молоко'); same('МОЛОКО', 'молоко'); same('Молоко', 'молоко');
same('молоко  без  лактозы', 'молоко без лактозы');
assert.deepEqual(find('Mleko bez laktozy'), ['Mleko bez laktozy 2%'], 'польський запит');
same('mleko bez laktozy', 'MLEKO BEZ LAKTOZY');
assert.deepEqual(find('chleb pełnoziarnisty').sort(), ['Chleb pełnoziarnisty żytni', 'Pełnoziarnisty chleb Putka'].sort(), 'chleb pełnoziarnisty');
same('pełnoziarnisty chleb', 'chleb pełnoziarnisty');   // інший порядок слів
assert.ok(find('chleb pelnoziarnisty').length === 2, 'без діакритики теж знаходить');
assert.deepEqual(find('масло сливочное'), ['Масло сливочное 82%']);
assert.deepEqual(find('сливочное масло'), ['Масло сливочное 82%'], 'порядок слів');
assert.ok(find('losos wedzony').includes('Łosoś wędzony'), 'ł, ę, ś, ó, ż без діакритики');
assert.equal(fold('ĄĆĘŁŃÓŚŹŻ'), 'acelnoszz', 'усі польські літери');
assert.equal(fold('ąćęłńóśźż'), 'acelnoszz');
assert.equal(matchCount('Молоко 2,5%', tokenize('молоко ящик')), 1, 'часткове співпадіння рахується');
assert.ok(find('молоко ящик', false).length >= 3, 'м’який режим: достатньо одного слова');
assert.deepEqual(find('молоко ящик'), [], 'строгий режим: потрібні всі слова');
// кодування запиту для OFF
assert.equal(encodeURIComponent(tokenize('Mleko  bez laktozy').join(' ')), 'mleko%20bez%20laktozy');
assert.equal(encodeURIComponent(tokenize('chleb pełnoziarnisty').join(' ')), 'chleb%20pelnoziarnisty');

// --- USDA: розбір запиту (переклад лише пошукового запиту) ---
const uq = (q) => parseUsdaQuery(q);
const same2 = (a, b) => assert.deepEqual(uq(a), uq(b), `${a} ≡ ${b}`);
for (const [ru, pl] of [['Яблоко','Jabłko'],['Банан','Banan'],['Огурец','Ogórek'],['Картофель','Ziemniak'],['Куриная грудка','Pierś z kurczaka'],['Гречка','Kasza gryczana'],['Рис варёный','Ryż gotowany']]) {
  assert.ok(uq(ru), `${ru} розпізнано`); same2(ru, pl);
}
assert.deepEqual(uq('Рис варёный').terms, ['rice']); assert.equal(uq('Рис варёный').want, 'boiled');
assert.equal(uq('рис  сырой ').want, 'raw');
assert.equal(uq('рис').want, null);
assert.equal(uq('молоко без лактозы'), null, 'невідоме поєднання слів не вгадуємо');
assert.equal(uq('   '), null);
assert.deepEqual(uq('chicken breast').terms, ['chicken', 'breast'], 'англійський запит іде як є');
assert.equal(stateFit('boiled', ['cooked']), 1); assert.equal(stateFit('boiled', ['raw']), 0); assert.equal(stateFit('raw', ['raw']), 2);
assert.deepEqual(descriptionStates('Rice, white, long-grain, regular, cooked'), ['cooked']);
assert.deepEqual(descriptionStates('Apples, raw, with skin'), ['raw']);

// --- USDA: відповідь (тестові дані у форматі FoodData Central, не довідник) ---
const N = (kcal, p, f, c) => [
  ...(kcal === null ? [] : [{ nutrientId: 1008, nutrientNumber: '208', unitName: 'KCAL', value: kcal }]),
  ...(p === null ? [] : [{ nutrientId: 1003, nutrientNumber: '203', unitName: 'G', value: p }]),
  ...(f === null ? [] : [{ nutrientId: 1004, nutrientNumber: '204', unitName: 'G', value: f }]),
  ...(c === null ? [] : [{ nutrientId: 1005, nutrientNumber: '205', unitName: 'G', value: c }]),
];
const flag = () => false;
const riceJson = { foods: [
  { description: 'Rice, white, long-grain, regular, raw, enriched', foodNutrients: N(100, 7, 1, 80) },
  { description: 'Rice, white, long-grain, regular, cooked', foodNutrients: N(130, 2.7, 0.3, 28) },
  { description: 'Babyfood, rice cereal', foodNutrients: N(300, 5, 1, 70) },
  { description: 'Rice, brown, cooked', foodNutrients: [{ nutrientId: 1003, nutrientNumber: '203', unitName: 'G', value: 2.5 }] },
] };
const rice = parseUsdaFoods(riceJson, uq('Рис варёный'), flag);
assert.ok(rice.length > 0 && rice.every((r) => /cooked/.test(r.brand)), 'варений рис: лише cooked, без raw і babyfood');
assert.ok(!rice.some((r) => /Babyfood/i.test(r.brand)));
assert.ok(rice.every((r) => r.source === 'usda' && r.barcode === null && r.id === null));
const white = rice.find((r) => /white/.test(r.brand));
assert.deepEqual([white.kcal_100, white.protein_100, white.fat_100, white.carbs_100], [130, 2.7, 0.3, 28], 'значення беруться з USDA без змін');
assert.match(white.name, /^Рис \(/); assert.match(white.name, /приготовлене|варене/);
const brown = rice.find((r) => /brown/.test(r.brand));
assert.equal(brown.kcal_100, null, 'відсутні калорії — null, а не 0');
assert.equal(brown.fat_100, null); assert.equal(brown.carbs_100, null); assert.equal(brown.protein_100, 2.5);
const rawRice = parseUsdaFoods(riceJson, uq('рис сырой'), flag);
assert.ok(rawRice.every((r) => /raw/.test(r.brand)), 'сирий рис не змішується з варений');
const anyRice = parseUsdaFoods(riceJson, uq('рис'), flag);
assert.ok(anyRice.some((r) => /raw/.test(r.brand)) && anyRice.some((r) => /cooked/.test(r.brand)), 'без уточнення — показуємо різні варіанти');
// калорії лише як розрахункові (Atwater) у Foundation
const atw = parseUsdaFoods({ foods: [{ description: 'Apples, raw, with skin', foodNutrients: [{ nutrientId: 2047, nutrientNumber: '957', unitName: 'KCAL', value: 52.3 }, { nutrientId: 1003, unitName: 'G', value: 0.3 }] }] }, uq('Jabłko'), flag);
assert.equal(atw[0].kcal_100, 52.3);
// продукт без жодних значень не показуємо
assert.deepEqual(parseUsdaFoods({ foods: [{ description: 'Apples, raw', foodNutrients: [] }] }, uq('яблуко'), flag), []);
assert.deepEqual(parseUsdaFoods(null, uq('яблуко'), flag), []);
assert.deepEqual(parseUsdaFoods({ foods: [{ description: 'Pears, raw', foodNutrients: N(57, 0.4, 0.1, 15) }] }, uq('яблуко'), flag), [], 'інший продукт не підсовуємо');
// розрахунок порції з USDA збігається з головним розрахунком
assert.equal(portion({ kcal: white.kcal_100, protein: white.protein_100, fat: white.fat_100, carbs: white.carbs_100 }, 150).kcal, 195);

// --- Швидке додавання ---
const R = (food_id, name, date, g, k = 100, extra = {}) => ({ food_id, name, entry_date: date, amount_g: g, kcal_100: k, protein_100: 5, fat_100: 2, carbs_100: 10, created_at: date + 'T10:00:00Z', ...extra });
const hist = [
  R('a', 'Яйце', '2026-11-20', 120), R('a', 'Яйце', '2026-11-21', 150), R('a', 'Яйце', '2026-11-22', 180),   // 3 дні, остання кількість 180
  R('a', 'Яйце', '2026-11-22', 60, 100, { created_at: '2026-11-22T12:00:00Z' }),                                                                          // той самий день вдруге — рахується один раз
  R('b', 'Овсянка', '2026-11-21', 50), R('b', 'Овсянка', '2026-11-22', 60),                                   // 2 дні
  R('c', 'Шоколад', '2026-11-22', 20),                                                                       // 1 день — не «часто»
  R(null, 'Кава', '2026-11-21', 200, 2), R(null, 'кава', '2026-11-22', 250, 2),                              // без food_id: об’єднання за назвою і значеннями
  R('d', 'Салат', '2026-11-20', 300, 50, { recipe_snapshot: [{ name: 'x' }] }), R('d', 'Салат', '2026-11-22', 300, 50, { recipe_snapshot: [{ name: 'x' }] }), // страви — окремий розділ
];
const fr = aggregateFrequent(hist);
assert.deepEqual(fr.map((x) => x.name), ['Яйце', 'Овсянка', 'кава'], 'порядок за кількістю днів; одноразові й страви не входять');
assert.equal(fr[0].days, 3, 'день рахується один раз');
assert.equal(fr[0].last_amount_g, 60, 'остання кількість з найновішого запису (останній створений)');
assert.equal(fr.find((x) => x.name === 'кава').days, 2);
assert.equal(aggregateFrequent(hist, 2).length, 2, 'ліміт');
assert.deepEqual(aggregateFrequent([]), []);
// різні значення на 100 г без food_id — різні продукти
assert.equal(aggregateFrequent([R(null, 'Сік', '2026-11-20', 200, 40), R(null, 'Сік', '2026-11-21', 200, 60)]).length, 0);

const rows = [
  { ...R('a', 'Яйце', '2026-11-22', 120), amount_g: '120.00', kcal_100: '155.00' },
  R(null, 'Хліб', '2026-11-22', 40, 250, { recipe_snapshot: [{ name: 'борошно', amount_g: 40 }] }),
];
const items = toTemplateItems(rows);
assert.equal(items.length, 2);
assert.equal(items[0].amount_g, 120); assert.equal(items[0].kcal_100, 155, 'значення з бази приводяться до чисел');
assert.equal(items[0].recipe_snapshot, null); assert.equal(items[1].recipe_snapshot.length, 1, 'склад страви зберігається');
assert.equal(toTemplateItems(Array.from({ length: 40 }, () => rows[0])).length, 30, 'не більше 30 позицій');
const clean = cleanTemplateItems(items.map((i) => ({ ...i, food_id: i.food_id === 'a' ? '123e4567-e89b-12d3-a456-426614174000' : null })));
assert.equal(clean.length, 2); assert.equal(clean[0].food_id, '123e4567-e89b-12d3-a456-426614174000');
assert.equal(cleanTemplateItems([{ ...items[0], kcal_100: 5000 }]), null, 'пошкоджені значення відхиляються');
assert.equal(cleanTemplateItems([{ ...items[0], amount_g: 0 }]), null);
assert.equal(cleanTemplateItems([{ ...items[0], name: '' }]), null);
assert.equal(cleanTemplateItems([]), null); assert.equal(cleanTemplateItems('x'), null);
assert.equal(cleanTemplateItems([{ ...items[0], food_id: 'not-a-uuid' }])[0].food_id, null, 'некоректний id не потрапляє в базу');
// шаблон не змінює суму: ккал із шаблону = ккал із записів
const tplKcal = sum(items.map((i) => portion({ kcal: i.kcal_100, protein: i.protein_100, fat: i.fat_100, carbs: i.carbs_100 }, i.amount_g))).kcal;
const srcKcal = sum(rows.map((r) => portion({ kcal: Number(r.kcal_100), protein: Number(r.protein_100), fat: Number(r.fat_100), carbs: Number(r.carbs_100) }, Number(r.amount_g)))).kcal;
assert.equal(tplKcal, srcKcal);
const ts = orderedTimestamps(5, 1_700_000_000_000);
assert.equal(new Set(ts).size, 5, 'мітки часу різні'); assert.deepEqual([...ts].sort(), ts, 'і впорядковані — порядок записів зберігається');

// --- Вага ---
const WL = (d, w) => ({ log_date: d, weight_kg: w });
const wl = [WL('2026-11-12', 86), WL('2026-10-01', 90), WL('2026-10-29', 87), WL('2026-10-15', 88.5)]; // навмисно не за порядком
const ws = weightStats(wl, 80);
assert.equal(ws.start, 90); assert.equal(ws.current, 86); assert.equal(ws.change, -4);
assert.equal(ws.remaining, -6); assert.equal(ws.progressPct, 40); assert.equal(ws.reached, false);
assert.ok(Math.abs(ws.weeklyPace - (-0.625)) < 1e-9, 'темп: (86−88.5)/28 дн × 7');
assert.equal(weightStats([WL('2026-11-01', 90)], 80).weeklyPace, null, 'один запис — темпу немає');
assert.equal(weightStats([WL('2026-11-01', 90), WL('2026-11-05', 89)], 80).weeklyPace, null, 'менше тижня — темпу немає');
assert.equal(weightStats([WL('2026-11-01', 90), WL('2026-11-20', 79.5)], 80).reached, true, 'схуднення: ціль досягнуто');
assert.equal(weightStats([WL('2026-11-01', 90), WL('2026-11-20', 80.4)], 80).reached, false);
assert.equal(weightStats([WL('2026-11-01', 60), WL('2026-11-20', 63)], 65).progressPct, 60, 'набір ваги: (63−60)/(65−60)');
assert.equal(weightStats([WL('2026-11-01', 60), WL('2026-11-20', 66)], 65).reached, true);
assert.equal(weightStats([WL('2026-11-01', 90), WL('2026-11-20', 92)], 80).progressPct, 0, 'вага зросла — прогрес не мінусовий');
assert.equal(weightStats([WL('2026-11-01', 90), WL('2026-11-20', 70)], 80).progressPct, 100, 'не більше 100 %');
const keep = weightStats([WL('2026-11-01', 70.2), WL('2026-11-20', 70.4)], 70);
assert.equal(keep.progressPct, null, 'утримання ваги: відсотка прогресу немає'); assert.equal(keep.reached, true);
assert.equal(weightStats([], 80).current, null);
assert.equal(weightStats(wl, null).remaining, null);
assert.equal(needsRecalc(86, 88), true); assert.equal(needsRecalc(86.5, 88), false, 'різниця 1,5 кг — ще рано'); assert.equal(needsRecalc(null, 88), false); assert.equal(needsRecalc(86, null), false);
assert.deepEqual(lastDays(wl, 30).map((l) => l.log_date), ['2026-10-15', '2026-10-29', '2026-11-12'], 'останні 30 днів від останнього запису');
assert.equal(lastDays(wl, null).length, 4);
const ch = chartGeometry(wl, 80, 320, 190, { l: 38, r: 12, t: 12, b: 26 });
assert.equal(ch.points.length, 4); assert.equal(ch.points[0].log.log_date, '2026-10-01');
assert.ok(ch.points[0].x < ch.points[3].x, 'x зростає з датою');
assert.ok(ch.points[0].y < ch.points[3].y, 'більша вага — вище (менший y)');
assert.ok(ch.targetY > ch.points[3].y, 'ціль 80 нижче за поточну вагу');
assert.ok(ch.points.every((p) => p.x >= 38 && p.x <= 308 && p.y >= 12 && p.y <= 164), 'усі точки в межах графіка');
assert.equal(chartGeometry([WL('2026-11-01', 80)], 80, 320, 190, { l: 38, r: 12, t: 12, b: 26 }).points.length, 1, 'один запис не ламає графік');
assert.equal(chartGeometry([], 80, 320, 190, { l: 0, r: 0, t: 0, b: 0 }), null);

// --- Нагадування ---
const at = (iso) => new Date(iso);
const due = (iso, o = {}) => dueByTime({ now: at(iso), tz: 'Europe/Warsaw', diaryOn: true, weightOn: true, lastDiary: null, lastWeight: null, ...o });
assert.deepEqual(localParts(at('2026-11-26T18:30:00Z'), 'Europe/Warsaw'), { date: '2026-11-26', hour: 19, weekday: 4 }, 'зима: UTC+1');
assert.deepEqual(localParts(at('2026-07-05T07:00:00Z'), 'Europe/Warsaw'), { date: '2026-07-05', hour: 9, weekday: 0 }, 'літо: UTC+2, неділя');
assert.deepEqual(localParts(at('2026-11-26T00:30:00Z'), 'America/New_York'), { date: '2026-11-25', hour: 19, weekday: 3 }, 'інша добова дата в Нью-Йорку');
assert.equal(localParts(at('2026-11-26T23:30:00Z'), 'Europe/Warsaw').hour, 0, 'північ — година 0, а не 24');
assert.equal(localParts(at('2026-11-26T23:30:00Z'), 'Europe/Warsaw').date, '2026-11-27');
// щоденник: з 19:00 до 22:59
assert.equal(due('2026-11-26T17:59:00Z'), null, '18:59 — ще рано');
assert.deepEqual(due('2026-11-26T18:00:00Z'), { date: '2026-11-26', diary: true, weight: false, review: false }, '19:00');
assert.equal(due('2026-11-26T21:59:00Z').diary, true, '22:59 — ще у вікні (запас на затримку запуску)');
assert.equal(due('2026-11-26T22:00:00Z'), null, '23:00 — вікно закрито');
assert.equal(due('2026-11-26T18:30:00Z', { lastDiary: '2026-11-26' }), null, 'сьогодні вже надсилали');
assert.equal(due('2026-11-26T18:30:00Z', { lastDiary: '2026-11-25' }).diary, true, 'вчорашнє нагадування не заважає');
assert.equal(due('2026-11-26T18:30:00Z', { diaryOn: false }), null, 'вимкнено в профілі');
// вага: тільки неділя 09:00–12:59
assert.equal(due('2026-11-29T07:59:00Z'), null, 'неділя 08:59');
assert.deepEqual(due('2026-11-29T08:07:00Z'), { date: '2026-11-29', diary: false, weight: true, review: false }, 'неділя 09:07');
assert.equal(due('2026-11-29T11:59:00Z').weight, true); assert.equal(due('2026-11-29T12:00:00Z'), null, 'неділя 13:00');
assert.equal(due('2026-11-28T08:07:00Z'), null, 'субота — немає');
assert.equal(due('2026-11-30T08:07:00Z'), null, 'понеділок — немає');
assert.equal(due('2026-11-29T08:07:00Z', { lastWeight: '2026-11-29' }), null, 'у цю неділю вже надсилали');
assert.equal(due('2026-11-29T08:07:00Z', { weightOn: false }), null);
assert.equal(due('2026-07-05T07:00:00Z').weight, true, 'літній час: 09:00 = 07:00 UTC');
assert.equal(due('2026-07-05T08:00:00Z').weight, true);
assert.equal(due('2026-11-26T18:30:00Z', { tz: null }), null, 'без часового поясу не надсилаємо');
assert.equal(due('2026-11-26T18:30:00Z', { tz: 'Mars/Olympus' }), null, 'невідомий часовий пояс');
assert.equal(validTz('Europe/Warsaw'), true); assert.equal(validTz('x'), false); assert.equal(validTz(5), false); assert.equal(validTz('Not/AZone'), false);
// два користувачі в одну мить, різні пояси
assert.equal(due('2026-11-26T18:30:00Z', { tz: 'Europe/Warsaw' }).diary, true);
assert.equal(due('2026-11-26T18:30:00Z', { tz: 'America/New_York' }), null, 'у Нью-Йорку ще 13:30');
// підтвердження за даними
const D = { date: '2026-11-26', diary: true, weight: false };
const F = { hasEntryToday: false, activeRecently: true, weightRecent: false };
assert.deepEqual(confirmReminders(D, F), ['diary'], 'записів немає — нагадуємо');
assert.deepEqual(confirmReminders(D, { ...F, hasEntryToday: true }), [], 'запис є — мовчимо');
assert.deepEqual(confirmReminders(D, { ...F, activeRecently: false }), [], 'давно не користується — не набридаємо');
const Dw = { date: '2026-11-29', diary: false, weight: true };
assert.deepEqual(confirmReminders(Dw, F), ['weight']);
assert.deepEqual(confirmReminders(Dw, { ...F, weightRecent: true }), [], 'вагу вже вносили — мовчимо');
assert.deepEqual(confirmReminders(Dw, { ...F, activeRecently: false }), ['weight'], 'вагу нагадуємо незалежно від щоденника');
assert.equal(addDaysStr('2026-03-01', -1), '2026-02-28'); assert.equal(addDaysStr('2026-12-31', 1), '2027-01-01'); assert.equal(addDaysStr('2028-02-28', 1), '2028-02-29');

// --- Аналітика харчування за 3 дні ---
const TODAY = '2026-11-26';
const WIN = reviewWindow(TODAY);
assert.deepEqual(WIN, ['2026-11-23', '2026-11-24', '2026-11-25'], 'три повні дні, без сьогоднішнього');
assert.deepEqual(reviewWindow('2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01'], 'перехід через місяць');
const G0 = [{ effective_from: '2026-01-01', kcal_goal: 2100, protein_goal_g: 120, fat_goal_g: 70, carbs_goal_g: 250 }];
// один запис по 100 г, де значення на 100 г = підсумок дня
const DE = (date, kcal, p, f, c) => ({ entry_date: date, amount_g: 100, kcal_100: kcal, protein_100: p, fat_100: f, carbs_100: c });
const day3 = (k, p, f, c) => WIN.map((d) => DE(d, k, p, f, c));
const NB = '\u00a0';

// зони: ті самі, що на головній
assert.equal(zone(89.99, 100), 'low'); assert.equal(zone(90, 100), 'ok'); assert.equal(zone(110, 100), 'ok'); assert.equal(zone(110.01, 100), 'high');
assert.equal(shownPct(89.6, 100, 'low'), 89, 'у «low» не показуємо 90'); assert.equal(shownPct(110.2, 100, 'high'), 111, 'у «high» не показуємо 110');
assert.equal(shownPct(92, 70, 'high'), 131); assert.equal(shownPct(78, 120, 'low'), 65); assert.equal(shownPct(100, 100, 'ok'), 100);

// усе добре
const okR = analyze(day3(2100, 120, 70, 250), G0, WIN);
assert.deepEqual(issues(okR), []);
assert.equal(reviewMessage(okR), `📊 Харчування за 3 дні: усе в нормі. Калорії в середньому 2${NB}100 із 2${NB}100 ккал, білків достатньо, жири й вуглеводи не перевищують норму. Так тримати!`);
// недобір білка + перебір жирів, калорії в нормі
const mixed = analyze(day3(2060, 78, 92, 200), G0, WIN);
assert.deepEqual(issues(mixed).map((x) => x.nutrient), ['protein', 'fat']);
assert.equal(reviewMessage(mixed),
  `📊 Харчування за 3 дні\n• Білки: у середньому 78 г із 120 г (65%) — замало.\n• Жири: у середньому 92 г із 70 г (131%) — забагато.\nКалорії в нормі: 2${NB}060 із 2${NB}100 ккал.`);
// калорії вище норми
const high = analyze(day3(2480, 120, 70, 250), G0, WIN);
assert.equal(reviewMessage(high), `📊 Харчування за 3 дні\n• Калорії: у середньому 2${NB}480 із 2${NB}100 ккал (118%) — більше за норму.`);
// калорії нижче норми, з вуглеводами в перебор
const low = analyze(day3(1500, 120, 70, 300), G0, WIN);
assert.deepEqual(issues(low).map((x) => `${x.nutrient}:${x.status}`), ['kcal:low', 'carbs:high']);
// що НЕ вважаємо зауваженням: багато білка, мало жирів і вуглеводів
assert.deepEqual(issues(analyze(day3(2100, 240, 20, 50), G0, WIN)), []);
// дві дні із записами з трьох
const twoDays = analyze([DE(WIN[0], 2100, 120, 70, 250), DE(WIN[2], 2100, 120, 70, 250)], G0, WIN);
assert.equal(twoDays.days, 2); assert.match(reviewMessage(twoDays), /^📊 Харчування за 3 дні \(записи за 2 з них\)/);
// замало даних
assert.equal(analyze([DE(WIN[1], 2100, 120, 70, 250)], G0, WIN), null, 'один день — не аналізуємо');
assert.equal(analyze([], G0, WIN), null);
// сьогоднішні й давніші записи не враховуються
const extra = [...day3(2100, 120, 70, 250), DE(TODAY, 9000, 900, 900, 900), DE('2026-11-22', 9000, 900, 900, 900)];
assert.equal(analyze(extra, G0, WIN).avg.kcal, 2100, 'тільки три минулі дні');
assert.equal(analyze([DE(TODAY, 2100, 120, 70, 250), DE('2026-11-25', 2100, 120, 70, 250)], G0, WIN), null, 'сьогодні не рахується як день із записами');
// межі 90 і 110 % для калорій
assert.equal(analyze(day3(1890, 120, 70, 250), G0, WIN).status.kcal, 'ok', '90 % рівно');
assert.equal(analyze(day3(1889, 120, 70, 250), G0, WIN).status.kcal, 'low');
assert.equal(analyze(day3(2310, 120, 70, 250), G0, WIN).status.kcal, 'ok', '110 % рівно');
assert.equal(analyze(day3(2311, 120, 70, 250), G0, WIN).status.kcal, 'high');
// середнє по днях із записами, а не сума: порожній день не тягне вниз
assert.equal(analyze([DE(WIN[0], 2000, 100, 60, 200), DE(WIN[1], 2200, 140, 80, 300)], G0, WIN).avg.kcal, 2100);
// норма змінилась посеред періоду: береться та, що діяла в кожен день
const G1 = [
  { effective_from: '2026-01-01', kcal_goal: 1800, protein_goal_g: 100, fat_goal_g: 60, carbs_goal_g: 200 },
  { effective_from: '2026-11-24', kcal_goal: 2400, protein_goal_g: 140, fat_goal_g: 80, carbs_goal_g: 300 },
];
assert.equal(goalOn(G1, '2026-11-23').kcal_goal, 1800); assert.equal(goalOn(G1, '2026-11-24').kcal_goal, 2400);
const shifted = analyze(day3(2200, 120, 70, 250), G1, WIN);
assert.ok(Math.abs(shifted.goal.kcal - 2200) < 1e-9, '(1800+2400+2400)/3'); assert.equal(shifted.status.kcal, 'ok');
// точність: сума дня збігається з calc.portion/sum
const mixedDay = [
  { entry_date: WIN[0], amount_g: 33.33, kcal_100: 123.45, protein_100: 6.7, fat_100: 1.23, carbs_100: 20.1 },
  { entry_date: WIN[0], amount_g: 150, kcal_100: 52, protein_100: 0.3, fat_100: 0.2, carbs_100: 14 },
  { entry_date: WIN[1], amount_g: 80.5, kcal_100: 250, protein_100: 9, fat_100: 3, carbs_100: 45 },
];
const exact = analyze(mixedDay, G0, WIN);
const d0 = sum(mixedDay.slice(0, 2).map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g)));
const d1 = sum(mixedDay.slice(2).map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g)));
assert.ok(Math.abs(exact.avg.kcal - (d0.kcal + d1.kcal) / 2) < 1e-9); assert.ok(Math.abs(exact.avg.protein - (d0.protein + d1.protein) / 2) < 1e-9);
// значення з бази приходять рядками (numeric) — теж працює
assert.equal(analyze(WIN.map((d) => ({ entry_date: d, amount_g: '100.00', kcal_100: '2100.00', protein_100: '120', fat_100: '70', carbs_100: '250' })), G0, WIN).avg.kcal, 2100);
// без норми калорій — не аналізуємо; без норми білка — білок не оцінюємо
assert.equal(analyze(day3(2100, 120, 70, 250), [], WIN), null);
const noProt = analyze(day3(2100, 10, 70, 250), [{ ...G0[0], protein_goal_g: null }], WIN);
assert.equal(noProt.status.protein, null); assert.deepEqual(issues(noProt), []);

// розклад: кожні 3 дні о 9:00
const rv = (iso, o = {}) => dueByTime({ now: new Date(iso), tz: 'Europe/Warsaw', diaryOn: false, weightOn: false, lastDiary: null, lastWeight: null, reviewOn: true, lastReview: null, lastReviewCheck: null, ...o });
assert.equal(rv('2026-11-26T08:07:00Z').review, true, 'четвер 09:07, раніше не надсилали');
assert.equal(rv('2026-11-26T07:59:00Z'), null, '08:59 — рано');
assert.equal(rv('2026-11-26T12:00:00Z'), null, '13:00 — пізно');
assert.equal(rv('2026-11-26T08:07:00Z', { lastReview: '2026-11-23' }).review, true, 'минуло рівно 3 дні');
assert.equal(rv('2026-11-26T08:07:00Z', { lastReview: '2026-11-24' }), null, 'минуло 2 дні');
assert.equal(rv('2026-11-26T08:07:00Z', { lastReview: '2026-11-20' }).review, true);
assert.equal(rv('2026-11-26T08:07:00Z', { lastReviewCheck: '2026-11-26' }), null, 'сьогодні вже перевіряли');
assert.equal(rv('2026-11-26T08:07:00Z', { lastReviewCheck: '2026-11-25' }).review, true);
assert.equal(rv('2026-11-26T08:07:00Z', { reviewOn: false }), null, 'вимкнено в профілі');
assert.equal(rv('2026-11-29T08:07:00Z', { weightOn: true }).weight, true); assert.equal(rv('2026-11-29T08:07:00Z', { weightOn: true }).review, true, 'у неділю обидва можливі');

// --- Статистика: тиждень / місяць ---
const wk = periodOf('week', '2026-11-26');   // четвер
assert.equal(wk.from, '2026-11-23'); assert.equal(wk.to, '2026-11-29'); assert.equal(wk.dates.length, 7);
assert.equal(periodOf('week', '2026-11-29').from, '2026-11-23', 'неділя належить тижню, що почався в понеділок');
assert.equal(periodOf('week', '2026-11-30').from, '2026-11-30', 'понеділок починає новий тиждень');
const wk2 = periodOf('week', '2026-11-30'); assert.equal(wk2.to, '2026-12-06', 'тиждень через межу місяців');
assert.equal(periodOf('month', '2028-02-10').dates.length, 29, 'лютий 2028');
assert.equal(periodOf('month', '2026-11-26').to, '2026-11-30');
assert.equal(shiftPeriod(wk, -1).from, '2026-11-16'); assert.equal(shiftPeriod(wk, 1).from, '2026-11-30');
assert.equal(shiftPeriod(periodOf('month', '2026-01-15'), -1).from, '2025-12-01', 'місяць назад через рік');
assert.equal(shiftPeriod(periodOf('month', '2026-03-31'), -1).to, '2026-02-28');
assert.equal(addD('2026-12-31', 1), '2027-01-01');

const SG = { kcal_goal: 2000, protein_goal_g: 100, fat_goal_g: 60, carbs_goal_g: 250 };
const SD = (date, kcal, p, f, c, goal = SG) => ({ date, count: 1, kcal, protein: p, fat: f, carbs: c, goal, status: zone(kcal, goal.kcal_goal) });
const sdays = Object.fromEntries([
  SD('2026-11-23', 2000, 100, 60, 250), SD('2026-11-24', 1500, 80, 50, 200), SD('2026-11-25', 2600, 120, 90, 300),
  { ...SD('2026-11-26', 300, 20, 10, 30) },   // сьогодні, день триває
].map((d) => [d.date, d]));
const st = periodStats(sdays, wk, '2026-11-26', zone);
assert.equal(st.days, 3, 'сьогодні не входить у середні');
assert.ok(Math.abs(st.avg.kcal - 2033.3333333) < 1e-5, 'середнє за завершені дні із записами');
assert.deepEqual(st.zones, { ok: 1, low: 1, high: 1 });
assert.equal(st.goal.kcal, 2000); assert.equal(st.zone.kcal, 'ok'); assert.equal(st.pct.kcal, 102);
assert.equal(st.zone.protein, 'ok'); assert.equal(st.zone.fat, 'high', 'жири: (60+50+90)/3 = 66,7 г = 111 % від 60'); assert.equal(st.pct.fat, 111);
assert.equal(periodStats(sdays, wk, '2026-11-24', zone).days, 1, 'якщо сьогодні 24-те — лише 23-тє завершене');
assert.equal(periodStats(sdays, wk, '2026-11-23', zone).avg, null, 'нема завершених днів');
assert.equal(periodStats({}, wk, '2026-11-26', zone).days, 0);
// норма змінилась усередині періоду — береться середня з реальних днів
const mixedGoals = { ...sdays, '2026-11-25': SD('2026-11-25', 2600, 120, 90, 300, { ...SG, kcal_goal: 2600 }) };
assert.ok(Math.abs(periodStats(mixedGoals, wk, '2026-11-26', zone).goal.kcal - (2000 + 2000 + 2600) / 3) < 1e-9);
// відсоток узгоджений із зоною
const lowOnly = periodStats({ '2026-11-23': SD('2026-11-23', 1794, 100, 60, 250) }, wk, '2026-11-26', zone); // 89,7 %
assert.equal(lowOnly.zone.kcal, 'low'); assert.equal(lowOnly.pct.kcal, 89, 'у low не показуємо 90');
const highOnly = periodStats({ '2026-11-23': SD('2026-11-23', 2204, 100, 60, 250) }, wk, '2026-11-26', zone); // 110,2 %
assert.equal(highOnly.zone.kcal, 'high'); assert.equal(highOnly.pct.kcal, 111);
// порівняння з минулим періодом
const prevWeek = periodOf('week', '2026-11-18');
const bothDays = { ...sdays, '2026-11-17': SD('2026-11-17', 1800, 90, 55, 220), '2026-11-18': SD('2026-11-18', 1900, 95, 57, 230) };
const prevSt = periodStats(bothDays, prevWeek, '2026-11-26', zone);
const cmp = compare(st, prevSt);
assert.ok(Math.abs(cmp.kcal - (2033.3333333 - 1850)) < 1e-5);
assert.equal(compare(st, periodStats({ '2026-11-17': SD('2026-11-17', 1800, 90, 55, 220) }, prevWeek, '2026-11-26', zone)), null, 'у минулому періоді лише 1 день — не порівнюємо');
// частки енергії дають рівно 100
for (const a of [{ protein: 100, fat: 60, carbs: 250 }, { protein: 1, fat: 1, carbs: 1 }, { protein: 33, fat: 33, carbs: 34 }, { protein: 0, fat: 0, carbs: 10 }]) {
  const sh = macroShare(a); assert.equal(sh.protein + sh.fat + sh.carbs, 100, JSON.stringify(a));
}
assert.deepEqual(macroShare({ protein: 0, fat: 0, carbs: 10 }), { protein: 0, fat: 0, carbs: 100 });
assert.equal(macroShare({ protein: 0, fat: 0, carbs: 0 }), null);
assert.equal(macroShare({ protein: 100, fat: 0, carbs: 0 }).protein, 100);
// найчастіші продукти
const PE = (d, name, g, k, id = null) => ({ entry_date: d, name, food_id: id, amount_g: g, kcal_100: k, protein_100: 1, fat_100: 1, carbs_100: 1 });
const pl = [
  PE('2026-11-23', 'Яйце', 100, 155, 'a'), PE('2026-11-24', 'Яйце', 120, 155, 'a'), PE('2026-11-25', 'Яйце', 60, 155, 'a'),
  PE('2026-11-23', 'Вівсянка', 50, 370), PE('2026-11-24', 'вівсянка', 50, 370),       // без food_id: та сама назва й значення = один продукт
  PE('2026-11-24', 'Піца', 300, 270),
  PE('2026-11-23', 'Яйце', 50, 155, 'a'),                                           // другий раз за день — день рахується один раз
  PE('2026-11-26', 'Шоколад', 100, 540),                                            // сьогодні — не враховуємо
  PE('2026-11-10', 'Минулий місяць', 100, 100),                                     // поза періодом
];
const tp = topProducts(pl, wk, '2026-11-26');
assert.deepEqual(tp.map((x) => x.name), ['Яйце', 'Вівсянка', 'Піца'], 'за кількістю днів, потім за калоріями');
assert.equal(tp[0].days, 3); assert.equal(tp[0].grams, 330); assert.ok(Math.abs(tp[0].kcal - 155 * 3.3) < 1e-9);
assert.equal(tp[1].days, 2);
assert.equal(topProducts(pl, wk, '2026-11-26', 2).length, 2, 'ліміт');
assert.equal(topProducts([PE('2026-11-23', 'Х', 100, 100, null), PE('2026-11-23', 'Х', 100, 101, null)], wk, '2026-11-26').length, 2, 'різні значення на 100 г — різні продукти');
// геометрія стовпчиків
const bg = barGeometry(wk.dates.map((d, i) => ({ date: d, kcal: i === 4 ? null : 1500 + i * 100, goal: 2000, zone: 'ok' })), 320, 200, { l: 36, r: 6, t: 10, b: 24 });
assert.equal(bg.bars.length, 7); assert.equal(bg.bars[4].y, null, 'день без записів — без стовпчика');
assert.ok(bg.bars[5].y < bg.bars[0].y, 'більші калорії — стовпчик вищий');
assert.ok(bg.bars.every((b) => b.x >= 36 && b.x + b.width <= 314), 'у межах графіка');
assert.ok(bg.bars.every((b) => b.goalY === bg.bars[0].goalY), 'риска норми на одній висоті, якщо норма однакова');
assert.ok(bg.max >= 2000, 'шкала включає норму');
assert.equal(barGeometry([], 320, 200, { l: 36, r: 6, t: 10, b: 24 }).bars.length, 0);

// ---------- клітковина, цукор, сіль ----------
assert.equal(cleanExtra(null), null);
assert.equal(cleanExtra(''), null);
assert.equal(cleanExtra('2,5'), 2.5);
assert.equal(cleanExtra(0), 0, 'нуль — це значення, а не «не вказано»');
assert.equal(cleanExtra(101), null);
assert.equal(cleanExtra(-1), null);
assert.equal(cleanExtra('abc'), null);
assert.equal(cleanExtra(1.23456), 1.23);
assert.deepEqual(parseExtras({ fiber_100: '3', sugar_100: null }), { fiber_100: 3, sugar_100: null, salt_100: null });
assert.deepEqual(knownExtras({ fiber_100: 3, sugar_100: null, salt_100: 0 }), { fiber_100: 3, salt_100: 0 });

assert.deepEqual(parseExtrasOff({ fiber_100g: 2, sugars_100g: 5.5, salt_100g: 1.2 }), { fiber_100: 2, sugar_100: 5.5, salt_100: 1.2 });
assert.equal(parseExtrasOff({ sodium_100g: 0.4 }).salt_100, 1, 'сіль = натрій × 2.5');
assert.equal(parseExtrasOff({ salt_100g: 2, sodium_100g: 9 }).salt_100, 2, 'salt_100g важливіший');
assert.deepEqual(parseExtrasOff({}), { fiber_100: null, sugar_100: null, salt_100: null });
assert.equal(parseExtrasOff({ sugars_100g: 150 }).sugar_100, null, 'понад 100 г/100 г — сміття');

const usda = parseUsdaFoods(
  { foods: [{ fdcId: 1, description: 'Apples, raw, with skin', dataType: 'SR Legacy', foodNutrients: [
    { nutrientId: 1008, value: 52 }, { nutrientId: 1003, value: 0.26 }, { nutrientId: 1004, value: 0.17 }, { nutrientId: 1005, value: 13.8 },
    { nutrientId: 1079, value: 2.4 }, { nutrientId: 2000, value: 10.4 }, { nutrientId: 1093, value: 1, unitName: 'MG' } ] }] },
  parseUsdaQuery('apple'),
  () => false,
);
assert.ok(usda.length > 0, "USDA fixture parsed");
if (usda.length > 0) {
  assert.equal(usda[0].fiber_100, 2.4);
  assert.equal(usda[0].sugar_100, 10.4);
  assert.equal(usda[0].salt_100, 0, 'натрій 1 мг → 0.0025 г солі → 0 після округлення');
}

const ee = (id, amount_g, fiber_100, extra = {}) => ({ id, name: id, meal: 'lunch', amount_g, fiber_100, sugar_100: null, salt_100: null, ...extra });
const tot = extrasTotal([ee('a', 200, 3), ee('b', 100, null), ee('c', 50, 10)], 'fiber');
assert.deepEqual(tot, { value: 11, known: 2, missing: 1, count: 3 });
assert.equal(extrasTotal([ee('a', 100, null)], 'sugar').known, 0);
const bd = extrasBreakdown([ee('a', 100, null), ee('b', 100, 1), ee('c', 100, 5)], 'fiber');
assert.deepEqual(bd.rows.map((r) => r.id), ['c', 'b', 'a'], 'відомі за спаданням, невідомі в кінці');

assert.deepEqual(referenceFor('fiber', 2000), { kind: 'min', amount: 25 });
assert.deepEqual(referenceFor('salt', 2000), { kind: 'max', amount: 5 });
assert.equal(referenceFor('sugar', 2000).amount, 50);
assert.equal(referenceFor('sugar', null).amount, 50, 'без цілі — 2000 ккал');
assert.equal(referenceFor('sugar', 1600).amount, 40);

const T = (value, missing, count = 3) => ({ value, known: count - missing, missing, count });
const fiberRef = referenceFor('fiber', 2000);
assert.equal(extraZone(T(25, 0), fiberRef), 'ok');
assert.equal(extraZone(T(22.5, 0), fiberRef), 'ok', '90% — межа зеленої зони');
assert.equal(extraZone(T(22.4, 0), fiberRef), 'low');
assert.equal(extraZone(T(10, 1), fiberRef), null, 'неповні дані й нижче норми — без висновку');
assert.equal(extraZone(T(26, 1), fiberRef), 'ok', 'норма вже досягнута навіть за неповних даних');
assert.equal(extraZone(T(0, 3, 3), fiberRef), null);
const saltRef = referenceFor('salt', 2000);
assert.equal(extraZone(T(5, 0), saltRef), 'ok', 'рівно ліміт — не перевищення');
assert.equal(extraZone(T(5.1, 1), saltRef), 'high', 'ліміт уже перевищено — навіть за неповних даних');
assert.equal(extraZone(T(2, 1), saltRef), null);
assert.equal(extraZone(T(2, 0), saltRef), 'ok');
assert.equal(extraPct(T(12.5, 0), fiberRef), 50);

const ing = (amount_g, f, s, l) => ({ food_id: null, name: 'x', amount_g, kcal_100: 100, protein_100: 1, fat_100: 1, carbs_100: 1, fiber_100: f, sugar_100: s, salt_100: l });
assert.deepEqual(dishExtrasPer100([ing(100, 2, 5, 1), ing(100, 4, 5, 1)], 200), { fiber_100: 3, sugar_100: 5, salt_100: 1 });
assert.equal(dishExtrasPer100([ing(100, 2, null, 1), ing(100, 4, 5, undefined)], 200).fiber_100, 3);
assert.equal(dishExtrasPer100([ing(100, 2, null, 1), ing(100, 4, 5, undefined)], 200).sugar_100, null, 'є інгредієнт без цукру → цукор страви не вказано');
assert.equal(dishExtrasPer100([ing(100, 2, 1, 1), ing(100, 4, 1, 1)], 0).fiber_100, null);
assert.equal(dishExtrasPer100([ing(100, 2, 1, 1), ing(100, 4, 1, 1)], 100).fiber_100, 6, 'вага готової страви менша — на 100 г більше');

const qrow = { name: 'a', amount_g: 100, kcal_100: 1, protein_100: 1, fat_100: 1, carbs_100: 1, fiber_100: '2.5', sugar_100: null, entry_date: '2026-01-01' };
assert.deepEqual(toTemplateItems([qrow]).map((i) => [i.fiber_100, i.sugar_100, i.salt_100])[0], [2.5, null, null]);
assert.equal(cleanTemplateItems([{ ...toTemplateItems([qrow])[0], fiber_100: 500 }])[0].fiber_100, null);

// ---------- категорії страв і розбивка калорій ----------
assert.deepEqual([...CATEGORIES], ['breakfast', 'soup', 'main', 'drink', 'bakery', 'snack', 'dessert']);
assert.equal(normCategory('soup'), 'soup');
assert.equal(normCategory('lunch'), null, 'стара категорія → без категорії');
assert.equal(normCategory('dinner'), null);
assert.equal(normCategory(null), null);
assert.equal(normCategory(undefined), null);
{
  const mk = (id, kcal_100, amount_g) => ({ id, name: id, meal: 'lunch', amount_g, kcal_100, protein_100: 1, fat_100: 1, carbs_100: 1, recipe_snapshot: null });
  const es = [mk('a', 100, 150), mk('b', 400, 100), mk('c', 52, 200)];
  const r = macroBreakdown(es, 'kcal');
  assert.deepEqual(r.rows.map((x) => x.id), ['b', 'a', 'c'], 'від більшого до меншого');
  assert.equal(r.total, 150 + 400 + 104);
  assert.equal(r.total, sum(es.map((e) => portion({ kcal: e.kcal_100, protein: e.protein_100, fat: e.fat_100, carbs: e.carbs_100 }, e.amount_g))).kcal, 'збігається з підсумком головної');
}

// ---------- кільця БЖУ ----------
assert.equal(ringPercent(10, 100, goalStatus(10, 100)), 10);
assert.equal(ringPercent(0, 134, goalStatus(0, 134)), 0);
assert.equal(ringPercent(15.5, 267, goalStatus(15.5, 267)), 6);
assert.equal(ringPercent(89.6, 100, goalStatus(89.6, 100)), 89, 'жовтий не показує 90');
assert.equal(ringPercent(90, 100, goalStatus(90, 100)), 90);
assert.equal(ringPercent(110, 100, goalStatus(110, 100)), 110);
assert.equal(goalStatus(110.4, 100), 'high');
assert.equal(ringPercent(110.4, 100, goalStatus(110.4, 100)), 111, 'колір червоний — відсоток не менше 111');
assert.equal(ringPercent(110.6, 100, goalStatus(110.6, 100)), 111, 'червоний не показує 110');
assert.equal(ringPercent(150, 100, goalStatus(150, 100)), 150);
assert.equal(ringPercent(5, 0, 'low'), null, 'без цілі відсотка немає');
assert.equal(ringFill(50, 100), 0.5);
assert.equal(ringFill(150, 100), 1);
assert.equal(ringFill(5, 0), 0);

// ---------- графік 7 днів ----------
assert.equal(wkAdd('2026-03-01', -1), '2026-02-28');
assert.equal(wkAdd('2026-12-31', 1), '2027-01-01');
assert.deepEqual(lastDates('2026-11-27'), ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
assert.equal(lastDates('2026-03-02').length, 7);
assert.equal(lastDates('2026-03-02')[0], '2026-02-24');
{
  const wd = [{ date: 'a', kcal: 2000, goal: 2000 }, { date: 'b', kcal: null, goal: 2000 }, { date: 'c', kcal: 1000, goal: 2000 }];
  assert.equal(weekAverage(wd), 1500, 'порожній день не рахується нулем');
  assert.equal(weekAverage([{ date: 'x', kcal: null, goal: 1 }]), null);
  assert.ok(scaleMax(wd) >= 2000);
  assert.equal(barPx(null, 2000, 70), 3, 'порожній день — тонка риска');
  assert.equal(barPx(2000, 2000, 70), 70);
  assert.equal(barPx(1, 2000, 70), 3, 'мінімальна висота');
}

// ---------- порції ----------
assert.deepEqual(cleanPortion(50, 'шт.'), { portion_g: 50, portion_name: 'шт.' });
assert.deepEqual(cleanPortion('33,3', '  скибка  '), { portion_g: 33.3, portion_name: 'скибка' });
assert.deepEqual(cleanPortion(50, ''), { portion_g: 50, portion_name: null });
assert.deepEqual(cleanPortion(0, 'шт'), { portion_g: null, portion_name: null }, 'нульова вага — порції немає');
assert.deepEqual(cleanPortion(-5, 'шт'), { portion_g: null, portion_name: null });
assert.deepEqual(cleanPortion(5001, 'шт'), { portion_g: null, portion_name: null });
assert.deepEqual(cleanPortion('abc', 'шт'), { portion_g: null, portion_name: null });
assert.equal(cleanPortion(10, 'x'.repeat(50)).portion_name.length, 20);
assert.equal(portionPatch({ name: 'a' }), null, 'клієнт не передавав порцію — не змінюємо');
assert.deepEqual(portionPatch({ portion_g: null }), { portion_g: null, portion_name: null }, 'явний null прибирає порцію');
assert.deepEqual(portionPatch({ portion_g: 60, portion_name: 'шт.' }), { portion_g: 60, portion_name: 'шт.' });
assert.equal(gramsFromPortions(2, 50), 100);
assert.equal(gramsFromPortions(1.5, 33.3), 49.95);
assert.equal(gramsFromPortions(3, 0.1), 0.3, 'без похибки з плаваючою комою');
assert.equal(portionCountFor(100, 50), 2);
assert.equal(portionCountFor(75, 50), 1.5);
assert.equal(portionCountFor(60, 50), null, 'не кратно півпорції');
assert.equal(portionCountFor(25, 50), 0.5);
assert.equal(portionCountFor(10, 50), null);
assert.equal(portionCountFor(100, 0), null);
assert.equal(stepCount(1, 1), 2);
assert.equal(stepCount(1, -1), 0.5);
assert.equal(stepCount(2, -1), 1);
assert.equal(stepCount(0.5, -1), 0.5, 'не нижче півпорції');
assert.equal(stepCount(0.5, 1), 1.5);
assert.equal(formatCount(1.5), '1,5');
assert.equal(formatCount(2), '2');

// --- Спільні покупки ---
assert.deepEqual(cleanItem({ name: '  Молоко  ', qty: 1.5, unit: 'l', comment: ' лактоза ' }), { name: 'Молоко', qty: 1.5, unit: 'l', comment: 'лактоза' });
assert.deepEqual(cleanItem({ name: 'Хліб' }), { name: 'Хліб', qty: null, unit: null, comment: null });
assert.deepEqual(cleanItem({ name: 'Яйця', qty: 10 }), { name: 'Яйця', qty: 10, unit: 'pcs', comment: null }, 'кількість без одиниці — штуки');
assert.equal(cleanItem({ name: '' }), null);
assert.equal(cleanItem({ name: 'x', qty: 0 }), null);
assert.equal(cleanItem({ name: 'x', qty: -1, unit: 'g' }), null);
assert.equal(cleanItem({ name: 'x', unit: 'g' }), null, 'одиниця без кількості');
assert.equal(cleanItem({ name: 'x', qty: 1, unit: 'lb' }), null);
assert.equal(cleanItem({ name: 'x'.repeat(81) }), null);
assert.equal(cleanItem({ name: 'x', comment: 'c'.repeat(201) }), null);
assert.deepEqual(toBase(2, 'kg'), { dim: 'mass', amount: 2000 });
assert.deepEqual(toBase(1.5, 'l'), { dim: 'vol', amount: 1500 });
assert.deepEqual(fromBase('mass', 1700), { qty: 1.7, unit: 'kg' });
assert.deepEqual(fromBase('mass', 999), { qty: 999, unit: 'g' });
assert.deepEqual(fromBase('vol', 2500), { qty: 2.5, unit: 'l' });
// Об'єднання: г + кг, регістр, куплене не чіпаємо, штуки окремо від ваги
{
  const ex = [
    { id: 'a', name: 'Борошно', qty: 0.5, unit: 'kg', bought: false },
    { id: 'b', name: 'Цукор', qty: 200, unit: 'g', bought: true },
    { id: 'c', name: 'Яйця', qty: 6, unit: 'pcs', bought: false },
  ];
  const plan = planMerge(ex, [
    { name: 'борошно', qty: 700, unit: 'g' },
    { name: 'Цукор', qty: 100, unit: 'g' },
    { name: 'Яйця', qty: 300, unit: 'g' },
    { name: 'Сіль', qty: 5, unit: 'g' },
    { name: 'сіль', qty: 7, unit: 'g' },
  ]);
  assert.deepEqual(plan.updates, [{ id: 'a', qty: 1.2, unit: 'kg' }]);
  assert.deepEqual(plan.inserts, [
    { name: 'Цукор', qty: 100, unit: 'g' },
    { name: 'Яйця', qty: 300, unit: 'g' },
    { name: 'Сіль', qty: 12, unit: 'g' },
  ]);
}
assert.deepEqual(planMerge([], [{ name: 'Молоко', qty: 600, unit: 'ml' }, { name: 'молоко', qty: 600, unit: 'ml' }]).inserts, [{ name: 'Молоко', qty: 1.2, unit: 'l' }]);
// «й» і «и» не змішуються
assert.equal(planMerge([{ id: 'x', name: 'Йогурт', qty: 100, unit: 'g', bought: false }], [{ name: 'Иогурт', qty: 100, unit: 'g' }]).updates.length, 0);
const code = newInviteCode();
assert.match(code, /^[A-Z2-9]{8}$/);
assert.equal(normCode(' ab cd-efgh '), 'ABCDEFGH', 'пробіли, дефіси й регістр ігноруються');
assert.equal(normCode('ABCDEFGI'), null, 'літери I/O немає в алфавіті');
assert.equal(normCode(code.toLowerCase()), code);
assert.equal(normCode('SHORT'), null);
assert.equal(normCode(12345678), null);
assert.equal(formatQty(1.5, 'kg'), '1,5 кг');
assert.equal(formatQty(3, 'pcs'), '3 шт');
assert.equal(formatQty(null, null), '');
{
  const items = [
    { id: '1', bought: true, bought_at: '2026-01-01T10:00:00Z', created_at: '2026-01-01T08:00:00Z' },
    { id: '2', bought: false, bought_at: null, created_at: '2026-01-01T09:00:00Z' },
    { id: '3', bought: true, bought_at: '2026-01-01T11:00:00Z', created_at: '2026-01-01T07:00:00Z' },
    { id: '4', bought: false, bought_at: null, created_at: '2026-01-01T06:00:00Z' },
  ];
  assert.deepEqual(sortItems(items).map((i) => i.id), ['4', '2', '3', '1']);
  assert.deepEqual(progress(items), { bought: 2, total: 4, pct: 50 });
  assert.deepEqual(progress([]), { bought: 0, total: 0, pct: 0 });
}
assert.equal(timeLeft('2026-01-01T12:00:00Z', Date.parse('2026-01-01T11:00:00Z')), '1 год 0 хв');
assert.equal(timeLeft('2026-01-01T12:00:00Z', Date.parse('2026-01-01T11:55:00Z')), '5 хв');
assert.equal(timeLeft('2026-01-01T12:00:00Z', Date.parse('2026-01-01T12:00:00Z')), null);
assert.deepEqual(groupHistory([{ cleared_at: '2026-01-01T10:00:00Z' }, { cleared_at: '2026-01-02T10:00:00Z' }, { cleared_at: '2026-01-01T11:00:00Z' }]).map((g) => [g.day, g.items.length]), [['2026-01-02', 1], ['2026-01-01', 2]]);

console.log('OK: усі перевірки пройдені');
