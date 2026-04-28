"""Thread-safe persistent mark storage backed by data/marks.json."""
from __future__ import annotations
import json
import os
import threading
from typing import List, Optional
from schemas import Mark

_MARKS_FILE = os.path.join(os.path.dirname(__file__), "data", "marks.json")
_lock = threading.Lock()


def _load() -> List[dict]:
    if not os.path.exists(_MARKS_FILE):
        return []
    with open(_MARKS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


def _save(marks: List[dict]) -> None:
    os.makedirs(os.path.dirname(_MARKS_FILE), exist_ok=True)
    with open(_MARKS_FILE, "w", encoding="utf-8") as f:
        json.dump(marks, f, ensure_ascii=False, indent=2)


def add_mark(mark: Mark) -> None:
    with _lock:
        marks = _load()
        # Replace if same mark_id exists
        marks = [m for m in marks if m.get("mark_id") != mark.mark_id]
        marks.append(mark.dict())
        _save(marks)


def get_marks(paper_id: str, page: Optional[int] = None) -> List[Mark]:
    with _lock:
        marks = _load()
    result = [m for m in marks if m.get("paper_id") == paper_id]
    if page is not None:
        result = [m for m in result if m.get("page_number") == page]
    return [Mark(**m) for m in result]


def get_marks_by_note_type(note_type: str) -> List[Mark]:
    with _lock:
        marks = _load()
    result = [m for m in marks if m.get("target_note") == note_type]
    return [Mark(**m) for m in result]


def delete_mark(mark_id: str) -> bool:
    with _lock:
        marks = _load()
        new_marks = [m for m in marks if m.get("mark_id") != mark_id]
        if len(new_marks) == len(marks):
            return False
        _save(new_marks)
    return True


def next_mark_id(paper_id: str) -> str:
    with _lock:
        marks = _load()
    paper_marks = [m for m in marks if m.get("paper_id") == paper_id]
    n = len(paper_marks) + 1
    return f"mark_{paper_id[:8]}_{n:04d}"
