// Пошук звичайних продуктів (без штрихкодів) у USDA FoodData Central.
// Значення пишемо лише ті, що є у відповіді USDA: якщо поля немає — null, нічого не вигадуємо.
// Перекладається тільки ПОШУКОВИЙ ЗАПИТ (укр/рос/пол → англ.); харчова цінність береться з USDA як є.
import type { FoodProduct } from './off.js';

export type CookState = 'raw' | 'boiled' | 'fried' | 'baked' | 'grilled' | 'steamed' | 'cooked' | 'canned' | 'dried';

// ---------------- Допоміжне ----------------

const foldKey = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/ё/g, 'е');

const words = (s: string): string[] => foldKey(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const STOP = new Set(['с', 'з', 'і', 'и', 'w', 'z', 'na', 'на', 'в', 'у', 'of', 'with', 'and', 'the']);

/** Збіг основ слова: однакові або відрізняються лише закінченням (до 2 літер) */
export function stemEq(a: string, b: string): boolean {
  if (a === b) return true;
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p >= 3 && a.length - p <= 2 && b.length - p <= 2;
}

// ---------------- Способи приготування ----------------

const STATE_WORDS: Record<string, CookState | 'any-cooked'> = {};
function addStates(state: CookState | 'any-cooked', list: string): void {
  for (const w of list.split(/\s+/)) STATE_WORDS[foldKey(w)] = state;
}
addStates('raw', 'сырой сырая сырое сырые сирий сира сире сирі surowy surowa surowe surowa raw fresh');
addStates('boiled',
  'варёный вареный варёная вареная варёное вареное варёные вареные отварной отварная отварное отварные ' +
  'варений варена варене варені відварний відварна відварне gotowany gotowana gotowane ugotowany ugotowana ugotowane boiled');
addStates('fried',
  'жареный жареная жареное жареные смажений смажена смажене смажені smażony smażona smażone usmażony usmażona usmażone fried');
addStates('baked',
  'запечённый запеченный запечённая запеченная запечённое запеченное запечений запечена запечене запечені ' +
  'печёный печеный печёная печеная pieczony pieczona pieczone upieczony upieczona baked roasted');
addStates('grilled', 'гриль grill grillowany grillowana grillowane grilled broiled');
addStates('steamed', 'пару парі парі паровой паровая паровий парова parze parowy parowana parowane steamed');
addStates('any-cooked', 'приготовленный приготовленная приготований приготована приготовлене cooked');

export const STATE_LABEL: Record<CookState, string> = {
  raw: 'сире',
  boiled: 'варене',
  fried: 'смажене',
  baked: 'запечене',
  grilled: 'гриль',
  steamed: 'на парі',
  cooked: 'приготовлене',
  canned: 'консервоване',
  dried: 'сушене',
};

/** Які стани є в англійському описі USDA (у порядку специфічності) */
export function descriptionStates(desc: string): CookState[] {
  const w = new Set(desc.toLowerCase().split(/[^a-z-]+/).filter(Boolean));
  const has = (...xs: string[]) => xs.some((x) => w.has(x));
  const out: CookState[] = [];
  if (has('boiled')) out.push('boiled');
  if (has('fried', 'pan-fried', 'stir-fried', 'deep-fried')) out.push('fried');
  if (has('roasted', 'baked')) out.push('baked');
  if (has('broiled', 'grilled')) out.push('grilled');
  if (has('steamed')) out.push('steamed');
  if (has('canned')) out.push('canned');
  if (has('cooked')) out.push('cooked');
  if (has('dried', 'dehydrated')) out.push('dried');
  if (has('raw')) out.push('raw');
  return out;
}

type Wanted = CookState | 'any-cooked' | null;

/** 2 — точний збіг, 1 — сумісний (загальне «cooked»), 0 — не підходить */
export function stateFit(want: Wanted, have: CookState[]): 0 | 1 | 2 {
  if (!want) return 2;
  if (want === 'any-cooked') {
    return have.some((s) => s !== 'raw' && s !== 'dried' && s !== 'canned') ? 2 : 0;
  }
  if (have.includes(want)) return 2;
  if ((want === 'boiled' || want === 'steamed') && have.includes('cooked')) return 1;
  return 0;
}

// ---------------- Словник запитів ----------------
// [англ. запит для USDA, назва українською, форми слів: рос | укр | пол]

type Entry = [en: string, uk: string, forms: string];

const DICT: Entry[] = [
  // фрукти та ягоди
  ['apples', 'Яблуко', 'яблоко|яблуко|jabłko|jabłka'],
  ['bananas', 'Банан', 'банан|banan'],
  ['pears', 'Груша', 'груша|gruszka'],
  ['oranges', 'Апельсин', 'апельсин|pomarańcza'],
  ['tangerines', 'Мандарин', 'мандарин|mandarynka'],
  ['lemons', 'Лимон', 'лимон|cytryna'],
  ['grapes', 'Виноград', 'виноград|winogrona'],
  ['strawberries', 'Полуниця', 'клубника|полуниця|truskawka|truskawki'],
  ['raspberries', 'Малина', 'малина|malina'],
  ['blueberries', 'Чорниця', 'черника|чорниця|borówka|borówki'],
  ['cherries sweet', 'Черешня', 'черешня|czereśnia|czereśnie'],
  ['cherries sour', 'Вишня', 'вишня|wiśnia|wiśnie'],
  ['peaches', 'Персик', 'персик|brzoskwinia'],
  ['plums', 'Слива', 'слива|śliwka'],
  ['apricots', 'Абрикос', 'абрикос|morela'],
  ['watermelon', 'Кавун', 'арбуз|кавун|arbuz'],
  ['cantaloupe', 'Диня', 'дыня|диня|melon'],
  ['kiwifruit', 'Ківі', 'киви|ківі|kiwi'],
  ['pineapple', 'Ананас', 'ананас|ananas'],
  ['mango', 'Манго', 'манго|mango'],
  ['avocados', 'Авокадо', 'авокадо|awokado'],
  ['grapefruit', 'Грейпфрут', 'грейпфрут|grejpfrut'],
  ['pomegranates', 'Гранат', 'гранат|granat'],
  ['dates', 'Фініки', 'финик|финики|фінік|фініки|daktyl|daktyle'],
  ['raisins', 'Родзинки', 'изюм|родзинки|rodzynki'],
  ['apricots dried', 'Курага', 'курага|morele suszone'],
  // овочі
  ['potatoes', 'Картопля', 'картофель|картошка|картопля|ziemniak|ziemniaki'],
  ['sweet potato', 'Батат', 'батат|bataty|batat'],
  ['cucumber', 'Огірок', 'огурец|огірок|ogórek'],
  ['tomatoes', 'Помідор', 'помидор|томат|помідор|pomidor'],
  ['carrots', 'Морква', 'морковь|морква|marchew|marchewka'],
  ['broccoli', 'Броколі', 'брокколи|броколі|brokuł|brokuły'],
  ['cauliflower', 'Цвітна капуста', 'цветная капуста|цвітна капуста|kalafior'],
  ['cabbage', 'Капуста', 'капуста|kapusta'],
  ['onions', 'Цибуля', 'лук|цибуля|cebula'],
  ['garlic', 'Часник', 'чеснок|часник|czosnek'],
  ['peppers sweet', 'Перець солодкий', 'болгарский перец|перец|перець|солодкий перець|papryka'],
  ['squash zucchini', 'Кабачок', 'кабачок|цукіні|цуккини|cukinia'],
  ['eggplant', 'Баклажан', 'баклажан|bakłażan'],
  ['beets', 'Буряк', 'свекла|буряк|burak'],
  ['spinach', 'Шпинат', 'шпинат|szpinak'],
  ['lettuce', 'Салат', 'салат|sałata'],
  ['mushrooms', 'Гриби', 'грибы|шампиньоны|гриби|шампіньйони|pieczarki|grzyby'],
  ['corn sweet', 'Кукурудза', 'кукуруза|кукурудза|kukurydza'],
  ['peas green', 'Зелений горошок', 'зеленый горошек|зелений горошок|groszek'],
  ['pumpkin', 'Гарбуз', 'тыква|гарбуз|dynia'],
  ['radishes', 'Редис', 'редис|редиска|rzodkiewka'],
  ['celery', 'Селера', 'сельдерей|селера|seler'],
  ['asparagus', 'Спаржа', 'спаржа|szparagi'],
  ['beans snap green', 'Зелена квасоля', 'стручковая фасоль|зелена квасоля|стручкова квасоля|fasolka szparagowa'],
  // м’ясо та риба
  ['chicken breast', 'Куряча грудка', 'куриная грудка|грудка куриная|куряча грудка|куриное филе|куряче філе|pierś z kurczaka|filet z kurczaka|pierś kurczaka'],
  ['chicken thigh', 'Куряче стегно', 'куриное бедро|куряче стегно|udko z kurczaka|udo z kurczaka'],
  ['chicken', 'Курка', 'курица|курка|kurczak'],
  ['turkey', 'Індичка', 'индейка|індичка|indyk'],
  ['beef ground', 'Яловичий фарш', 'говяжий фарш|яловичий фарш|mielona wołowina'],
  ['beef', 'Яловичина', 'говядина|яловичина|wołowina'],
  ['pork', 'Свинина', 'свинина|wieprzowina'],
  ['lamb', 'Баранина', 'баранина|jagnięcina'],
  ['bacon', 'Бекон', 'бекон|boczek'],
  ['ham', 'Шинка', 'ветчина|шинка|szynka'],
  ['salmon', 'Лосось', 'лосось|семга|łosoś'],
  ['tuna', 'Тунець', 'тунец|тунець|tuńczyk'],
  ['cod', 'Тріска', 'треска|тріска|dorsz'],
  ['herring', 'Оселедець', 'сельдь|селедка|оселедець|śledź'],
  ['shrimp', 'Креветки', 'креветки|krewetki'],
  ['trout', 'Форель', 'форель|pstrąg'],
  ['mackerel', 'Скумбрія', 'скумбрия|скумбрія|makrela'],
  // крупи, бобові, хліб
  ['rice brown', 'Рис бурий', 'бурый рис|бурий рис|ryż brązowy'],
  ['rice white', 'Рис білий', 'белый рис|білий рис|ryż biały'],
  ['rice', 'Рис', 'рис|ryż'],
  ['buckwheat groats', 'Гречка', 'гречка|гречневая крупа|гречана крупа|kasza gryczana|gryka'],
  ['oats', 'Вівсянка', 'овсянка|овсяные хлопья|вівсянка|вівсяні пластівці|płatki owsiane|owsianka'],
  ['lentils', 'Сочевиця', 'чечевица|сочевиця|soczewica'],
  ['chickpeas', 'Нут', 'нут|ciecierzyca'],
  ['beans', 'Квасоля', 'фасоль|квасоля|fasola'],
  ['pasta', 'Макарони', 'макароны|паста|макарони|makaron'],
  ['millet', 'Пшоно', 'пшено|пшоно|kasza jaglana'],
  ['barley pearled', 'Перлова крупа', 'перловка|перлова крупа|kasza jęczmienna'],
  ['semolina', 'Манка', 'манка|манная крупа|kasza manna'],
  ['quinoa', 'Кіноа', 'киноа|кіноа|komosa ryżowa'],
  ['bread whole-wheat', 'Хліб цільнозерновий', 'цельнозерновой хлеб|хліб цільнозерновий|chleb pełnoziarnisty|chleb razowy'],
  ['bread white', 'Хліб білий', 'белый хлеб|білий хліб|chleb pszenny|chleb biały'],
  ['bread', 'Хліб', 'хлеб|хліб|chleb'],
  ['wheat flour white', 'Борошно пшеничне', 'мука|пшеничная мука|борошно|пшеничне борошно|mąka|mąka pszenna'],
  ['sugars granulated', 'Цукор', 'сахар|цукор|cukier'],
  ['honey', 'Мед', 'мед|мёд|miód'],
  // молочні та яйця
  ['milk whole', 'Молоко', 'молоко|mleko'],
  ['cottage cheese', 'Сир кисломолочний', 'творог|сир кисломолочний|twaróg'],
  ['egg whole', 'Яйце', 'яйцо|яйця|яйце|яйца|jajko|jajka'],
  ['yogurt plain', 'Йогурт натуральний', 'натуральный йогурт|йогурт натуральный|йогурт натуральний|натуральний йогурт|jogurt naturalny|йогурт|jogurt'],
  ['cheese', 'Сир', 'сыр|сир|ser'],
  ['mozzarella', 'Моцарела', 'моцарелла|моцарела|mozzarella'],
  ['butter', 'Вершкове масло', 'масло сливочное|вершкове масло|масло вершкове|масло|masło'],
  ['sour cream', 'Сметана', 'сметана|śmietana'],
  ['cream', 'Вершки', 'сливки|вершки|śmietanka'],
  // олії, горіхи
  ['oil olive', 'Олія оливкова', 'оливковое масло|оливкова олія|oliwa z oliwek|oliwa'],
  ['oil sunflower', 'Олія соняшникова', 'подсолнечное масло|соняшникова олія|олія соняшникова|olej słonecznikowy'],
  ['oil vegetable', 'Олія рослинна', 'растительное масло|олія рослинна|рослинна олія|olej roślinny'],
  ['almonds', 'Мигдаль', 'миндаль|мигдаль|migdały'],
  ['walnuts', 'Волоський горіх', 'грецкий орех|волоський горіх|грецкие орехи|орехи грецкие|orzechy włoskie'],
  ['peanuts', 'Арахіс', 'арахис|арахіс|orzeszki ziemne'],
  ['hazelnuts', 'Фундук', 'фундук|лесной орех|orzechy laskowe'],
  ['cashew nuts', 'Кеш’ю', 'кешью|orzechy nerkowca'],
  ['nuts mixed', 'Горіхи', 'орехи|горіхи|orzechy'],
  ['sunflower seed kernels', 'Насіння соняшника', 'семечки|семена подсолнечника|насіння соняшника|pestki słonecznika'],
  ['peanut butter', 'Арахісова паста', 'арахисовая паста|арахісова паста|masło orzechowe'],
  ['chocolate dark', 'Чорний шоколад', 'темный шоколад|чорний шоколад|czekolada gorzka'],
  ['tofu', 'Тофу', 'тофу|tofu'],
];

interface Compiled {
  en: string;
  uk: string;
  forms: string[][]; // кожна форма — слова без службових
}

const COMPILED: Compiled[] = DICT.map(([en, uk, forms]) => ({
  en,
  uk,
  forms: forms.split('|').map((f) => words(f).filter((w) => !STOP.has(w))),
}));

// ---------------- Розбір запиту ----------------

export interface UsdaQuery {
  /** Англійські слова для пошуку у USDA */
  terms: string[];
  /** Назва українською зі словника (null — англійський запит без перекладу) */
  label: string | null;
  want: Wanted;
}

/**
 * Розбирає запит користувача. Повертає null, якщо запит не вдалося пов’язати зі звичайним продуктом
 * (тоді USDA не питаємо — лишаються свої продукти та Open Food Facts).
 */
export function parseUsdaQuery(raw: string): UsdaQuery | null {
  const original = raw.normalize('NFC').trim();
  const all = words(original);
  if (all.length === 0) return null;

  let want: Wanted = null;
  const rest: string[] = [];
  for (const w of all) {
    const st = STATE_WORDS[w];
    if (st) want = st;
    else if (!STOP.has(w)) rest.push(w);
  }
  if (rest.length === 0) return null;

  let best: { e: Compiled; size: number } | null = null;
  for (const e of COMPILED) {
    for (const form of e.forms) {
      if (form.length === 0) continue;
      const used = new Set<number>();
      const ok = form.every((fw) => {
        const i = rest.findIndex((q, idx) => !used.has(idx) && stemEq(q, fw));
        if (i < 0) return false;
        used.add(i);
        return true;
      });
      // усі слова запиту мають бути пояснені, інакше ризик показати не той продукт
      if (ok && used.size === rest.length && (!best || form.length > best.size)) best = { e, size: form.length };
    }
  }
  if (best) return { terms: words(best.e.en), label: best.e.uk, want };

  // Англійський запит напряму (apple, chicken breast, boiled rice)
  if (/^[\x20-\x7e]+$/.test(original)) return { terms: rest, label: null, want };
  return null;
}

// ---------------- Відповідь USDA ----------------

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

interface RawNutrient {
  nutrientId?: unknown;
  nutrientNumber?: unknown;
  unitName?: unknown;
  value?: unknown;
  amount?: unknown;
  nutrient?: { id?: unknown; number?: unknown; unitName?: unknown };
}

/** Значення на 100 г за id (або номером) поживної речовини; перший знайдений варіант */
function nutrientValue(list: RawNutrient[], ids: number[], numbers: string[], unit: string): number | null {
  for (let k = 0; k < ids.length; k++) {
    const n = list.find((x) => {
      const id = Number(x.nutrientId ?? x.nutrient?.id);
      const no = String(x.nutrientNumber ?? x.nutrient?.number ?? '');
      const u = String(x.unitName ?? x.nutrient?.unitName ?? '').toUpperCase();
      return (id === ids[k] || no === numbers[k]) && (u === '' || u === unit);
    });
    if (n) {
      const v = num(n.value ?? n.amount);
      if (v !== null) return v;
    }
  }
  return null;
}

const enStem = (w: string): string => (w.length > 4 ? w.replace(/(es|s)$/, '') : w);

function hasTerm(desc: string, term: string): boolean {
  const stem = enStem(term);
  return desc.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(stem));
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : cut.length) + '…';
}

