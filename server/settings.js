export const DEFAULT_SETTINGS = {
  event: { title: 'Digimärt Alpnach', date: '2026-11-04', place: 'Alpnach', stand: '02', contact: '' },
  resourcesUrl: '', stableJoinUrl: '', retentionDays: null,
  audience: 'sek1', defaultSet: 'stand-6'
};
export function readSettings(db) {
  const row = db.prepare("SELECT value FROM quiz_meta WHERE key='settings'").get();
  return row ? JSON.parse(row.value) : structuredClone(DEFAULT_SETTINGS);
}
export function writeSettings(db, input) {
  const data = structuredClone(DEFAULT_SETTINGS);
  for (const key of ['title', 'date', 'place', 'stand', 'contact']) {
    const value = input.event?.[key] ?? '';
    if (typeof value !== 'string' || value.length > 250) throw new Error('Anlassangabe fehlt oder ist zu lang.');
    data.event[key] = value.trim();
  }
  if (data.event.date && (!/^\d{4}-\d{2}-\d{2}$/.test(data.event.date) || !Number.isFinite(Date.parse(data.event.date)))) throw new Error('Ungültiges Anlassdatum.');
  for (const key of ['resourcesUrl', 'stableJoinUrl']) {
    const value = input[key] || '';
    if (typeof value !== 'string' || value.length > 1000) throw new Error('Ungültige Ressourcenadresse.');
    if (value) { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Öffentliche Adressen brauchen HTTPS.'); }
    data[key] = value;
  }
  if (input.retentionDays !== null && input.retentionDays !== undefined && (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 365)) throw new Error('Löschfrist: 1–365 Tage oder keine automatische Löschung.');
  data.retentionDays = input.retentionDays ?? null;
  data.audience = ['sek1', 'sek2', 'adults'].includes(input.audience) ? input.audience : 'sek1';
  data.defaultSet = typeof input.defaultSet === 'string' ? input.defaultSet.slice(0, 80) : 'stand-6';
  db.prepare("INSERT INTO quiz_meta (key,value) VALUES ('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(data));
  return data;
}
export function purgeExpired(db, now = Date.now()) {
  const days = readSettings(db).retentionDays;
  if (!days) return 0;
  return db.prepare("DELETE FROM rooms WHERE phase='finished' AND created_at < ?").run(now - days * 86400000).changes;
}
