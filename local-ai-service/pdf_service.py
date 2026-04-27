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
        })

    return blocks
