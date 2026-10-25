# Vendored libraries

Copied in by hand, never loaded from a CDN. Verify with `shasum -a 256 docs/vendor/*`.

| File | Library | Version | Source | SHA-256 |
|---|---|---|---|---|
| `purify.es.mjs` | DOMPurify | 3.4.16 | npm `dompurify@3.4.16`, `dist/purify.es.mjs` (source-map comment removed) | `9c52577e368cdc6f3fb2bc87de222c8139e30655eef54a2bebde6d4b0a85ccb8` |

License: Apache-2.0 / MPL-2.0, see `DOMPurify-LICENSE`.

To upgrade: `npm pack dompurify@<version>`, copy `package/dist/purify.es.mjs`, delete the last `sourceMappingURL` line, update the hash above, bump `CACHE` in `sw.js`.
