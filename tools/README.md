# Ingestion tools (desktop only)

```bash
pip install beautifulsoup4 pillow jsonschema
```

Keep sources, packs and generated questions **outside the repo**, e.g. in `../../Content/`:

```
Content/
  Anatomy-amp-Physiology-2e-….epub
  packs/   osu-ap2e-ch1-v1.json …           ← AirDrop these to the phone
  items/   osu-ap2e-ch1.items.json …        ← generated questions, one file per chapter
```

(If you use the repo's own `content/` folder instead, it is gitignored too.)

## 1. Describe the book

Write `tools/books/<book-id>.json` with the id, title, authors, license, licenseUrl, sourceUrl and attribution. This is metadata only, so it is safe to commit. The tools refuse a book that has no license or attribution, and any ND license.

## 2. Build a chapter pack

```bash
python3 tools/ingest_epub.py ../../Content/BOOK.epub --book tools/books/osu-ap2e.json --list
```

```bash
python3 tools/ingest_epub.py ../../Content/BOOK.epub --book tools/books/osu-ap2e.json --chapter 19 --out ../../Content/packs
```

What it does, for Pressbooks EPUBs (each `part-*` file is a chapter, each `chapter-*` file a section):

- Section ids come from the book's numbering (`1.2 …` → `s1.2`).
- HTML is reduced to the allowed tags. Learning-objective and summary boxes become titled blockquotes.
- The "Glossary" list becomes `keyTerms`, and "Chapter Review" text becomes the section `summary` (used as the reference in the review sheet).
- "Critical Thinking Questions" become `explain` items `ct1, ct2, …`, with the book's answer as `reference`.
- H5P quizzes and "Review Questions" (interactive only) are removed. "Interactive content" boxes become a single online link.
- Images are converted to WebP (max 1200 px, quality 80) and embedded. Covers and logos are skipped.
- The pack is validated against `schema/pack.schema.json`.

Other EPUBs fall back to one document per chapter, split at `<h2>`. For a locally saved web page, use `tools/ingest_html.py` (it never downloads anything).

## 3. Generate questions (Claude Code)

Ask Claude Code: *"Read section s19.3 of `../../Content/packs/osu-ap2e-ch19-v1.json` and write questions into `../../Content/items/osu-ap2e-ch19.items.json`."*

Format:

```json
{ "packId": "osu-ap2e-ch19", "sections": {
  "s19.3": [
    { "id": "q1", "type": "mcq", "prompt": "…", "options": ["…", "…", "…", "…"], "answer": 0, "explanation": "…" },
    { "id": "e1", "type": "explain", "prompt": "…", "rubric": ["…", "…"] }
  ] } }
```

Rules:

- 3–6 `mcq` per section, answerable from that section alone, with plausible distractors and no "all of the above".
- Every explanation refers to the section text.
- Ids are stable. When regenerating, **append** new ids and never renumber, because progress on the phone is keyed by id.

Then re-run step 2. Questions are merged into the pack.

## 4. Validate and transfer

```bash
python3 tools/validate_pack.py ../../Content/packs/*.json
```

AirDrop the `.json` file to the iPhone (Save to Files), then **Library → Import pack**. Re-importing a newer version keeps all progress. Bump `--version` when you re-issue a pack.

## Other scripts

- `make_sample_pack.py` rebuilds `docs/sample/sample-pack.json` (own text, safe to commit).
- `make_icons.py` redraws `docs/icons/`.
