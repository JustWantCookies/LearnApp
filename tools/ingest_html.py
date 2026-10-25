#!/usr/bin/env python3
"""Fallback: a locally saved web chapter (HTML + its images) → one content pack.

Save the chapter page once into content/sources/ (e.g. "Save Page As…, complete"), then:

  python3 tools/ingest_html.py content/sources/ch19.html --book tools/books/<book>.json \
      --chapter 19 --title "The Cardiovascular System: The Heart"

The page is split into sections at <h2>. This tool never downloads anything.
"""
from __future__ import annotations

import argparse
import json
import posixpath
import sys
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_epub import generic_sections  # noqa: E402
from packlib import REPO, MediaCollector, PackError, check_license, load_items_file, merge_items, write_pack  # noqa: E402
from validate_pack import validate_file  # noqa: E402


class LocalFiles:
    """Reads the HTML and its images from disk; refuses paths outside the page's folder."""

    def __init__(self, html_path: Path):
        self.root = html_path.parent.resolve()

    def _path(self, name: str) -> Path | None:
        p = (self.root / name).resolve()
        return p if self.root in p.parents or p == self.root else None

    def read(self, name: str) -> bytes | None:
        p = self._path(name)
        return p.read_bytes() if p and p.is_file() else None

    def soup(self, name: str) -> BeautifulSoup:
        return BeautifulSoup(self.read(name) or b"", "html.parser")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("html")
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", type=int, required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--version", type=int, default=1)
    ap.add_argument("--items")
    ap.add_argument("--out", default=str(REPO / "content" / "packs"))
    args = ap.parse_args()

    try:
        book = json.loads(Path(args.book).read_text("utf-8"))
        check_license(book)
        html_path = Path(args.html)
        src = LocalFiles(html_path)
        media = MediaCollector(src.read)
        sections = generic_sections(src, html_path.name, args.chapter, media)
        if not sections:
            raise PackError("No content found.")
        chapter_id = f"ch{args.chapter}"
        pack_id = f"{book['id']}-{chapter_id}"
        items_path = Path(args.items) if args.items else Path(args.out).parent / "items" / f"{pack_id}.items.json"
        generated = load_items_file(items_path)
        for s in sections:
            s["items"] = merge_items(s.pop("extracted"), generated.get(s["id"], []))
            if not s["summary"]:
                del s["summary"]
        pack = {"schema": 1, "pack": {"id": pack_id, "version": args.version}, "book": book,
                "chapter": {"id": chapter_id, "number": args.chapter, "title": args.title, "order": args.chapter, "sections": sections}}
        out = write_pack(pack, media, Path(args.out))
    except PackError as e:
        sys.exit(f"error: {e}")
    print(f"Wrote {out} ({len(sections)} sections, {len(media.files)} images)")
    problems = validate_file(out)
    if problems:
        print("Validation FAILED:", *problems, sep="\n  - ")
        sys.exit(1)
    print("Validation passed.")


if __name__ == "__main__":
    main()
