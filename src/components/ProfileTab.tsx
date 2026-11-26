import { t } from '../i18n/uk';
import type { Profile } from '../lib/api';
import { useState } from 'react';
import { saveSettings } from '../lib/api';
import { askWriteAccess } from '../lib/telegram';
import { WeightScreen } from './WeightScreen';
import { Stats } from './Stats';
import { AchievementsFull } from './Achievements';
import { Calendar } from './Calendar';

export function ProfileTab({
  profile,
  onEdit,
  onProfile,
  days,
  today,
}: {
  profile: Profile;
  onEdit: () => void;
  onProfile: (p: Profile) => void;
  days: string[] | null;
  today: string;
}) {
  const kg = (v: number | null) =>
    v === null ? '—' : `${Number(v).toLocaleString('uk-UA')} ${t.profile.kg}`;
  const [calendar, setCalendar] = useState(false);
  const [weight, setWeight] = useState(false);
  const [stats, setStats] = useState(false);
  const [remindError, setRemindError] = useState('');
  const [busy, setBusy] = useState(false);
  if (calendar) return <Calendar today={today} onClose={() => setCalendar(false)} />;
  if (stats) return <Stats today={today} onClose={() => setStats(false)} />;
  if (weight) {
    return (
      <WeightScreen
        profile={profile}
        today={today}
        onClose={() => setWeight(false)}
        onEdit={onEdit}
        onProfile={onProfile}
      />
    );
  }

  async function toggle(key: 'remind_diary' | 'remind_weight' | 'remind_review') {
    if (busy) return;
    const next = !(profile[key] ?? true);
    setBusy(true);
    setRemindError('');
    try {
      // Щоб бот міг написати першим, просимо дозвіл у Telegram
      if (next && !(await askWriteAccess())) {
        setRemindError(t.reminders.accessDenied);
        setBusy(false);
        return;
      }
      onProfile(await saveSettings({ [key]: next }));
    } catch {
      setRemindError(t.reminders.saveError);
    }
    setBusy(false);
  }

  return (
    <>
      <h1>{t.profile.title}</h1>

      <button type="button" className="secondary wide" onClick={() => setCalendar(true)}>
        📅 {t.calendar.open}
      </button>

      <button type="button" className="secondary wide" onClick={() => setStats(true)}>
        📈 {t.stats.open}
      </button>

      <button type="button" className="secondary wide" onClick={() => setWeight(true)}>
        ⚖️ {t.weight.open}
      </button>

      {days && <AchievementsFull days={days} today={today} />}

      <section className="card">
        <h2>{t.profile.data}</h2>
        <div className="row">
          <span className="muted">{t.profile.weight}</span>
          <b>{kg(profile.weight_kg)}</b>
        </div>
        <div className="row">
          <span className="muted">{t.profile.target}</span>
          <b>{kg(profile.target_weight_kg)}</b>
        </div>
        <div className="row">
          <span className="muted">{t.profile.height}</span>
          <b>{profile.height_cm ?? '—'} {t.profile.cm}</b>
        </div>
        <div className="row">
          <span className="muted">{t.onboarding.goal}</span>
          <b>{profile.goal ? t.goal[profile.goal] : '—'}</b>
        </div>
      </section>

      <section className="card">
        <h2>{t.profile.norm}</h2>
        <div className="row">
          <span className="muted">{t.onboarding.kcal}</span>
          <b>{profile.kcal_goal}</b>
        </div>
        <div className="row">
          <span className="muted">{t.onboarding.protein}</span>
          <b>{profile.protein_goal_g}</b>
        </div>
        <div className="row">
          <span className="muted">{t.onboarding.fat}</span>
          <b>{profile.fat_goal_g}</b>
        </div>
        <div className="row">
          <span className="muted">{t.onboarding.carbs}</span>
          <b>{profile.carbs_goal_g}</b>
        </div>
        <div className="row">
          <span className="muted">{t.onboarding.water}</span>
          <b>{profile.water_goal_ml}</b>
        </div>
      </section>

      <section className="card">
        <h2>{t.reminders.title}</h2>
        <label className="switch-row">
          <span>{t.reminders.diary}</span>
          <input
            type="checkbox"
            checked={profile.remind_diary ?? true}
            disabled={busy}
            onChange={() => void toggle('remind_diary')}
          />
        </label>
        <label className="switch-row">
          <span>{t.reminders.weight}</span>
          <input
            type="checkbox"
            checked={profile.remind_weight ?? true}
            disabled={busy}
            onChange={() => void toggle('remind_weight')}
          />
        </label>
        <label className="switch-row">
          <span>{t.reminders.review}</span>
          <input
            type="checkbox"
            checked={profile.remind_review ?? true}
            disabled={busy}
            onChange={() => void toggle('remind_review')}
          />
        </label>
        <p className="muted small">{t.reminders.note}</p>
        {remindError && <p className="error">{remindError}</p>}
      </section>

      <button type="button" className="primary" onClick={onEdit}>
        {t.profile.edit}
      </button>
    </>
  );
}
