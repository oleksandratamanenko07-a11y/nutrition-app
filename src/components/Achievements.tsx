import { t } from '../i18n/uk';
import { computeAchievements, MEDALS, type Medal } from '../lib/achievements';

const COLORS = ['#cd7f32', '#b87a45', '#a9b2bd', '#4fb3bf', '#e0b100', '#b44bd9'];

export function dayWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return t.achievements.days1;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return t.achievements.days2;
  return t.achievements.days5;
}

function MedalIcon({ medal, index, locked }: { medal: Medal; index: number; locked: boolean }) {
  const color = COLORS[index % COLORS.length];
  const id = `g${index}`;
  return (
    <svg viewBox="0 0 64 64" role="img" aria-label={t.medals[medal.key]}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.55" />
          <stop offset="0.5" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <path d="M20 4h10l4 16-8 4z" fill={color} opacity="0.8" />
      <path d="M44 4H34l-4 16 8 4z" fill={color} opacity="0.55" />
      <circle cx="32" cy="38" r="20" fill={`url(#${id})`} />
      <circle cx="32" cy="38" r="15" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fontSize={medal.days >= 100 ? 15 : 19}
        fontWeight="700"
        fill="#fff"
      >
        {medal.days}
      </text>
    </svg>
  );
}

function nextText(next: Medal | null, left: number | null): string {
  if (!next || left === null) return t.achievements.allDone;
  return t.achievements.toNext
    .replace('{name}', t.medals[next.key])
    .replace('{n}', String(left))
    .replace('{days}', dayWord(left));
}

/** Компактний блок для головної: дні, серія, остання медаль, скільки лишилось до наступної. */
export function AchievementsSummary({ days, today }: { days: string[]; today: string }) {
  const a = computeAchievements(days, today);
  const lastIdx = a.earned.length - 1;
  return (
    <section className="card">
      <div className="ach-mini">
        {lastIdx >= 0 ? (
          <MedalIcon medal={a.earned[lastIdx]} index={lastIdx} locked={false} />
        ) : (
          <MedalIcon medal={MEDALS[0]} index={0} locked />
        )}
        <div>
          <h2>
            {a.totalDays} {dayWord(a.totalDays)}
          </h2>
          <div className="muted small">
            {t.achievements.daysLogged} · 🔥 {a.currentStreak}
          </div>
        </div>
      </div>
      <p className="medal-next">{nextText(a.next, a.daysToNext)}</p>
    </section>
  );
}

/** Повний блок для профілю: статистика і всі медалі. */
export function AchievementsFull({ days, today }: { days: string[]; today: string }) {
  const a = computeAchievements(days, today);
  return (
    <section className="card">
      <h2>{t.achievements.title}</h2>
      <div className="ach-stats" style={{ marginTop: 12 }}>
        <div>
          <div className="ach-num">{a.totalDays}</div>
          <div className="muted small">{t.achievements.daysLogged}</div>
        </div>
        <div>
          <div className="ach-num">🔥 {a.currentStreak}</div>
          <div className="muted small">{t.achievements.streak}</div>
        </div>
        <div>
          <div className="ach-num">{a.bestStreak}</div>
          <div className="muted small">{t.achievements.bestStreak}</div>
        </div>
      </div>
      <div className="medals">
        {MEDALS.map((m, i) => {
          const got = a.totalDays >= m.days;
          return (
            <div className={`medal${got ? '' : ' locked'}`} key={m.key}>
              <MedalIcon medal={m} index={i} locked={!got} />
              <span>{t.medals[m.key]}</span>
              <span className="muted">{got ? t.achievements.earned : t.achievements.locked}</span>
            </div>
          );
        })}
      </div>
      <p className="medal-next">{nextText(a.next, a.daysToNext)}</p>
      <p className="muted small">{t.achievements.streakHint}</p>
    </section>
  );
}
