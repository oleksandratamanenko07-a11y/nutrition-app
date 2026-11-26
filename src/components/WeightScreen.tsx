import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/uk';
import { deleteWeight, getWeightLogs, logWeight, type Profile } from '../lib/api';

import {
  chartGeometry,
  lastDays,
  needsRecalc,
  sortLogs,
  weightStats,
  type WeightLog,
} from '../lib/weight';
import { errorText, ok, parseNum, Sheet } from './ui';

const nf = (v: number, digits = 1) =>
  v.toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v));

function shortDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

const W = 320;
const H = 190;
const PAD = { l: 38, r: 12, t: 12, b: 26 };

function Chart({ logs, target }: { logs: WeightLog[]; target: number | null }) {
  const chart = chartGeometry(logs, target, W, H, PAD);
  if (!chart) return null;
  const { points, targetY, min, max } = chart;
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg className="weight-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.weight.chartLabel}>
      <text x={PAD.l - 6} y={PAD.t + 4} textAnchor="end" className="axis">
        {nf(max)}
      </text>
      <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="axis">
        {nf(min)}
      </text>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="axis-line" />
      {targetY !== null && (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={targetY} y2={targetY} className="target-line" />
          <text x={W - PAD.r} y={targetY - 4} textAnchor="end" className="axis">
            {t.weight.targetLine} {nf(target!)}
          </text>
        </>
      )}
      {points.length > 1 && <polyline points={line} className="weight-line" fill="none" />}
      {points.map((p) => (
        <circle key={p.log.log_date} cx={p.x} cy={p.y} r={points.length > 40 ? 2 : 3.5} className="weight-dot" />
      ))}
      <text x={first.x} y={H - 8} textAnchor={points.length > 1 ? 'start' : 'middle'} className="axis">
        {shortDate(first.log.log_date)}
      </text>
      {points.length > 1 && (
        <text x={last.x} y={H - 8} textAnchor="end" className="axis">
          {shortDate(last.log.log_date)}
        </text>
      )}
    </svg>
  );
}

function RecordSheet({
  today,
  onClose,
  onSaved,
  initialKg,
}: {
  today: string;
  initialKg: number | null;
  onClose: () => void;
  onSaved: (p: Profile) => Promise<void>;
}) {
  const [kg, setKg] = useState(initialKg !== null ? String(initialKg).replace('.', ',') : '');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const n = parseNum(kg);
  const valid = ok(n, 30, 300) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      const p = await logWeight(date, n);
      await onSaved(p);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Sheet title={t.weight.recordTitle} onClose={onClose}>
      <label className="field">
        <span>{t.weight.weightLabel}</span>
        <input autoFocus inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />
      </label>
      <label className="field">
        <span>{t.weight.dateLabel}</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!valid && kg !== '' && <p className="error">{t.weight.invalid}</p>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="primary" disabled={!valid || saving} onClick={() => void save()}>
        {saving ? t.weight.saving : t.weight.save}
      </button>
    </Sheet>
  );
}