/** Перетворює відповідь USDA у список продуктів: відфільтровує, ранжує, не вигадує значень */
export function parseUsdaFoods(
  json: unknown,
  q: UsdaQuery,
  flag: (v: { kcal_100: number | null; protein_100: number | null; fat_100: number | null; carbs_100: number | null }) => boolean,
  limit = 12,
): FoodProduct[] {
  const foods = (json && typeof json === 'object' ? (json as { foods?: unknown }).foods : null);
  if (!Array.isArray(foods)) return [];

  type Cand = { p: FoodProduct; score: number };
  const cands: Cand[] = [];

  foods.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object') return;
    const f = raw as { description?: unknown; foodNutrients?: unknown; fdcId?: unknown };
    const desc = typeof f.description === 'string' ? f.description.trim() : '';
    if (!desc || /^babyfood/i.test(desc)) return;
    if (!q.terms.every((t) => hasTerm(desc, t))) return;

    const list = (Array.isArray(f.foodNutrients) ? f.foodNutrients : []) as RawNutrient[];
    const values = {
      // 1008 — «Energy» у ккал; у Foundation замість нього бувають розрахункові Atwater (2047, 2048)
      kcal_100: nutrientValue(list, [1008, 2047, 2048], ['208', '957', '958'], 'KCAL'),
      protein_100: nutrientValue(list, [1003], ['203'], 'G'),
      fat_100: nutrientValue(list, [1004], ['204'], 'G'),
      // вуглеводи «за різницею», а якщо їх немає — «за сумою»
      carbs_100: nutrientValue(list, [1005, 1050], ['205', '205.2'], 'G'),
    };
    if (Object.values(values).every((v) => v === null)) return;

    const states = descriptionStates(desc);
    const fit = stateFit(q.want, states);
    const first = desc.split(',')[0].toLowerCase();
    // пріоритет: назва починається з потрібного продукту, збіг стану, порядок USDA, коротший опис
    const score =
      (q.terms.every((t) => hasTerm(first, t)) ? 100 : 0) + fit * 20 - idx * 0.5 - desc.length / 100;

    const shown = states.filter((s, i) => states.indexOf(s) === i).map((s) => STATE_LABEL[s]);
    const name = q.label
      ? shorten(shown.length ? `${q.label} (${shown.join(', ')})` : q.label, 120)
      : shorten(desc, 120);

    cands.push({
      score: fit === 0 ? score - 1000 : score,
      p: {
        id: null,
        barcode: null,
        name,
        brand: shorten(desc, 80), // оригінальний опис USDA — щоб відрізняти варіанти (сире/варене, зі шкіркою тощо)
        country: null,
        image_url: null,
        ...values,
        source: 'usda',
        kcal_from_kj: false,
        suspicious: flag(values),
      },
    });
  });

  // Є вимога щодо способу приготування — показуємо лише підходящі, а якщо таких немає — усі варіанти
  const fitting = cands.filter((c) => c.score > -500);
  const pool = q.want && fitting.length > 0 ? fitting : cands;
  return pool.sort((a, b) => b.score - a.score).slice(0, limit).map((c) => c.p);
}
