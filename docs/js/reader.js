// Reader: one section per page, lazy figures from IndexedDB blobs, position saved on scroll.

import { h, clear, hrefFor } from './dom.js';
import { get, getAllByIndex } from './db.js';
import { sanitizeSection, ANCHOR_PREFIX } from './sanitize.js';
import { markSeen, saveReading } from './progress.js';
import { navigate } from './router.js';

export async function readerView(root, { bookId, chapterId, sectionId }, isCurrent) {
  const [book, chapters, reading] = await Promise.all([
    get('books', bookId), getAllByIndex('chapters', 'bookId', bookId), get('reading', bookId),
  ]);
  chapters.sort((a, b) => a.order - b.order);
  const chapter = chapters.find((c) => c.id === chapterId);
  const section = chapter?.sections.find((s) => s.id === sectionId);
  if (!isCurrent()) return;
  clear(root);

  if (!book || !section) {
    root.append(h('div', { class: 'card empty' },
      h('p', {}, 'This section is not available. The pack may have been removed or updated.'),
      h('p', {}, h('a', { href: '#/library' }, 'Go to Library'))));
    return;
  }

  // Flat reading order across all imported chapters of the book.
  const flat = chapters.flatMap((c) => c.sections.map((s) => ({ c, s })));
  const idx = flat.findIndex((x) => x.c.id === chapterId && x.s.id === sectionId);
  const prev = flat[idx - 1];
  const next = flat[idx + 1];
  const sectionKey = `${chapter.key}/${section.id}`;
  const mcqCount = (await getAllByIndex('items', 'sectionKey', sectionKey)).filter((i) => i.type === 'mcq').length;
  if (!isCurrent()) return;

  await markSeen(sectionKey);

  const article = h('article', { class: 'reader', lang: book.language || 'en' });
  article.innerHTML = sanitizeSection(section.html);
  for (const table of article.querySelectorAll('table')) {
    const wrap = h('div', { class: 'table-wrap' });
    table.replaceWith(wrap);
    wrap.append(table);
  }
  article.prepend(h('h1', {}, section.title));
  if (section.keyTerms.length) {
    article.append(h('section', { class: 'keyterms' },
      h('h3', {}, 'Key terms'),
      h('dl', {}, section.keyTerms.flatMap((k) => [h('dt', {}, k.term), h('dd', {}, k.definition || '')]))));
  }

  const navBtn = (target, label) => target
    ? h('a', { class: 'btn', href: hrefFor('read', bookId, target.c.id, target.s.id) }, h('span', {}, label))
    : h('span', { class: 'btn', 'aria-disabled': 'true' }, h('span', { class: 'muted' }, label));

  const end = h('div', { class: 'reader-end' },
    mcqCount
      ? h('a', { class: 'big-action', href: hrefFor('quiz', 'section', bookId, chapterId, sectionId) },
          h('span', { class: 'label' }, 'Done reading?'),
          `Quiz me on this section (${mcqCount} question${mcqCount === 1 ? '' : 's'})`)
      : null,
    h('div', { class: 'reader-nav' }, navBtn(prev, '‹ Previous'), navBtn(next, 'Next ›')),
    h('p', { class: 'attribution' }, `${book.title} — ${book.license}. `, h('a', { href: hrefFor('about', bookId) }, 'Attribution')));

  root.append(
    h('div', { class: 'reader-top' },
      h('a', { class: 'icon-btn', href: hrefFor('book', bookId), 'aria-label': 'Table of contents' }, '‹'),
      h('span', { class: 'crumb' }, `${chapter.title}`)),
    article, end);

  const disposers = [];
  disposers.push(loadFigures(article, chapter.key));
  disposers.push(setupAnchors(article));
  disposers.push(setupSwipe(article, prev, next, bookId));

  // ---- Reading position ----
  const ratio = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  };
  const save = () => saveReading(bookId, chapterId, sectionId, ratio()).catch(() => {});
  let timer;
  const onScroll = () => { clearTimeout(timer); timer = setTimeout(save, 400); };
  const onVis = () => { if (document.visibilityState === 'hidden') save(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVis);

  const restore = reading && reading.chapterId === chapterId && reading.sectionId === sectionId ? reading.scrollRatio : 0;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, restore * max);
    save();
  });

  return () => {
    clearTimeout(timer);
    save();
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVis);
    disposers.forEach((d) => d());
  };
}

