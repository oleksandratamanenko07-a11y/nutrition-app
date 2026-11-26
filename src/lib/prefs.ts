/** Налаштування вигляду на цьому пристрої (localStorage; якщо недоступний — значення за замовчуванням). */
export type MacroView = 'rings' | 'classic';

const KEY = 'macro_view';
const EVENT = 'macro-view-change';

export function getMacroView(): MacroView {
  try {
    return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'rings';
  } catch {
    return 'rings';
  }
}

export function setMacroView(v: MacroView): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* без сховища вигляд діє до перезавантаження */
  }
  window.dispatchEvent(new CustomEvent<MacroView>(EVENT, { detail: v }));
}

export function onMacroViewChange(cb: (v: MacroView) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<MacroView>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
