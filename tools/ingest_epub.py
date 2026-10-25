#!/usr/bin/env python3
"""EPUB → one content pack (JSON) per chapter.

  python3 tools/ingest_epub.py BOOK.epub --book tools/books/osu-ap2e.json --list
  python3 tools/ingest_epub.py BOOK.epub --book tools/books/osu-ap2e.json --chapter 1

Understands Pressbooks EPUBs (part-* files are chapters, chapter-* files are sections) and falls back
to "one spine document per chapter, split at <h2>" for other books.
"""
from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from packlib import (REPO, MediaCollector, PackError, anchor_targets, check_license, clean_fragment,  # noqa: E402
                     load_items_file, merge_items, new_tag, text_of, write_pack)
from validate_pack import validate_file  # noqa: E402

NS = {"c": "urn:oasis:names:tc:opendocument:xmlns:container", "opf": "http://www.idpf.org/2007/opf"}
DROP_BOX_TITLES = re.compile(r"^(review questions?|interactive link questions?)$", re.I)
CRITICAL_TITLES = re.compile(r"^critical thinking questions?$", re.I)
SUMMARY_TITLES = re.compile(r"^chapter review$", re.I)


class Epub:
    def __init__(self, path: Path):
        self.zip = zipfile.ZipFile(path)
        container = ET.fromstring(self.zip.read("META-INF/container.xml"))
        self.opf_path = container.find(".//c:rootfile", NS).get("full-path")
        opf = ET.fromstring(self.zip.read(self.opf_path))
        base = posixpath.dirname(self.opf_path)
        manifest = {i.get("id"): posixpath.normpath(posixpath.join(base, i.get("href")))
                    for i in opf.find("opf:manifest", NS)}
        self.spine = [manifest[r.get("idref")] for r in opf.find("opf:spine", NS)
                      if r.get("idref") in manifest]

    def read(self, name: str) -> bytes | None:
        try:
            return self.zip.read(name)
        except KeyError:
            return None

    def soup(self, name: str) -> BeautifulSoup:
        return BeautifulSoup(self.read(name), "html.parser")


# ---------------------------------------------------------------- chapter discovery

def discover(epub: Epub) -> list[dict]:
    """Returns [{number, title, docs: [...]}]."""
    chapters: list[dict] = []
    pressbooks = any(posixpath.basename(d).startswith("part-") for d in epub.spine)
    if pressbooks:
        current = None
        for doc in epub.spine:
            name = posixpath.basename(doc)
            if name.startswith("part-"):
                title = text_of(epub.soup(doc).find(class_="part-title") or epub.soup(doc).find("h1"))
                m = re.match(r"^(\d+)\.?\s+(.*)$", title)
                current = {"number": int(m.group(1)) if m else len(chapters) + 1, "title": title, "docs": [], "mode": "pressbooks"}
                chapters.append(current)
            elif name.startswith("chapter-") and current is not None:
                current["docs"].append(doc)
            elif not name.startswith("chapter-"):
                current = None  # back matter etc.
    else:
        for doc in epub.spine:
            s = epub.soup(doc)
            h1 = s.find("h1")
            if not h1 or not s.find("h2"):
                continue
            chapters.append({"number": len(chapters) + 1, "title": text_of(h1), "docs": [doc], "mode": "generic"})
    return chapters


# ---------------------------------------------------------------- Pressbooks sections

def pressbooks_section(epub: Epub, doc: str, chapter_no: int, index: int, media: MediaCollector) -> dict:
    s = epub.soup(doc)
    raw_title = text_of(s.find(class_="chapter-title") or s.find("h1"))
    m = re.match(r"^(\d+)\.(\d+)\s+(.*)$", raw_title)
    sid = f"s{m.group(1)}.{m.group(2)}" if m else f"s{chapter_no}.x{index}"
    body = s.find(class_="chapter-ugc") or s.body

    key_terms = []
    for det in body.find_all("details"):
        summ = det.find("summary")
        if summ and text_of(summ).lower() == "glossary":
            for dt in det.find_all("dt"):
                dd = dt.find_next_sibling("dd")
                key_terms.append({"term": text_of(dt), "definition": text_of(dd) if dd else ""})
            det.decompose()

    for el in body.find_all(class_=re.compile(r"^h5p-")):
        if el.parent is not None:
            el.decompose()

    summary = ""
    explains = []
    for box in body.find_all("div", class_="textbox"):
        if box.parent is None:
            continue
        classes = box.get("class", [])
        header = box.find(class_="textbox__header") or box.find("header")
        title_el = box.find(class_="textbox__title") or (header.find(["h1", "h2", "h3"]) if header else None)
        title = text_of(title_el) if title_el else ""
        content = box.find(class_="textbox__content") or box

        if "interactive-content" in classes:
            link = next((a["href"] for a in box.find_all("a", href=True) if a["href"].startswith("https://")), None)
            if link:
                p = new_tag("p")
                a = new_tag("a", href=link)
                a.string = "Interactive content (opens online)"
                p.append(a)
                box.replace_with(p)
            else:
                box.decompose()
            continue
        if DROP_BOX_TITLES.match(title):
            box.decompose()
            continue
        if CRITICAL_TITLES.match(title):
            for p in content.find_all("p", recursive=False):
                det = p.find_next_sibling()
                answer = text_of(det.find("article") or det) if det is not None and det.name == "details" else ""
                prompt = text_of(p)
                if prompt:
                    item = {"id": f"ct{len(explains) + 1}", "type": "explain", "prompt": prompt}
                    if answer:
                        item["reference"] = answer
                    explains.append(item)
            box.decompose()
            continue
        if SUMMARY_TITLES.match(title):
            summary = text_of(content)

        # Everything else (objectives, examples, summaries, career boxes) → a titled blockquote.
        quote = new_tag("blockquote")
        if title:
            p = new_tag("p")
            strong = new_tag("strong")
            strong.string = title
            p.append(strong)
            quote.append(p)
        for child in list(content.contents):
            quote.append(child.extract())
        box.replace_with(quote)

    doc_dir = posixpath.dirname(doc)
    html = clean_fragment(body, media, lambda src: posixpath.normpath(posixpath.join(doc_dir, src)),
                          keep_ids=anchor_targets(body))
    return {"id": sid, "title": raw_title, "order": index + 1, "html": html, "summary": summary,
            "keyTerms": key_terms, "extracted": explains}


