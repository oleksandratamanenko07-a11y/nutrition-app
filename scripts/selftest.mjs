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

console.log('OK: усі перевірки пройдені');
