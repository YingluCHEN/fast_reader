"""PDF processing: registration, streaming, and block extraction via PyMuPDF."""
from __future__ import annotations
import hashlib
import os
from typing import Dict, List, Optional

import fitz  # PyMuPDF

# paper_id → {"path": str, "meta": dict, "doc": fitz.Document}
_registry: Dict[str, dict] = {}


def register_paper(
    pdf_path: str,
    zotero_item_id: int,
    title: str = "",
    doi: str = "",
    authors: list = None,
    year: str = "",
) -> dict:
    """Register a PDF and return its paper_id and page_count."""
    # Stable paper_id based on path hash
    paper_id = "p_" + hashlib.md5(pdf_path.encode()).hexdigest()[:12]

    if paper_id not in _registry:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF not found: {pdf_path}")
        doc = fitz.open(pdf_path)
        _registry[paper_id] = {
            "path": pdf_path,
            "doc": doc,
            "meta": {
                "zotero_item_id": zotero_item_id,
                "title": title,
                "doi": doi,
                "authors": authors or [],
                "year": year,
            },
        }

    entry = _registry[paper_id]
    return {
        "paper_id": paper_id,
        "title": entry["meta"]["title"],
        "doi": entry["meta"]["doi"],
        "page_count": entry["doc"].page_count,
    }


def get_pdf_path(paper_id: str) -> str:
    """Return local path to the PDF file."""
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")
    return _registry[paper_id]["path"]


def get_paper_meta(paper_id: str) -> dict:
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")
    return _registry[paper_id]["meta"]


def get_page_count(paper_id: str) -> int:
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")
    return _registry[paper_id]["doc"].page_count


def extract_page_blocks(paper_id: str, page_number: int) -> List[dict]:
    """
    Extract text blocks from a PDF page using PyMuPDF.
    page_number is 1-based.
    Returns list of {"block_id", "type", "reading_order", "en"} dicts.
    """
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")

    doc: fitz.Document = _registry[paper_id]["doc"]
    page_idx = page_number - 1  # 0-based

    if page_idx < 0 or page_idx >= doc.page_count:
        return []

    page = doc[page_idx]
    page_rect = page.rect
    page_width = float(page_rect.width) or 1.0
    page_height = float(page_rect.height) or 1.0
    raw_blocks = page.get_text("blocks")  # (x0,y0,x1,y1,text,block_no,block_type)

    blocks = []
    reading_order = 0
    for i, b in enumerate(raw_blocks):
        text = b[4].strip()
        block_type = b[6]  # 0=text, 1=image
        if block_type != 0 or not text:
            continue
        # Skip very short fragments (page numbers, headers < 15 chars)
        if len(text) < 15:
            continue
        reading_order += 1
        blocks.append({
            "block_id": f"p{page_number}_b{i:02d}",
            "type": "paragraph",
            "reading_order": reading_order,
            "en": text,
            "zh": "",
            "x": max(0.0, min(1.0, float(b[0]) / page_width)),
            "y": max(0.0, min(1.0, float(b[1]) / page_height)),
            "width": max(0.0, min(1.0, float(b[2] - b[0]) / page_width)),
            "height": max(0.0, min(1.0, float(b[3] - b[1]) / page_height)),
        })

    return blocks


def extract_page_overlay_tokens(paper_id: str, page_number: int) -> List[dict]:
    """Extract word-level text boxes for precise left-panel overlay/marking."""
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")

    doc: fitz.Document = _registry[paper_id]["doc"]
    page_idx = page_number - 1
    if page_idx < 0 or page_idx >= doc.page_count:
        return []

    page = doc[page_idx]
    page_rect = page.rect
    page_width = float(page_rect.width) or 1.0
    page_height = float(page_rect.height) or 1.0
    raw_words = page.get_text("words")
    tokens = []
    for i, word in enumerate(raw_words):
        if len(word) < 5:
            continue
        x0, y0, x1, y1, text = float(word[0]), float(word[1]), float(word[2]), float(word[3]), str(word[4]).strip()
        if not text:
            continue

        token_height = max(1.0, y1 - y0)
        shrink_top = token_height * 0.12
        shrink_bottom = token_height * 0.08
        y0 += shrink_top
        y1 -= shrink_bottom
        if y1 <= y0:
            y0 -= shrink_top
            y1 += shrink_bottom

        tokens.append({
            "token_id": f"p{page_number}_w{i:04d}",
            "text": text,
            "x": max(0.0, min(1.0, x0 / page_width)),
            "y": max(0.0, min(1.0, y0 / page_height)),
            "width": max(0.0, min(1.0, (x1 - x0) / page_width)),
            "height": max(0.0, min(1.0, (y1 - y0) / page_height)),
        })

    return tokens


def get_page_size(paper_id: str, page_number: int) -> dict:
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")

    doc: fitz.Document = _registry[paper_id]["doc"]
    page_idx = page_number - 1
    if page_idx < 0 or page_idx >= doc.page_count:
        raise KeyError(f"Page out of range: {page_number}")

    rect = doc[page_idx].rect
    return {
      "width": float(rect.width),
      "height": float(rect.height),
    }


def render_page_png(paper_id: str, page_number: int, scale: float = 2.0) -> bytes:
    if paper_id not in _registry:
        raise KeyError(f"Unknown paper_id: {paper_id}")

    doc: fitz.Document = _registry[paper_id]["doc"]
    page_idx = page_number - 1
    if page_idx < 0 or page_idx >= doc.page_count:
        raise KeyError(f"Page out of range: {page_number}")

    page = doc[page_idx]
    matrix = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return pix.tobytes("png")
