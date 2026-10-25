// Content packs: one JSON file per chapter, images embedded as base64 data URLs.
// validatePack is pure (tested in tests.html); importPack writes to IndexedDB.

import { withTx, reqP, prefixRange, getSetting, setSetting } from './db.js';
import { UserError } from './dom.js';

export const SUPPORTED_SCHEMA = 1;
export const KNOWN_ITEM_TYPES = ['mcq', 'explain'];
export const MAX_PACK_BYTES = 40 * 1024 * 1024;

const ID = /^[A-Za-z0-9._-]{1,80}$/;
const MEDIA_PATH = /^media\/[A-Za-z0-9._-]+$/;
const DATA_URL = /^data:(image\/(?:webp|png|jpeg|gif|avif));base64,([A-Za-z0-9+/]+={0,2})$/;

export function globalItemId(bookId, chapterId, sectionId, itemId) {
  return `${bookId}/${chapterId}/${sectionId}/${itemId}`;
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';

export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  let unsupported = 0;
  const err = (m) => errors.push(m);

  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    return { errors: ['This file is not a content pack.'], warnings, unsupported };
  }
  if (pack.schema !== SUPPORTED_SCHEMA) {
    if (Number.isInteger(pack.schema) && pack.schema > SUPPORTED_SCHEMA) {
      err(`This pack uses schema ${pack.schema}; update the app.`);
    } else {
      err('This file is not a content pack (missing or unknown "schema").');
    }
    return { errors, warnings, unsupported };
  }

  const { book, chapter } = pack;
  const meta = pack.pack;
  if (!meta || !ID.test(meta.id || '')) err('The pack has no valid "pack.id".');
  if (!meta || !Number.isInteger(meta.version) || meta.version < 1) err('The pack has no valid "pack.version".');

  if (!book || !ID.test(book.id || '')) err('The pack has no valid "book.id".');
  else {
    if (!isStr(book.title)) err('The book has no title.');
    if (!isStr(book.license)) err('The book has no license. Packs without a license are refused.');
    else if (/\bND\b/i.test(book.license)) err(`The license "${book.license}" forbids derivatives, so this pack is refused.`);
    if (!isStr(book.attribution)) err('The book has no attribution text (required by the license).');
  }

  const mediaPaths = new Set();
  if (pack.media !== undefined) {
    if (typeof pack.media !== 'object' || Array.isArray(pack.media) || pack.media === null) err('"media" must be an object.');
    else {
      for (const [path, url] of Object.entries(pack.media)) {
        if (!MEDIA_PATH.test(path)) err(`Media path "${path.slice(0, 60)}" is not allowed.`);
        else if (typeof url !== 'string' || !DATA_URL.test(url)) err(`Media "${path}" is not an embedded image.`);
        else mediaPaths.add(path);
      }
    }
  }

  if (!chapter || !ID.test(chapter.id || '')) err('The pack has no valid "chapter.id".');
  else {
    if (!isStr(chapter.title)) err('The chapter has no title.');
    if (!Array.isArray(chapter.sections) || chapter.sections.length === 0) err('The chapter has no sections.');
    else {
      const sectionIds = new Set();
      chapter.sections.forEach((s, si) => {
        const where = `Section ${si + 1}`;
        if (!s || !ID.test(s.id || '')) { err(`${where} has no valid id.`); return; }
        if (sectionIds.has(s.id)) err(`Section id "${s.id}" appears twice.`);
        sectionIds.add(s.id);
        if (!isStr(s.title)) err(`Section "${s.id}" has no title.`);
        if (typeof s.html !== 'string') err(`Section "${s.id}" has no html.`);
        else {
          for (const m of s.html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) {
            if (!mediaPaths.has(m[1])) warnings.push(`Section "${s.id}" references missing image "${m[1].slice(0, 60)}".`);
          }
        }
        if (s.keyTerms !== undefined && !Array.isArray(s.keyTerms)) err(`Section "${s.id}" keyTerms must be a list.`);
        if (s.items === undefined) return;
        if (!Array.isArray(s.items)) { err(`Section "${s.id}" items must be a list.`); return; }
        const itemIds = new Set();
        for (const it of s.items) {
          if (!it || !ID.test(it.id || '')) { err(`An item in section "${s.id}" has no valid id.`); continue; }
          if (itemIds.has(it.id)) err(`Item id "${s.id}/${it.id}" appears twice.`);
          itemIds.add(it.id);
          if (!KNOWN_ITEM_TYPES.includes(it.type)) { unsupported++; continue; }
          if (!isStr(it.prompt)) err(`Item "${s.id}/${it.id}" has no prompt.`);
          if (it.type === 'mcq') {
            const ok = Array.isArray(it.options) && it.options.length >= 2 && it.options.length <= 8 && it.options.every(isStr);
            if (!ok) err(`Item "${s.id}/${it.id}" needs 2–8 text options.`);
            else if (!Number.isInteger(it.answer) || it.answer < 0 || it.answer >= it.options.length) {
              err(`Item "${s.id}/${it.id}" has an answer index outside its options.`);
            }
          }
        }
      });
    }
  }
  return { errors, warnings, unsupported };
}

