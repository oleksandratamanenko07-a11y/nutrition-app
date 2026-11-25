import { t } from '../i18n/uk';
import type { Profile } from '../lib/api';
import { useState } from 'react';
import { AchievementsFull } from './Achievements';
import { Calendar } from './Calendar';

export function ProfileTab({
  profile,
  onEdit,
  days,
  today,
}: {
  profile: Profile;
  onEdit: () => void;
  days: string[] | null;
  today: string;
}) {
  const kg = (v: number | null) =>
    v === null ? '—' : `${Number(v).toLocaleString('uk-UA')} ${t.profile.kg}`;
  const [calendar, setCalendar] = useState(false);
  if (calendar) return <Calendar today={today} onClose={() => setCalendar(false)} />;

  return (
    <>
      <h1>{t.profile.title}</h1>

      <button type="button" className="secondary wide" onClick={() => setCalendar(true)}>
        📅 {t.calendar.open}
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

      <button type="button" className="primary" onClick={onEdit}>
        {t.profile.edit}
      </button>
    </>
  );
}
