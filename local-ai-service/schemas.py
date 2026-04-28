from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class Author(BaseModel):
    firstName: str = ""
    lastName: str = ""


class StartReadingRequest(BaseModel):
    zotero_item_id: int
    pdf_path: str
    title: str = ""
    doi: str = ""
    authors: List[Author] = []
    year: str = ""


class StartReadingResponse(BaseModel):
    paper_id: str
    title: str
    doi: str
    page_count: int
    status: str = "ready"


class Block(BaseModel):
    block_id: str
    type: str = "paragraph"
    reading_order: int
    en: str
    zh: str = ""
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class OverlayToken(BaseModel):
    token_id: str
    text: str
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class NormalizedRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class Mark(BaseModel):
    mark_id: str
    zotero_item_id: int
    paper_id: str
    paper_title: str = ""
    doi: str = ""
    authors: List[Author] = []
    year: str = ""
    source_side: str = "left_pdf"
    selected_language: str = "en"
    selected_original: str
    ai_translation: str = ""
    page_number: int
    pdf_rects: List[NormalizedRect] = []
    mark_type: str
    target_note: str = ""
    sub_category: str = ""
    ai_summary: str = ""
    possible_use_in_my_paper: str = ""
    keywords: List[str] = []
    confidence: float = 0.0
    user_comment: str = ""
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class PageResponse(BaseModel):
    paper_id: str
    page_number: int
    page_count: int
    page_width: float = 0.0
    page_height: float = 0.0
    blocks: List[Block]
    overlay_tokens: List[OverlayToken] = []
    marks: List[Mark]


class SaveMarkRequest(BaseModel):
    paper_id: str
    zotero_item_id: int
    page_number: int
    selected_original: str
    pdf_rects: List[NormalizedRect] = []
    mark_type: str
    user_comment: str = ""


class GenerateNoteRequest(BaseModel):
    note_type: str


class GenerateNoteResponse(BaseModel):
    note_type: str
    note_markdown: str


class TranslateSnippetsRequest(BaseModel):
    texts: List[str]


class TranslateSnippetsResponse(BaseModel):
    translations: List[str]
