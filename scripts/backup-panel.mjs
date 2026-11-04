import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(process.argv[2] || 'data/processed/kpi-panel/panel.sqlite');
const destination = process.argv[3] && resolve(process.argv[3]);
if (!destination || !existsSync(source) || existsSync(destination)) {
  console.error('Usage: node scripts/backup-panel.mjs <existing-panel.sqlite> <new-backup.sqlite>');
  process.exit(1);
}
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Source SQLite integrity check failed');
  db.prepare('VACUUM INTO ?').run(destination);
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Backup SQLite integrity check failed');
    console.log(`SQLite snapshot ready: ${snapshot.prepare('SELECT count(*) AS n FROM records').get().n} records`);
  } finally {
    snapshot.close();
  }
} finally {
  db.close();
}
