// The only place that turns pack HTML into markup. Everything passes DOMPurify with a strict allowlist.

import DOMPurify from '../vendor/purify.es.mjs';

export const ALLOWED_TAGS = [
  'p', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'sub', 'sup',
  'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'img', 'figcaption', 'blockquote', 'a', 'span', 'br',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'id'];

const MEDIA_PATH = /^media\/[A-Za-z0-9._-]+$/;

// Hooks run inside DOMPurify's inert document, so no image request is ever made for pack src values.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'IMG') {
    const src = node.getAttribute('src') || '';
    node.removeAttribute('src');
    // Anything not in the pack's own media/ folder (remote URLs, tracking pixels) never loads.
    if (MEDIA_PATH.test(src)) node.setAttribute('data-media', src);
    return;
  }
  if (node.nodeName === 'A') {
    const href = node.getAttribute('href') || '';
    node.removeAttribute('href');
    if (href.startsWith('#') && href.length > 1) {
      // In-page anchors would clash with the hash router; the reader scrolls instead.
      node.setAttribute('data-anchor', href.slice(1));
    } else if (/^https?:\/\//i.test(href)) {
      node.setAttribute('href', href);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

export function sanitizeSection(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    SANITIZE_NAMED_PROPS: true, // ids become "user-content-…", so content can't clobber app globals
    RETURN_DOM_FRAGMENT: false,
  });
}

export const ANCHOR_PREFIX = 'user-content-';
