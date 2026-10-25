import { h, clear, hrefFor, toast, errorMessage, pickFiles, UserError } from '../dom.js';
import { getAll } from '../db.js';
import { parsePackFile, importPack, quotaCheck, existingChapter, ensurePersistenceOnce } from '../packs.js';

export async function libraryView(root, params, isCurrent) {
  const [books, chapters] = await Promise.all([getAll('books'), getAll('chapters')]);
  if (!isCurrent()) return;
  clear(root);

  const status = h('p', { class: 'small muted', role: 'status' });
  const importBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => onImport(status, importBtn) }, 'Import pack (.json)');

  root.append(h('h1', { class: 'page-title' }, 'Library'));

  if (books.length === 0) {
    root.append(h('div', { class: 'card empty' },
      h('p', {}, 'No books yet.'),
      h('p', { class: 'small' }, 'Import a chapter pack from the Files app, or try the small sample pack.'),
      h('button', { type: 'button', class: 'btn', onclick: () => onSample(status) }, 'Load sample pack')));
  } else {
    books.sort((a, b) => a.title.localeCompare(b.title));
    const list = h('ul', { class: 'list' });
    for (const b of books) {
      const n = chapters.filter((c) => c.bookId === b.id).length;
      list.append(h('li', {}, h('a', { href: hrefFor('book', b.id) },
        h('span', { class: 'grow' },
          h('span', { class: 'title' }, b.title),
          h('span', { class: 'meta' }, `${n} chapter${n === 1 ? '' : 's'} · ${b.license}`)),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))));
    }
    root.append(list);
  }

  root.append(h('h2', { class: 'section-title' }, 'Add content'), importBtn, status);
}

async function onImport(status, btn) {
  const files = await pickFiles({ accept: '.json,application/json', multiple: true });
  if (!files.length) return;
  btn.disabled = true;
  const lines = [];
  for (const file of files) {
    status.textContent = `Importing ${file.name}…`;
    try {
      lines.push(await importOne(file));
    } catch (err) {
      if (!err.userMessage) console.error(err);
      lines.push(errorMessage(err));
    }
  }
  btn.disabled = false;
  status.textContent = lines.join(' ');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  toast(lines.join(' '), 5000);
}

async function importOne(file) {
  const { pack, warnings, unsupported } = await parsePackFile(file);

  const quota = await quotaCheck(file.size);
  if (!quota.ok && !confirm(`"${file.name}" would use more than 80% of the remaining storage. Import anyway?`)) {
    throw new UserError(`Skipped "${file.name}".`);
  }

  const prev = await existingChapter(pack);
  if (prev && prev.packVersion > pack.pack.version &&
      !confirm(`You already have version ${prev.packVersion} of "${pack.chapter.title}". Replace it with older version ${pack.pack.version}?`)) {
    throw new UserError(`Kept the newer "${pack.chapter.title}".`);
  }

  const rec = await importPack(pack, unsupported);
  await ensurePersistenceOnce();
  if (warnings.length) console.warn(file.name, warnings);
  const verb = prev ? 'Updated' : 'Imported';
  return `${verb} "${rec.title}" (${rec.sections.length} sections, ${rec.itemCount} questions).`;
}

async function onSample(status) {
  try {
    status.textContent = 'Loading sample…';
    const res = await fetch('sample/sample-pack.json');
    if (!res.ok) throw new UserError('The sample pack could not be loaded. Are you online?');
    const file = new File([await res.blob()], 'sample-pack.json', { type: 'application/json' });
    toast(await importOne(file));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (err) {
    status.textContent = errorMessage(err);
  }
}
