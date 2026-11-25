import type { ReactNode } from 'react';
import { t } from '../i18n/uk';
import { ApiError, type Meal } from '../lib/api';

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function parseNum(v: string): number | null {
  const s = v.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function ok(v: number | null, min: number, max: number): v is number {
  return v !== null && v >= min && v <= max;
}

export function errorText(e: unknown): string {
  return t.errors[e instanceof ApiError ? e.kind : 'server'];
}

export function Sheet({
  title,
  onClose,
  onBack,
  children,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {onBack && (
            <button type="button" className="icon" onClick={onBack} aria-label={t.scan.back}>
              ‹
            </button>
          )}
          <h2>{title}</h2>
          <button type="button" className="icon" onClick={onClose} aria-label={t.diary.close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function MealPicker({ value, onChange }: { value: Meal; onChange: (m: Meal) => void }) {
  return (
    <div className="segmented">
      {MEALS.map((m) => (
        <button
          key={m}
          type="button"
          className={value === m ? 'active' : ''}
          onClick={() => onChange(m)}
        >
          {t.meals[m]}
        </button>
      ))}
    </div>
  );
}
