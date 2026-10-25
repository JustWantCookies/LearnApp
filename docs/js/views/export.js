import { h, clear, toast, saveFile, errorMessage } from '../dom.js';
import { gatherReviewSheet } from '../exportImport.js';

// The sheet is built before any tap, so the Copy button can call the clipboard
// synchronously inside the gesture (iOS Safari requires that).
export async function exportView(root, params, isCurrent) {
  const { text, today, count } = await gatherReviewSheet();
  if (!isCurrent()) return;
  clear(root);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. Paste it into a Claude chat.');
    } catch {
      toast('Copy failed. Select the text below and copy it manually.');
    }
  };
  const download = async () => {
    try {
      await saveFile(`review-${today}.md`, text, 'text/markdown');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  root.append(
    h('div', { class: 'reader-top' },
      h('a', { class: 'icon-btn', href: '#/today', 'aria-label': 'Back' }, '‹'),
      h('span', { class: 'crumb' }, 'Today')),
    h('h1', { class: 'page-title' }, 'Review sheet'),
    h('p', { class: 'muted small' },
      `${count} explanation prompt${count === 1 ? '' : 's'}. Paste into Claude, switch to voice, explain each prompt, then ask for the JSON. Import it under Settings → Import grades.`),
    h('div', { class: 'stack' },
      h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: copy }, 'Copy to clipboard'),
      h('button', { type: 'button', class: 'btn btn-block', onclick: download }, `Save review-${today}.md`),
      h('pre', { class: 'code-preview' }, text)));
}
