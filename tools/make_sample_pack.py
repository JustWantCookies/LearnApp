#!/usr/bin/env python3
"""Builds docs/sample/sample-pack.json — a tiny pack with our own text, safe to commit (M2 test data)."""
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from packlib import REPO, MediaCollector, write_pack  # noqa: E402
from validate_pack import validate_file  # noqa: E402


def diagram() -> bytes:
    """Bar chart of the Leitner intervals, drawn here so the image is ours."""
    w, h = 600, 300
    im = Image.new("RGB", (w, h), (247, 245, 240))
    d = ImageDraw.Draw(im)
    days = [0, 1, 3, 7, 16, 35, 90]
    for i, n in enumerate(days):
        x = 40 + i * 78
        bar = int(220 * (n / 90)) + 4
        d.rectangle([x, h - 40 - bar, x + 48, h - 40], fill=(47, 111, 94))
        d.text((x + 14, h - 30), f"box {i}", fill=(60, 60, 60))
        d.text((x + 14, h - 56 - bar), f"{n}d", fill=(30, 30, 30))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


SECTIONS = [
    {
        "id": "s1.1", "title": "1.1 Why spacing works", "order": 1,
        "html": (
            "<p>Memories fade quickly after we first learn something. Each time we successfully recall an idea, "
            "the memory becomes more stable and fades more slowly. <strong>Spaced repetition</strong> uses this: "
            "it schedules each review just before you would forget.</p>"
            "<h3>Recall beats rereading</h3>"
            "<p>Actively retrieving an answer strengthens memory far more than rereading the same page. "
            "That is why every section in this app ends with questions.</p>"
            "<blockquote><p><strong>Try it</strong></p><p>Close your eyes and summarise this paragraph in one sentence.</p></blockquote>"
        ),
        "summary": "Recall strengthens memories, and spacing reviews just before forgetting makes them last longer.",
        "keyTerms": [
            {"term": "spaced repetition", "definition": "reviewing material at increasing intervals, timed just before forgetting"},
            {"term": "retrieval practice", "definition": "actively recalling information instead of rereading it"},
        ],
        "items": [
            {"id": "q1", "type": "mcq", "prompt": "What does spaced repetition schedule?",
             "options": ["Each review just before you would forget", "All reviews on the same day", "Reviews only after mistakes", "Rereading instead of recall"],
             "answer": 0, "explanation": "Spaced repetition times each review just before the memory would fade."},
            {"id": "q2", "type": "mcq", "prompt": "Which strengthens memory more?",
             "options": ["Rereading the page", "Actively recalling the answer", "Highlighting key words", "Reading faster"],
             "answer": 1, "explanation": "Retrieval (actively recalling) strengthens memory far more than rereading."},
            {"id": "e1", "type": "explain", "prompt": "Explain in your own words why recall beats rereading.",
             "rubric": ["memories fade", "retrieval strengthens memory", "rereading is passive"]},
        ],
    },
    {
        "id": "s1.2", "title": "1.2 The box ladder", "order": 2,
        "html": (
            "<p>This app sorts every question into one of seven <strong>boxes</strong>. A new question starts in box 0 "
            "and is due immediately. A correct answer moves it up one box; a wrong answer sends it back to box 1.</p>"
            "<figure><img src=\"media/intervals.webp\" alt=\"Bar chart: box 0 is due after 0 days, box 1 after 1, box 2 after 3, "
            "box 3 after 7, box 4 after 16, box 5 after 35, box 6 after 90 days.\" width=\"600\" height=\"300\">"
            "<figcaption><strong>Figure 1.2.1</strong> Days until the next review, per box.</figcaption></figure>"
            "<table><caption>Results</caption><thead><tr><th>Score</th><th>Effect</th></tr></thead>"
            "<tbody><tr><td>2–3</td><td>up one box</td></tr><tr><td>1</td><td>down one box (min. 1)</td></tr>"
            "<tr><td>0</td><td>back to box 1, counts a lapse</td></tr></tbody></table>"
        ),
        "summary": "Seven boxes with growing intervals; correct answers move up, wrong answers reset to box 1.",
        "keyTerms": [{"term": "lapse", "definition": "a forgotten item that falls back to box 1"}],
        "items": [
            {"id": "q1", "type": "mcq", "prompt": "Where does a new question start?",
             "options": ["Box 0, due immediately", "Box 1, due tomorrow", "Box 6, due in 90 days", "In no box until answered twice"],
             "answer": 0, "explanation": "New questions start in box 0, which has an interval of 0 days."},
            {"id": "q2", "type": "mcq", "prompt": "What happens after a wrong answer?",
             "options": ["The question moves up one box", "The question goes back to box 1", "The question is deleted", "Nothing changes"],
             "answer": 1, "explanation": "A wrong answer (score 0) resets the question to box 1 and counts a lapse."},
            {"id": "q3", "type": "mcq", "prompt": "How many days until the next review for a question in box 3?",
             "options": ["3", "7", "16", "35"],
             "answer": 1, "explanation": "The intervals are 0, 1, 3, 7, 16, 35, 90 days for boxes 0–6, so box 3 waits 7 days."},
        ],
    },
]


def main():
    media = MediaCollector(lambda name: diagram() if name == "intervals" else None)
    media.add("intervals")
    pack = {
        "schema": 1,
        "pack": {"id": "sample-learning-ch1", "version": 1, "created": "2026-10-25"},
        "book": {
            "id": "sample-learning",
            "title": "Sample: How to Learn",
            "authors": ["Learn app"],
            "publisher": "Learn app sample content",
            "license": "CC BY 4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "Sample text written for this app.",
        },
        "chapter": {"id": "ch1", "number": 1, "title": "1. Learning that sticks", "order": 1, "sections": SECTIONS},
    }
    out = write_pack(pack, media, REPO / "docs" / "sample")
    final = out.with_name("sample-pack.json")
    out.replace(final)
    problems = validate_file(final)
    print(f"Wrote {final} ({final.stat().st_size} bytes)", "OK" if not problems else problems)


if __name__ == "__main__":
    main()
