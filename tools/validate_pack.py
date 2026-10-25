#!/usr/bin/env python3
"""Validates content packs against schema/pack.schema.json plus rules JSON Schema can't express.

  python3 tools/validate_pack.py content/packs/*.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from packlib import PACK_TARGET_BYTES, REPO, check_html  # noqa: E402

SCHEMA = REPO / "schema" / "pack.schema.json"


def _dict(v) -> dict:
    return v if isinstance(v, dict) else {}


def _list(v) -> list:
    return v if isinstance(v, list) else []


def validate_pack(pack) -> list[str]:
    problems = []
    if not isinstance(pack, dict):
        return ["(root): not a JSON object"]
    try:
        import jsonschema
        validator = jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text("utf-8")))
        for err in sorted(validator.iter_errors(pack), key=lambda e: list(e.path)):
            where = "/".join(str(p) for p in err.path) or "(root)"
            problems.append(f"schema: {where}: {err.message[:200]}")
    except ImportError:
        problems.append("note: install 'jsonschema' for full schema checks (pip install jsonschema)")

    # Custom checks below must survive any shape: the schema errors above already report bad types.
    media = set(_dict(pack.get("media")).keys())
    used = set()
    for s in _list(_dict(pack.get("chapter")).get("sections")):
        if not isinstance(s, dict):
            continue
        html = s.get("html") if isinstance(s.get("html"), str) else ""
        for p in check_html(html, media):
            problems.append(f"{s.get('id')}: {p}")
        used.update(m for m in media if f'src="{m}"' in html)
        items = [i for i in _list(s.get("items")) if isinstance(i, dict)]
        ids = [repr(i.get("id")) for i in items]  # repr: ids may be any JSON value, even unhashable lists
        if len(ids) != len(set(ids)):
            problems.append(f"{s.get('id')}: duplicate item ids")
        for it in items:
            if it.get("type") == "mcq":
                opts = [o for o in _list(it.get("options")) if isinstance(o, str)]
                if type(it.get("answer")) is not int or not 0 <= it["answer"] < len(opts):
                    problems.append(f"{s.get('id')}/{it.get('id')}: answer index out of range")
                if any("all of the above" in o.lower() for o in opts):
                    problems.append(f"{s.get('id')}/{it.get('id')}: 'all of the above' is not allowed")
                if len(set(opts)) != len(opts):
                    problems.append(f"{s.get('id')}/{it.get('id')}: duplicate options")
    for m in sorted(media - used):
        problems.append(f"warning: unused image {m}")
    return [p for p in problems if not p.startswith(("warning:", "note:"))] + \
           [p for p in problems if p.startswith(("warning:", "note:"))]


def validate_file(path: Path) -> list[str]:
    raw = path.read_bytes()
    try:
        pack = json.loads(raw)
    except ValueError as e:
        return [f"not valid JSON: {e}"]
    problems = validate_pack(pack)
    if len(raw) > PACK_TARGET_BYTES:
        problems.append(f"warning: {path.name} is {len(raw) / 1e6:.1f} MB (target < 10 MB)")
    # Only hard errors fail; warnings are printed by the caller.
    hard = [p for p in problems if not p.startswith(("warning:", "note:"))]
    for p in problems:
        if p.startswith(("warning:", "note:")):
            print(f"  {p}")
    return hard


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    failed = False
    for arg in sys.argv[1:]:
        problems = validate_file(Path(arg))
        print(f"{'FAIL' if problems else 'ok  '} {arg}")
        for p in problems:
            print("   -", p)
        failed |= bool(problems)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