# ---------------------------------------------------------------- generic sections (split at h2)

def generic_sections(source, doc: str, chapter_no: int, media: MediaCollector) -> list[dict]:
    """Splits one document at its <h2> headings. `source` needs .soup(name); images resolve relative to doc."""
    body = source.soup(doc).body
    for h1 in body.find_all("h1"):
        h1.decompose()
    doc_dir = posixpath.dirname(doc)
    resolve = lambda src: posixpath.normpath(posixpath.join(doc_dir, src))  # noqa: E731

    groups: list[tuple[str | None, list]] = []
    h2s = body.find_all("h2")
    intro = []
    for el in list(h2s[0].previous_siblings)[::-1] if h2s else []:
        intro.append(el)
    if intro and any(text_of(e) if hasattr(e, "get_text") else str(e).strip() for e in intro):
        groups.append((None, intro))
    for h2 in h2s:
        nodes = []
        for sib in h2.next_siblings:
            if getattr(sib, "name", None) == "h2" or (hasattr(sib, "find") and sib.find("h2")):
                break
            nodes.append(sib)
        groups.append((text_of(h2), nodes))

    sections = []
    for title, nodes in groups:
        wrap = new_tag("div")
        for el in nodes:
            wrap.append(el.extract())
        n = len(sections)
        m = re.match(r"^(\d+)\.(\d+)\s+", title or "")
        sid = f"s{m.group(1)}.{m.group(2)}" if m else f"s{chapter_no}.{n}"
        html = clean_fragment(wrap, media, resolve, keep_ids=anchor_targets(wrap))
        sections.append({"id": sid, "title": title or "Introduction", "order": n + 1, "html": html,
                         "summary": "", "keyTerms": [], "extracted": []})
    return sections


# ---------------------------------------------------------------- main

def build(args) -> Path:
    book = json.loads(Path(args.book).read_text("utf-8"))
    check_license(book)
    epub = Epub(Path(args.epub))
    chapters = discover(epub)
    if args.list:
        for ch in chapters:
            print(f"{ch['number']:>3}  {ch['title']}  ({len(ch['docs'])} documents)")
        sys.exit(0)

    ch = next((c for c in chapters if c["number"] == args.chapter), None)
    if not ch:
        raise PackError(f"Chapter {args.chapter} not found. Use --list to see chapters.")

    media = MediaCollector(epub.read)
    if ch["mode"] == "pressbooks":
        sections = [pressbooks_section(epub, d, ch["number"], i, media) for i, d in enumerate(ch["docs"])]
    else:
        sections = generic_sections(epub, ch["docs"][0], ch["number"], media)

    chapter_id = f"ch{ch['number']}"
    pack_id = f"{book['id']}-{chapter_id}"
    items_path = Path(args.items) if args.items else Path(args.out).parent / "items" / f"{pack_id}.items.json"
    generated = load_items_file(items_path)

    seen_ids = set()
    for s in sections:
        if s["id"] in seen_ids:
            raise PackError(f"Duplicate section id {s['id']} — check the book's numbering.")
        seen_ids.add(s["id"])
        s["items"] = merge_items(s.pop("extracted"), generated.get(s["id"], []))
        if not s["summary"]:
            del s["summary"]

    pack = {
        "schema": 1,
        "pack": {"id": pack_id, "version": args.version},
        "book": book,
        "chapter": {"id": chapter_id, "number": ch["number"], "title": ch["title"], "order": ch["number"], "sections": sections},
    }
    out = write_pack(pack, media, Path(args.out))
    n_items = sum(len(s["items"]) for s in sections)
    print(f"Wrote {out}  ({out.stat().st_size / 1e6:.1f} MB, {len(sections)} sections, {len(media.files)} images, {n_items} items)")
    if not items_path.exists():
        print(f"No generated questions yet. Write them to {items_path} and re-run (see tools/README.md).")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("epub")
    ap.add_argument("--book", required=True, help="book metadata JSON (license, attribution …)")
    ap.add_argument("--chapter", type=int)
    ap.add_argument("--list", action="store_true", help="list chapters and exit")
    ap.add_argument("--version", type=int, default=1, help="pack version (bump when re-issuing)")
    ap.add_argument("--items", help="generated questions JSON (default: <out>/../items/<pack-id>.items.json)")
    ap.add_argument("--out", default=str(REPO / "content" / "packs"), help="output folder (default: content/packs, gitignored)")
    args = ap.parse_args()
    if not args.list and args.chapter is None:
        ap.error("--chapter is required (or use --list)")
    try:
        out = build(args)
    except PackError as e:
        sys.exit(f"error: {e}")
    problems = validate_file(out)
    if problems:
        print("Validation FAILED:")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("Validation passed.")


if __name__ == "__main__":
    main()
