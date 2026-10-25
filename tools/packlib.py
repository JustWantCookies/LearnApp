"""Shared helpers for the ingestion tools: HTML cleaning, image conversion, item merging, pack writing."""
from __future__ import annotations

import base64
import io
import json
import re
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup, Comment, Tag
from PIL import Image

REPO = Path(__file__).resolve().parent.parent

# Must match docs/js/sanitize.js (spec §5.1, plus <caption> for table titles).
ALLOWED_TAGS = {
    "p", "h3", "h4", "ul", "ol", "li", "strong", "em", "sub", "sup",
    "table", "caption", "thead", "tbody", "tr", "th", "td",
    "figure", "img", "figcaption", "blockquote", "a", "span", "br",
}
ALLOWED_ATTRS = {
    "a": {"href"},
    "img": {"src", "alt", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}
ID_ATTR_TAGS = {"figure", "table", "h3", "h4", "p", "li", "span"}
RENAME = {"b": "strong", "i": "em", "u": "em", "h1": "h3", "h2": "h3", "h3": "h4", "h5": "h4", "h6": "h4"}
DROP_WITH_CONTENT = {"script", "style", "nav", "iframe", "object", "embed", "form", "input", "button",
                     "svg", "math", "audio", "video", "noscript", "col", "colgroup", "head", "title", "meta", "link"}

MAX_IMAGE_WIDTH = 1200
WEBP_QUALITY = 80
PACK_TARGET_BYTES = 10 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


class PackError(Exception):
    pass


def check_license(book: dict) -> None:
    lic = (book.get("license") or "").strip()
    if not lic:
        raise PackError("book.license is required; refusing to build a pack without a license.")
    if re.search(r"\bND\b", lic, re.I):
        raise PackError(f'License "{lic}" forbids derivatives (ND); splitting/cleaning is adaptation. Refusing.')
    if not (book.get("attribution") or "").strip():
        raise PackError("book.attribution is required (the license demands attribution).")


def slug(text: str, maxlen: int = 60) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", text).strip("-._")
    return (s or "img")[:maxlen]


_FACTORY = BeautifulSoup("", "html.parser")


def new_tag(name: str, **attrs) -> Tag:
    return _FACTORY.new_tag(name, attrs=attrs)


def text_of(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()


# ---------------------------------------------------------------- images

class MediaCollector:
    """Converts images to WebP once and hands out stable media/ paths."""

    def __init__(self, read_bytes):
        self.read_bytes = read_bytes  # callable(src_path) -> bytes | None
        self.files: dict[str, bytes] = {}
        self.by_source: dict[str, tuple[str, int, int]] = {}

    def add(self, src: str):
        if src in self.by_source:
            return self.by_source[src]
        name = Path(src).name
        if re.search(r"(^|[_\-. ])(cover|logo)s?([_\-. ]|$)", name, re.I):
            return None  # publisher logos and covers are not under the CC license
        data = self.read_bytes(src)
        if data is None:
            return None
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
        except Exception:
            return None
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "transparency" in im.info or im.mode in ("LA", "PA", "P") else "RGB")
        if im.width > MAX_IMAGE_WIDTH:
            h = round(im.height * MAX_IMAGE_WIDTH / im.width)
            im = im.resize((MAX_IMAGE_WIDTH, h), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=WEBP_QUALITY, method=6)
        path = f"media/{slug(Path(name).stem)}.webp"
        base, n = path[:-5], 2
        while path in self.files:
            path = f"{base}-{n}.webp"
            n += 1
        self.files[path] = buf.getvalue()
        self.by_source[src] = (path, im.width, im.height)
        return self.by_source[src]

    def data_urls(self) -> dict[str, str]:
        return {p: "data:" + "image/webp;base64," + base64.b64encode(b).decode("ascii") for p, b in self.files.items()}


# ---------------------------------------------------------------- HTML cleaning

def clean_fragment(root: Tag, media: MediaCollector, resolve_src, keep_ids: set[str] | None = None) -> str:
    """Reduces arbitrary XHTML to the allowed tag list. Returns an HTML string."""
    for c in root.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()
    for el in root.find_all(list(DROP_WITH_CONTENT)):
        el.decompose()

    # Images: convert + rewrite src; drop images we can't (or mustn't) carry.
    for img in root.find_all("img"):
        res = media.add(resolve_src(img.get("src", "")))
        if not res:
            img.decompose()
            continue
        path, w, h = res
        alt = img.get("alt", "")
        img.attrs = {"src": path, "alt": alt, "width": str(w), "height": str(h)}

    for fig in root.find_all("figure"):
        if not fig.find("img") and not fig.find("table"):
            fig.decompose()

    # <details> (reveal answers) and definition lists become plain blocks.
    for summary in root.find_all("summary"):
        label = new_tag("p")
        em = new_tag("em")
        em.string = "Answer:"
        label.append(em)
        summary.replace_with(label)
    for dl in root.find_all("dl"):
        for dt in dl.find_all("dt"):
            dt.name = "p"
            strong = new_tag("strong")
            for child in list(dt.contents):
                strong.append(child.extract())
            dt.append(strong)
        for dd in dl.find_all("dd"):
            dd.name = "p"

    # Links: keep http(s) and in-page anchors; unwrap everything else.
    for a in root.find_all("a"):
        href = (a.get("href") or "").strip()
        if href.startswith("#") and len(href) > 1:
            a.attrs = {"href": href}
        elif re.match(r"^https?://", href, re.I):
            a.attrs = {"href": href}
        else:
            a.unwrap()

    for el in root.find_all(True):
        if el.name in RENAME:
            el.name = RENAME[el.name]

    # Unwrap any remaining disallowed tag (div, section, article, header, details…), keeping its children.
    changed = True
    while changed:
        changed = False
        for el in root.find_all(True):
            if el.name not in ALLOWED_TAGS:
                el.unwrap()
                changed = True

    for el in root.find_all(True):
        allowed = ALLOWED_ATTRS.get(el.name, set())
        el_id = el.get("id")
        el.attrs = {k: v for k, v in el.attrs.items() if k in allowed}
        if el_id and el.name in ID_ATTR_TAGS and (keep_ids is None or el_id in keep_ids):
            el.attrs["id"] = el_id

    # Spans without attributes are noise.
    for span in root.find_all("span"):
        if not span.attrs:
            span.unwrap()

    # Bare text directly inside the root becomes paragraphs; empty blocks go away.
    for el in root.find_all(["p", "li", "strong", "em", "h3", "h4", "figcaption", "blockquote"]):
        if not el.get_text(strip=True) and not el.find("img") and not el.find("br"):
            el.decompose()

    html = "".join(str(c) for c in root.contents)
    html = re.sub(r"\s+", " ", html)
    html = re.sub(r">\s+<", "><", html)
    return html.strip()


def anchor_targets(root: Tag) -> set[str]:
    return {a["href"][1:] for a in root.find_all("a", href=True) if a["href"].startswith("#")}


def check_html(html: str, media_paths: set[str]) -> list[str]:
    """Second line of defense: verifies cleaned HTML only uses allowed tags/attrs/images."""
    problems = []
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.find_all(True):
        if el.name not in ALLOWED_TAGS:
            problems.append(f"disallowed tag <{el.name}>")
        for attr in el.attrs:
            if attr != "id" and attr not in ALLOWED_ATTRS.get(el.name, set()):
                problems.append(f"disallowed attribute {attr} on <{el.name}>")
        if el.name == "img" and el.get("src") not in media_paths:
            problems.append(f"image not in media/: {el.get('src')}")
    return sorted(set(problems))


# ---------------------------------------------------------------- items

def load_items_file(path: Path | None) -> dict[str, list[dict]]:
    if not path or not path.exists():
        return {}
    data = json.loads(path.read_text("utf-8"))
    return data.get("sections", data)


def merge_items(extracted: list[dict], generated: list[dict]) -> list[dict]:
    """Extracted items first (stable ids from the book), then generated ones. Ids are never renumbered."""
    out, seen = [], set()
    for it in extracted + generated:
        if not ID_RE.match(str(it.get("id", ""))):
            raise PackError(f"Invalid item id {it.get('id')!r}")
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        out.append(it)
    return out


# ---------------------------------------------------------------- output

def write_pack(pack: dict, media: MediaCollector, out_dir: Path) -> Path:
    check_license(pack["book"])
    pack["schema"] = 1
    pack["pack"].setdefault("created", date.today().isoformat())
    pack["media"] = media.data_urls()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{pack['pack']['id']}-v{pack['pack']['version']}.json"
    path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return path