function dataUrlToBlob(url) {
  const [, type, b64] = DATA_URL.exec(url);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function parsePackFile(file) {
  if (file.size > MAX_PACK_BYTES) throw new UserError(`"${file.name}" is larger than 40 MB. Split the chapter into smaller packs.`);
  let pack;
  try {
    pack = JSON.parse(await file.text());
  } catch {
    throw new UserError(`"${file.name}" is not valid JSON.`);
  }
  const result = validatePack(pack);
  if (result.errors.length) {
    throw new UserError(`"${file.name}": ${result.errors[0]}${result.errors.length > 1 ? ` (+${result.errors.length - 1} more problems)` : ''}`);
  }
  return { pack, ...result };
}

export async function quotaCheck(bytes) {
  if (!navigator.storage?.estimate) return { ok: true };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (!quota) return { ok: true };
  const remaining = quota - usage;
  return { ok: bytes < remaining * 0.8, remaining };
}

export async function existingChapter(pack) {
  const key = `${pack.book.id}/${pack.chapter.id}`;
  return withTx('chapters', 'readonly', (s) => reqP(s.chapters.get(key)));
}

// Replaces one chapter's content. Progress stores (reviews, log, reading, seen) are never touched.
export async function importPack(pack, unsupported) {
  const { book, chapter } = pack;
  const chapterKey = `${book.id}/${chapter.id}`;
  const blobs = Object.entries(pack.media || {}).map(([path, url]) => [`${chapterKey}/${path}`, dataUrlToBlob(url)]);

  const sections = chapter.sections.map((s, i) => ({
    id: s.id,
    title: s.title,
    order: Number.isFinite(s.order) ? s.order : i + 1,
    html: s.html,
    keyTerms: Array.isArray(s.keyTerms) ? s.keyTerms.filter((k) => k && isStr(k.term)) : [],
    summary: typeof s.summary === 'string' ? s.summary : '',
    tags: Array.isArray(s.tags) ? s.tags : [],
  })).sort((a, b) => a.order - b.order);

  const chapterOrder = Number.isFinite(chapter.order) ? chapter.order : Number(chapter.number) || 0;
  const items = [];
  sections.forEach((s, si) => {
    const src = chapter.sections.find((x) => x.id === s.id);
    (src.items || []).forEach((it, ii) => {
      if (!KNOWN_ITEM_TYPES.includes(it.type)) return;
      items.push({
        ...it,
        id: globalItemId(book.id, chapter.id, s.id, it.id),
        localId: it.id,
        bookId: book.id,
        chapterId: chapter.id,
        sectionId: s.id,
        chapterKey,
        sectionKey: `${chapterKey}/${s.id}`,
        sort: chapterOrder * 1e6 + si * 1e3 + ii,
      });
    });
  });

  const chapterRecord = {
    key: chapterKey,
    bookId: book.id,
    id: chapter.id,
    number: chapter.number,
    title: chapter.title,
    order: chapterOrder,
    sections,
    packId: pack.pack.id,
    packVersion: pack.pack.version,
    importedAt: new Date().toISOString(),
    unsupportedItems: unsupported,
    itemCount: items.length,
  };

  await withTx(['books', 'chapters', 'media', 'items'], 'readwrite', async (s) => {
    const prev = await reqP(s.books.get(book.id));
    await reqP(s.books.put({ ...prev, ...book, updatedAt: new Date().toISOString() }));
    await reqP(s.chapters.put(chapterRecord));
    await reqP(s.media.delete(prefixRange(chapterKey + '/')));
    for (const [key, blob] of blobs) await reqP(s.media.put(blob, key));
    const oldKeys = await reqP(s.items.index('chapterKey').getAllKeys(chapterKey));
    for (const k of oldKeys) await reqP(s.items.delete(k));
    for (const it of items) await reqP(s.items.put(it));
  });
  return chapterRecord;
}

// Removes a book's content but keeps all progress, so re-importing restores everything.
export async function removeBookContent(bookId) {
  await withTx(['books', 'chapters', 'media', 'items'], 'readwrite', async (s) => {
    const chapterKeys = await reqP(s.chapters.index('bookId').getAllKeys(bookId));
    for (const ck of chapterKeys) {
      await reqP(s.media.delete(prefixRange(ck + '/')));
      const itemKeys = await reqP(s.items.index('chapterKey').getAllKeys(ck));
      for (const k of itemKeys) await reqP(s.items.delete(k));
      await reqP(s.chapters.delete(ck));
    }
    await reqP(s.books.delete(bookId));
  });
}

export async function requestPersistence() {
  if (!navigator.storage?.persist) return null;
  const granted = await navigator.storage.persist();
  await setSetting('persistRequested', true);
  return granted;
}

export async function ensurePersistenceOnce() {
  if (await getSetting('persistRequested', false)) return;
  await requestPersistence();
}
