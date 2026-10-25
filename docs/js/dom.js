// Small DOM helpers. All text goes through textContent; only sanitize.js produces HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

export function hrefFor(...parts) {
  return '#/' + parts.map((p) => encodeURIComponent(p)).join('/');
}

let toastTimer;
export function toast(message, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Converts any thrown value into a sentence suitable for the UI.
export function errorMessage(err) {
  if (err && err.userMessage) return err.userMessage;
  if (err && err.name === 'QuotaExceededError') return 'Storage is full. Remove a book or free up space on the device.';
  return 'Something went wrong. Please try again.';
}

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.userMessage = message;
  }
}

// Saves a file: share sheet on iOS (so it can go to Files / iCloud Drive), download link elsewhere.
export async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export function pickFiles({ accept, multiple = false }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, hidden: true });
    const done = (files) => { resolve(files); input.remove(); };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}
