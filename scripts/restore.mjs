// Відновлення з резервної копії. За замовчуванням — лише показує, що буде зроблено (нічого не змінює).
//   node scripts/restore.mjs <папка_з_копією>            — перегляд
//   node scripts/restore.mjs <папка_з_копією> --apply    — записати в базу (існуючі рядки з тим самим ключем оновлюються)
// Потрібні SUPABASE_URL і SUPABASE_SECRET_KEY. Рядки, яких немає в копії, НЕ видаляються.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TABLES, baseUrl, headers } from './db-tables.mjs';

const BATCH = 500;
const dir = process.argv[2];
const apply = process.argv.includes('--apply');
if (!dir) {
  console.error('Вкажіть папку з копією: node scripts/restore.mjs <папка> [--apply]');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (apply && (!url || !key)) {
  console.error('Для --apply потрібні SUPABASE_URL і SUPABASE_SECRET_KEY');
  process.exit(1);
}

async function load(name) {
  return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
}

async function upsert(table, pk, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(`${baseUrl(url)}/rest/v1/${table}?on_conflict=${pk.join(',')}`, {
      method: 'POST',
      headers: { ...headers(key), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

for (const t of TABLES) {
  const rows = await load(t.name);
  console.log(`${t.name}: ${rows.length} рядків${apply ? '' : ' (перегляд)'}`);
  if (!apply || rows.length === 0) continue;
  if (t.name === 'recipes') {
    // Страви посилаються одна на одну (source_id, saved_from): спершу без посилань, потім із ними
    await upsert(t.name, t.pk, rows.map((r) => ({ ...r, source_id: null, saved_from: null })));
    const linked = rows.filter((r) => r.source_id || r.saved_from);
    await upsert(t.name, t.pk, linked);
  } else {
    await upsert(t.name, t.pk, rows);
  }
}
console.log(apply ? 'Відновлено.' : 'Це був лише перегляд. Для запису додайте --apply.');