// ---------- Figures ----------

function loadFigures(article, chapterKey) {
  const urls = [];
  const load = async (img) => {
    const blob = await get('media', `${chapterKey}/${img.dataset.media}`);
    if (!blob) { img.alt = img.alt || 'Image missing from pack'; return; }
    const url = URL.createObjectURL(blob);
    urls.push(url);
    img.src = url;
  };
  const imgs = [...article.querySelectorAll('img[data-media]')];
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          load(e.target);
        }
      }, { rootMargin: '800px 0px' })
    : null;
  for (const img of imgs) {
    img.decoding = 'async';
    if (io) io.observe(img); else load(img);
    img.addEventListener('click', () => { if (img.src) openZoom(img.src, img.alt); });
  }
  return () => {
    io?.disconnect();
    // Delay so a zoom overlay that is still closing keeps its image.
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
  };
}

function openZoom(src, alt) {
  const img = h('img', { src, alt: alt || '' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'zoom-overlay', role: 'dialog', 'aria-label': 'Figure' },
    h('button', { type: 'button', class: 'zoom-close', 'aria-label': 'Close', onclick: close }, '✕'), img);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  setupPinch(overlay, img, close);
}

// Pinch-zoom and pan with Pointer Events; double-tap toggles 2.5×; a tap at 1× closes.
function setupPinch(overlay, img, close) {
  let scale = 1, tx = 0, ty = 0;
  const pts = new Map();
  let start = null;
  let lastTap = 0;
  let moved = false;

  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const base = () => {
    // Center the scaled image's origin (top-left) inside the overlay.
    const r = img.getBoundingClientRect();
    return { left: r.left - tx, top: r.top - ty };
  };
  const zoomAt = (cx, cy, newScale) => {
    const b = base();
    const px = (cx - b.left - tx) / scale;
    const py = (cy - b.top - ty) / scale;
    scale = Math.min(6, Math.max(1, newScale));
    tx = cx - b.left - px * scale;
    ty = cy - b.top - py * scale;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  };

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom-close')) return;
    overlay.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    start = snapshot();
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = snapshot();
    if (!start) return;
    if (now.n === 2 && start.n === 2) {
      zoomAt(now.cx, now.cy, start.scale * (now.dist / start.dist));
      moved = true;
    } else if (now.n === 1 && start.n === 1 && scale > 1) {
      tx = start.tx + (now.cx - start.cx);
      ty = start.ty + (now.cy - start.cy);
      apply();
      moved = true;
    } else if (now.n === 1 && Math.hypot(now.cx - start.cx, now.cy - start.cy) > 10) {
      moved = true;
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && !moved && e.type === 'pointerup') {
      const t = Date.now();
      if (t - lastTap < 300) { zoomAt(e.clientX, e.clientY, scale > 1 ? 1 : 2.5); lastTap = 0; }
      else {
        lastTap = t;
        setTimeout(() => { if (lastTap === t && scale === 1) close(); }, 320);
      }
    }
    start = pts.size ? snapshot() : null;
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  function snapshot() {
    const p = [...pts.values()];
    const cx = p.reduce((a, q) => a + q.x, 0) / (p.length || 1);
    const cy = p.reduce((a, q) => a + q.y, 0) / (p.length || 1);
    const dist = p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 : 1;
    return { n: p.length, cx, cy, dist, scale, tx, ty };
  }
}

// ---------- In-section anchors ("see Figure 1.2") ----------

function setupAnchors(article) {
  const onClick = (e) => {
    const a = e.target.closest('a[data-anchor]');
    if (!a) return;
    e.preventDefault();
    const target = article.querySelector(`[id="${CSS.escape(ANCHOR_PREFIX + a.dataset.anchor)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  article.addEventListener('click', onClick);
  return () => article.removeEventListener('click', onClick);
}

// ---------- Swipe left/right for next/previous ----------

function setupSwipe(el, prev, next, bookId) {
  let sx = 0, sy = 0, st = 0, active = false;
  const onStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest('.table-wrap')) { active = false; return; }
    active = true;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  };
  const onEnd = (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st > 600 || Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
    const target = dx < 0 ? next : prev;
    if (target) navigate(hrefFor('read', bookId, target.c.id, target.s.id));
  };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchend', onEnd, { passive: true });
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchend', onEnd);
  };
}
