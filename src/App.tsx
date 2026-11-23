import { useCallback, useEffect, useState } from 'react';
import { t } from './i18n/uk';
import { ApiError, getProfile, type Profile } from './lib/api';
import { initData } from './lib/telegram';
import { Onboarding } from './components/Onboarding';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; profile: Profile };

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

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
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
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

  return (
    <main className="screen">
      <h1>
        {t.home.greeting}
        {profile.first_name ? `, ${profile.first_name}` : ''}!
      </h1>
      <p className="muted">{t.home.profileSaved}</p>
      <section className="card">
        <h2>{t.home.normTitle}</h2>
        <p className="big">{profile.kcal_goal} ккал</p>
        <p>
          {t.onboarding.protein}: {profile.protein_goal_g} · {t.onboarding.fat}: {profile.fat_goal_g} ·{' '}
          {t.onboarding.carbs}: {profile.carbs_goal_g}
        </p>
        <p>
          {t.onboarding.water}: {profile.water_goal_ml}
        </p>
      </section>
      <p className="muted small">{t.home.stage3}</p>
    </main>
  );
}
