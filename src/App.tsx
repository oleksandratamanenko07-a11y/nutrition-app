import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n/uk';
import { addWater, ApiError, getLoggedDays, getProfile, type Profile } from './lib/api';
import { useDay } from './lib/day';
import { initData, localDate } from './lib/telegram';
import { Diary } from './components/Diary';
import { Home } from './components/Home';
import { Onboarding } from './components/Onboarding';
import { ProfileTab } from './components/ProfileTab';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; profile: Profile };

type Tab = 'home' | 'diary' | 'profile';

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

function dateLabel(date: string, today: string): string {
  if (date === today) return t.dates.today;
  if (date === addDays(today, -1)) return t.dates.yesterday;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('uk-UA', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

function DateBar({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (d: string) => void;
}) {
  return (
    <div className="datebar">
      <button
        type="button"
        className="icon"
        aria-label={t.dates.prev}
        onClick={() => onChange(addDays(date, -1))}
      >
        ‹
      </button>
      <span className="datebar-title">{dateLabel(date, today)}</span>
      <button
        type="button"
        className="icon"
        aria-label={t.dates.next}
        disabled={date >= today}
        onClick={() => onChange(addDays(date, 1))}
      >
        ›
      </button>
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const icon = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <nav className="tabbar">
      <button type="button" className={tab === 'home' ? 'active' : ''} onClick={() => onChange('home')}>
        <svg viewBox="0 0 24 24" {...icon} aria-hidden="true">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h5v-6h4v6h5V10" />
        </svg>
        <span>{t.nav.home}</span>
      </button>
      <button type="button" className={tab === 'diary' ? 'active' : ''} onClick={() => onChange('diary')}>
        <svg viewBox="0 0 24 24" {...icon} aria-hidden="true">
          <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
          <path d="M8 4v16" />
        </svg>
        <span>{t.nav.diary}</span>
      </button>
      <button type="button" className={tab === 'profile' ? 'active' : ''} onClick={() => onChange('profile')}>
        <svg viewBox="0 0 24 24" {...icon} aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
        <span>{t.nav.profile}</span>
      </button>
    </nav>
  );
}

function Main({ profile, onEdit }: { profile: Profile; onEdit: () => void }) {
  const today = localDate();
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState<Tab>('home');
  const [flash, setFlash] = useState('');
  const { day, loading, error, reload } = useDay(date);
  const [days, setDays] = useState<string[] | null>(null);
  const [daysFailed, setDaysFailed] = useState(false);

  const loadDays = useCallback(async () => {
    try {
      setDays(await getLoggedDays());
      setDaysFailed(false);
    } catch {
      // медалі — другорядна функція: головний екран працює і без них, але помилку показуємо
      setDaysFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadDays();
  }, [loadDays]);

  // Після змін у щоденнику оновлюємо і дні для медалей
  const reloadAll = useCallback(
    async (silent = false) => {
      await reload(silent);
      void loadDays();
    },
    [reload, loadDays],
  );

  async function onWater(ml: number) {
    try {
      await addWater(date, ml);
      setFlash('');
      await reload(true);
    } catch (e) {
      setFlash(t.errors[e instanceof ApiError ? e.kind : 'server']);
    }
  }

  const banner = error || flash;

  return (
    <div className="app">
      <main className="page">
        {tab !== 'profile' && <DateBar date={date} today={today} onChange={setDate} />}

        {banner && (
          <div className="banner">
            <span>{banner}</span>
            <button type="button" onClick={() => void reload(true)}>
              {t.retry}
            </button>
          </div>
        )}

        {daysFailed && days === null && (
          <div className="banner">
            <span>{t.achievements.loadError}</span>
            <button type="button" onClick={() => void loadDays()}>
              {t.retry}
            </button>
          </div>
        )}

        {!day && loading && tab !== 'profile' && (
          <div className="center-block">
            <div className="spinner" aria-label={t.loading} />
          </div>
        )}

        {day && tab === 'home' && <Home profile={profile} day={day} onWater={onWater} days={days} today={today} />}
        {day && tab === 'diary' && <Diary date={date} entries={day.entries} reload={reloadAll} />}
        {tab === 'profile' && <ProfileTab profile={profile} onEdit={onEdit} days={days} today={today} />}
      </main>
      <TabBar tab={tab} onChange={setTab} />
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    if (!initData()) {
      setState({ kind: 'error', message: t.errors.notTelegram });
      return;
    }
    try {
      const profile = await getProfile();
      setState({ kind: 'ready', profile });
    } catch (e) {
      const kind = e instanceof ApiError ? e.kind : 'server';
      setState({ kind: 'error', message: t.errors[kind === 'invalid' ? 'server' : kind] });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <main className="screen center">
        <div className="spinner" aria-label={t.loading} />
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="screen center">
        <p className="error">{state.message}</p>
        <button type="button" className="primary" onClick={() => void load()}>
          {t.retry}
        </button>
      </main>
    );
  }

  const { profile } = state;

  if (!profile.onboarded) {
    return <Onboarding onDone={(p) => setState({ kind: 'ready', profile: p })} />;
  }

  if (editing) {
    return (
      <Onboarding
        initial={profile}
        onCancel={() => setEditing(false)}
        onDone={(p) => {
          setState({ kind: 'ready', profile: p });
          setEditing(false);
        }}
      />
    );
  }

  return <Main profile={profile} onEdit={() => setEditing(true)} />;
}
