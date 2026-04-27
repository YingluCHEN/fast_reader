"""Generate Writing Note Markdown from marks and save to disk."""
from __future__ import annotations
import json
import os
import re

from mark_store import get_marks_by_note_type
from llm_client import generate_note_markdown

_NOTES_DIR = os.path.join(os.path.dirname(__file__), "data", "notes")


def _safe_filename(note_type: str) -> str:
    return re.sub(r"[^\w\-]", "_", note_type) + ".md"


def generate_and_save(note_type: str) -> str:
    """Generate Markdown for note_type from stored marks, save to disk, return Markdown."""
    marks = get_marks_by_note_type(note_type)

    if not marks:
        md = f"# {note_type}\n\n_No marks have been saved for this note type yet._\n"
    else:
        marks_payload = [
            {
                "mark_id": m.mark_id,
                "paper_title": m.paper_title,
                "doi": m.doi,
                "page_number": m.page_number,
                "mark_type": m.mark_type,
                "sub_category": m.sub_category,
                "selected_original": m.selected_original,
                "ai_translation": m.ai_translation,
                "ai_summary": m.ai_summary,
                "possible_use_in_my_paper": m.possible_use_in_my_paper,
                "keywords": m.keywords,
                "user_comment": m.user_comment,
            }
            for m in marks
        ]
        marks_json = json.dumps(marks_payload, ensure_ascii=False, indent=2)
        md = generate_note_markdown(note_type, marks_json)

    # Persist to disk
    os.makedirs(_NOTES_DIR, exist_ok=True)
    fname = _safe_filename(note_type)
    fpath = os.path.join(_NOTES_DIR, fname)
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(md)

    return md
