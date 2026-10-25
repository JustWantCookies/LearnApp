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


def validate_pack(pack: dict) -> list[str]:
    problems = []
    try:
        import jsonschema
        validator = jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text("utf-8")))
        for err in sorted(validator.iter_errors(pack), key=lambda e: list(e.path)):
            where = "/".join(str(p) for p in err.path) or "(root)"
            problems.append(f"schema: {where}: {err.message[:200]}")
    except ImportError:
        problems.append("note: install 'jsonschema' for full schema checks (pip install jsonschema)")

    media = set((pack.get("media") or {}).keys())
    used = set()
    for s in pack.get("chapter", {}).get("sections", []):
        for p in check_html(s.get("html", ""), media):
            problems.append(f"{s.get('id')}: {p}")
        used.update(m for m in media if f'src="{m}"' in s.get("html", ""))
        ids = [i.get("id") for i in s.get("items", [])]
        if len(ids) != len(set(ids)):
            problems.append(f"{s.get('id')}: duplicate item ids")
        for it in s.get("items", []):
            if it.get("type") == "mcq":
                opts = it.get("options", [])
                if not isinstance(it.get("answer"), int) or not 0 <= it["answer"] < len(opts):
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
    problems = validate_pack(json.loads(raw))
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