export function WeightScreen({
  profile,
  today,
  onClose,
  onEdit,
  onProfile,
}: {
  profile: Profile;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onProfile: (p: Profile) => void;
}) {
  const [logs, setLogs] = useState<WeightLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [range, setRange] = useState<30 | 90 | null>(90);
  const [recording, setRecording] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getWeightLogs()
      .then((l) => {
        if (!cancelled) setLogs(l);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const target = profile.target_weight_kg !== null ? Number(profile.target_weight_kg) : null;
  const all = useMemo(() => (logs ? sortLogs(logs) : []), [logs]);
  const stats = useMemo(() => weightStats(all, target), [all, target]);
  const shown = useMemo(() => lastDays(all, range), [all, range]);
  const goalWeight = profile.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null;
  const recalc = needsRecalc(stats.current, goalWeight);

  async function saved(p: Profile) {
    onProfile(p);
    setRecording(false);
    setAttempt((n) => n + 1);
  }

  async function remove(date: string) {
    if (confirm !== date) {
      setConfirm(date);
      return;
    }
    setError('');
    try {
      const p = await deleteWeight(date);
      onProfile(p);
      setConfirm('');
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const recent = [...all].reverse().slice(0, 8);

  return (
    <>
      <button type="button" className="back-link" onClick={onClose}>
        ‹ {t.weight.back}
      </button>
      <h1>{t.weight.title}</h1>

      <button type="button" className="primary" onClick={() => setRecording(true)}>
        ⚖️ {t.weight.record}
      </button>

      {failed && (
        <div className="banner">
          <span>{t.weight.loadError}</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>
            {t.retry}
          </button>
        </div>
      )}
      {!logs && !failed && (
        <div className="center-block">
          <div className="spinner" aria-label={t.loading} />
        </div>
      )}

      {recalc && stats.current !== null && goalWeight !== null && (
        <section className="card recalc">
          <h2>{t.weight.recalcTitle}</h2>
          <p>{t.weight.recalcText.replace('{n}', nf(Math.abs(stats.current - goalWeight)))}</p>
          <button type="button" className="secondary wide" onClick={onEdit}>
            {t.weight.recalcButton}
          </button>
        </section>
      )}

      {logs && all.length === 0 && <p className="muted">{t.weight.empty}</p>}

      {logs && all.length > 0 && (
        <>
          <section className="card">
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-num">{nf(stats.current!)}</div>
                <div className="muted small">{t.weight.current}, {t.profile.kg}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{target !== null ? nf(target) : '—'}</div>
                <div className="muted small">{t.weight.target}, {t.profile.kg}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{nf(stats.start!)}</div>
                <div className="muted small">{t.weight.start}, {t.profile.kg}</div>
              </div>
              <div className="stat">
                <div className="stat-num">{signed(stats.change!)}</div>
                <div className="muted small">{t.weight.change}, {t.profile.kg}</div>
              </div>
            </div>

            {stats.reached ? (
              <p className="reached">{t.weight.reached}</p>
            ) : stats.remaining !== null ? (
              <div className="row">
                <span className="muted">{t.weight.toTarget}</span>
                <b>{nf(Math.abs(stats.remaining))} {t.profile.kg}</b>
              </div>
            ) : null}

            {stats.progressPct !== null ? (
              <>
                <div className="row">
                  <span className="muted">{t.weight.progress}</span>
                  <b>{stats.progressPct}%</b>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={stats.progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${stats.progressPct}%` }} />
                </div>
              </>
            ) : (
              target !== null && <p className="muted small">{t.weight.maintainNote}</p>
            )}

            <div className="row">
              <span className="muted">{t.weight.pace}</span>
              <b>{stats.weeklyPace !== null ? `${signed(stats.weeklyPace)} ${t.weight.perWeek}` : '—'}</b>
            </div>
            {stats.weeklyPace === null && <p className="muted small">{t.weight.paceNeedMore}</p>}
          </section>

          <section className="card">
            <div className="segmented">
              <button type="button" className={range === 30 ? 'active' : ''} onClick={() => setRange(30)}>
                {t.weight.range30}
              </button>
              <button type="button" className={range === 90 ? 'active' : ''} onClick={() => setRange(90)}>
                {t.weight.range90}
              </button>
              <button type="button" className={range === null ? 'active' : ''} onClick={() => setRange(null)}>
                {t.weight.rangeAll}
              </button>
            </div>
            <Chart logs={shown} target={target} />
            {shown.length < 2 && <p className="muted small">{t.weight.oneMore}</p>}
          </section>

          <section className="card">
            <h2>{t.weight.history}</h2>
            {recent.map((l) => (
              <div className="row weight-row" key={l.log_date}>
                <span>{shortDate(l.log_date)}</span>
                <b>{nf(l.weight_kg)} {t.profile.kg}</b>
                <button type="button" className="link-danger" onClick={() => void remove(l.log_date)}>
                  {confirm === l.log_date ? t.weight.confirmRemove : t.weight.remove}
                </button>
              </div>
            ))}
            {error && <p className="error">{error}</p>}
          </section>
        </>
      )}

      {recording && (
        <RecordSheet
          today={today}
          initialKg={stats.current}
          onClose={() => setRecording(false)}
          onSaved={saved}
        />
      )}
    </>
  );
}

