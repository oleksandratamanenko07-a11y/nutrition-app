import { t } from '../i18n/uk';
import { CATEGORIES } from '../lib/api';

/** Фільтр за категорією: '' — усі, 'none' — без категорії, інакше ключ категорії */
export function CategoryChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const items: [string, string][] = [
    ['', t.dishes.allCategories],
    ...CATEGORIES.map((c): [string, string] => [c, t.dishes.cat[c]]),
    ['none', t.dishes.filterNone],
  ];
  return (
    <div className="chips" role="group" aria-label={t.dishes.category}>
      {items.map(([k, label]) => (
        <button type="button" key={k || 'all'} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}
