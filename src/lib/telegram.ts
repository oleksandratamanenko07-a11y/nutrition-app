interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  onEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  HapticFeedback?: { notificationOccurred(type: 'error' | 'success' | 'warning'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** Рядок initData для перевірки підпису на сервері. Порожній поза Telegram. */
export function initData(): string {
  return webApp()?.initData ?? '';
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  tg.ready();
  tg.expand();
  const apply = () => {
    document.documentElement.dataset.theme = tg.colorScheme === 'dark' ? 'dark' : 'light';
  };
  apply();
  tg.onEvent('themeChanged', apply);
}

/** Локальна дата користувача у форматі РРРР-ММ-ДД. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
