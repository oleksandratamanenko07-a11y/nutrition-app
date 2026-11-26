interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  onEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  /** Bot API 6.9+: просить дозволу, щоб бот міг писати користувачу */
  requestWriteAccess?(cb?: (allowed: boolean) => void): void;
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

/** Часовий пояс користувача (IANA), напр. Europe/Warsaw. */
export function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Просить Telegram дозволити боту писати користувачу. Якщо метод недоступний — вважаємо, що можна. */
export function askWriteAccess(): Promise<boolean> {
  const tg = webApp();
  if (!tg?.requestWriteAccess) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      tg.requestWriteAccess!((allowed) => finish(allowed));
    } catch {
      finish(true);
    }
    setTimeout(() => finish(true), 15000);
  });
}
