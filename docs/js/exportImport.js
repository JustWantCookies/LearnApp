// The Claude loop (review sheet out, grades in) and backup/restore.
// build*/parse*/validate* are pure and tested in tests.html.

import { getAll, withTx, reqP, setSetting, PROGRESS_STORES } from './db.js';
import { loadStudyState, recordResult } from './progress.js';
import { isDue, weakSections } from './scheduler.js';

export const EXPLAIN_CAP = 5;
export const BACKUP_FORMAT = 'learnapp-backup';
export const BACKUP_VERSION = 1;

// ---------- Review sheet ----------

export function plainText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstWords(text, n = 150) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= n ? words.join(' ') : words.slice(0, n).join(' ') + ' …';
}

export function referenceFor(section) {
  if (section.summary) return { label: 'summary', text: firstWords(section.summary) };
  const body = firstWords(plainText(section.html || ''));
  if (body) return { label: 'opening', text: body };
  if (section.keyTerms?.length) return { label: 'key terms', text: section.keyTerms.map((k) => `${k.term}: ${k.definition}`).join('; ') };
  return { label: 'text', text: '(no reference text in pack)' };
}

// explains: [{ id, prompt, rubric, reference, sectionTitle, ref: {label, text} }]
// weak: [{ title, correct, total }]
export function buildReviewSheet({ today, explains, weak }) {
  const out = [
    `# Review sheet — ${today}`,
    'Grade each explanation 0–3 against the rubric and the reference text.',
    '0 = wrong/blank, 1 = major gaps, 2 = mostly correct, 3 = perfect.',
    'Return ONLY a JSON block: {"results": {"<itemId>": <score>, ...}}',
    '',
  ];
  if (!explains.length) out.push('_No explanation prompts are due today._', '');
  for (const e of explains) {
    out.push(`## ${e.id}`, `Section: ${e.sectionTitle}`, `Prompt: ${e.prompt}`);
    if (Array.isArray(e.rubric) && e.rubric.length) out.push(`Rubric: ${e.rubric.join('; ')}`);
    if (e.reference) out.push(`Reference answer: ${e.reference}`);
    out.push(`Reference (section ${e.ref.label}): ${e.ref.text}`, '');
  }
  out.push('## Weak MCQ topics (last 14 days)');
  if (!weak.length) out.push('- none');
  for (const w of weak) out.push(`- ${w.title} — ${w.correct}/${w.total} correct`);
  return out.join('\n') + '\n';
}

export async function gatherReviewSheet() {
  const study = await loadStudyState();
  const chapters = await getAll('chapters');
  const sections = new Map();
  for (const ch of chapters) for (const s of ch.sections) sections.set(`${ch.key}/${s.id}`, s);

  const explains = study.items
    .filter((it) => it.type === 'explain' && sections.has(it.sectionKey))
    .map((it) => ({ it, r: study.reviews.get(it.id) }))
    .filter(({ it, r }) => (r ? isDue(r, study.today) : study.seen.has(it.sectionKey)))
    .sort((a, b) => (a.r?.due || '0') < (b.r?.due || '0') ? -1 : (a.r?.due || '0') > (b.r?.due || '0') ? 1 : a.it.sort - b.it.sort)
    .slice(0, EXPLAIN_CAP)
    .map(({ it }) => {
      const s = sections.get(it.sectionKey);
      return { id: it.id, prompt: it.prompt, rubric: it.rubric, reference: it.reference, sectionTitle: s.title, ref: referenceFor(s) };
    });

  const weak = weakSections({ log: study.log, items: study.items, today: study.today })
    .map((w) => ({ ...w, title: sections.get(w.sectionKey)?.title || w.sectionKey }));

  return { text: buildReviewSheet({ today: study.today, explains, weak }), today: study.today, count: explains.length };
}

// ---------- Grade import ----------

// Accepts the raw paste (may include prose or ``` fences around the JSON).
export function parseGrades(text, knownIds) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { error: 'No JSON found. Paste the block that starts with {"results": …}.' };
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { error: 'The JSON could not be read. Check for missing quotes or commas.' };
  }
  const results = obj && typeof obj === 'object' ? obj.results : null;
  if (!results || typeof results !== 'object' || Array.isArray(results)) {
    return { error: 'The JSON has no "results" object.' };
  }
  const valid = {};
  const unknown = [];
  const invalid = [];
  for (const [id, score] of Object.entries(results)) {
    if (!knownIds.has(id)) unknown.push(id);
    else if (!Number.isInteger(score) || score < 0 || score > 3) invalid.push(`${id} (score ${JSON.stringify(score)})`);
    else valid[id] = score;
  }
  return { valid, unknown, invalid };
}

export async function knownItemIds() {
  const items = await getAll('items');
  return new Set(items.map((i) => i.id));
}

export async function applyGrades(valid) {
  for (const [id, score] of Object.entries(valid)) await recordResult(id, score, 'claude');
}

// ---------- Backup / restore ----------

export function buildBackup(stores, now = new Date()) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, created: now.toISOString(), stores };
}

const BACKUP_STORES = ['reviews', 'log', 'reading', 'seen'];

export function validateBackup(obj) {
  if (!obj || obj.format !== BACKUP_FORMAT) return 'This file is not a Learn backup.';
  if (!Number.isInteger(obj.version) || obj.version > BACKUP_VERSION) return `This backup uses version ${obj.version}; update the app.`;
  const s = obj.stores;
  if (!s || typeof s !== 'object') return 'The backup has no data.';
  for (const name of BACKUP_STORES) {
    if (!Array.isArray(s[name])) return `The backup is missing "${name}".`;
  }
  if (s.settings && (typeof s.settings !== 'object' || Array.isArray(s.settings))) return 'The backup settings are damaged.';
  if (!s.reviews.every((r) => r && typeof r.itemId === 'string' && typeof r.due === 'string' && Number.isInteger(r.box))) return 'Some review entries are damaged.';
  if (!s.log.every((e) => e && typeof e.itemId === 'string' && typeof e.ts === 'string')) return 'Some log entries are damaged.';
  if (!s.reading.every((r) => r && typeof r.bookId === 'string')) return 'Some reading positions are damaged.';
  if (!s.seen.every((r) => r && typeof r.key === 'string')) return 'Some read-section entries are damaged.';
  return null;
}

export async function createBackup() {
  const stores = await withTx(PROGRESS_STORES, 'readonly', async (s) => {
    const out = {};
    for (const name of BACKUP_STORES) out[name] = await reqP(s[name].getAll());
    const keys = await reqP(s.settings.getAllKeys());
    const vals = await reqP(s.settings.getAll());
    out.settings = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
    return out;
  });
  return buildBackup(stores);
}

export async function restoreBackup(obj) {
  await withTx(PROGRESS_STORES, 'readwrite', async (s) => {
    for (const name of BACKUP_STORES) {
      await reqP(s[name].clear());
      for (const row of obj.stores[name]) await reqP(s[name].put(row));
    }
    await reqP(s.settings.clear());
    for (const [k, v] of Object.entries(obj.stores.settings || {})) await reqP(s.settings.put(v, k));
  });
}

export async function markBackedUp() {
  await setSetting('lastBackup', new Date().toISOString());
}
