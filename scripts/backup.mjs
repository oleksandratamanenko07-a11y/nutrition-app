// Резервна копія бази: усі таблиці застосунку → JSON-файли в папці (за замовчуванням ./backup).
// Запуск: SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/backup.mjs [папка]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TABLES, baseUrl, headers } from './db-tables.mjs';

const PAGE = 1000;

export async function fetchAll(url, key, table, pk, fetchFn = fetch) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const q = `${baseUrl(url)}/rest/v1/${table.name ?? table}?select=*&order=${pk.join(',')}&limit=${PAGE}&offset=${offset}`;
    const res = await fetchFn(q, { headers: headers(key) });
    if (!res.ok) throw new Error(`${table.name ?? table}: HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error(`${table.name ?? table}: неочікувана відповідь`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('Не задані SUPABASE_URL або SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  const dir = process.argv[2] ?? 'backup';
  await mkdir(dir, { recursive: true });

  const counts = {};
  for (const t of TABLES) {
    const rows = await fetchAll(url, key, t, t.pk);
    await writeFile(join(dir, `${t.name}.json`), JSON.stringify(rows));
    counts[t.name] = rows.length;
    console.log(`${t.name}: ${rows.length}`);
  }
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({ created_at: new Date().toISOString(), counts }, null, 2),
  );
  // Порожня таблиця профілів майже напевно означає збій (невірний ключ або адреса) — копія марна
  if (counts.profiles === 0) {
    console.error('У таблиці profiles немає жодного рядка — перевірте SUPABASE_URL і ключ.');
    process.exit(1);
  }
  console.log('Резервна копія готова.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
