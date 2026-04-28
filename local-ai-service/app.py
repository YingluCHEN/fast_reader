"""
Zotero AI Bilingual Reader — Local AI Service
Runs on http://127.0.0.1:8765
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

import pdf_service
import mark_store
import note_generator
import llm_client
from schemas import (
    StartReadingRequest,
    StartReadingResponse,
    PageResponse,
    Block,
    OverlayToken,
    SaveMarkRequest,
    Mark,
    GenerateNoteRequest,
    GenerateNoteResponse,
    TranslateSnippetsRequest,
    TranslateSnippetsResponse,
)

app = FastAPI(title="AI Bilingual Reader", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── /api/read/start ────────────────────────────────────────────────────────────
@app.post("/api/read/start", response_model=StartReadingResponse)
def start_reading(req: StartReadingRequest):
    """Register a PDF and prepare it for bilingual reading."""
    try:
        info = pdf_service.register_paper(
            pdf_path=req.pdf_path,
            zotero_item_id=req.zotero_item_id,
            title=req.title,
            doi=req.doi,
            authors=[a.dict() for a in req.authors],
            year=req.year,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return StartReadingResponse(
        paper_id=info["paper_id"],
        title=info["title"],
        doi=info["doi"],
        page_count=info["page_count"],
        status="ready",
    )


# ── /api/read/pdf/{paper_id} ───────────────────────────────────────────────────
@app.get("/api/read/pdf/{paper_id}")
def get_pdf(paper_id: str):
    """Stream the PDF file to the browser (for PDF.js)."""
    try:
        path = pdf_service.get_pdf_path(paper_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Paper {paper_id} not registered.")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"PDF file not found: {path}")
    return FileResponse(path, media_type="application/pdf")


@app.get("/api/read/page-image")
def get_page_image(
    paper_id: str = Query(...),
    page: int = Query(..., ge=1),
    scale: float = Query(2.0, ge=0.5, le=4.0),
):
    try:
        png_bytes = pdf_service.render_page_png(paper_id, page, scale=scale)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return Response(content=png_bytes, media_type="image/png")


# ── /api/read/page ─────────────────────────────────────────────────────────────
@app.get("/api/read/page", response_model=PageResponse)
def get_page(
    paper_id: str = Query(...),
    page: int = Query(..., ge=1),
    translate: bool = Query(True),
):
    """Return text blocks (with optional translation) and marks for a page."""
    try:
        page_count = pdf_service.get_page_count(paper_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Paper {paper_id} not registered.")

    if page > page_count:
        raise HTTPException(status_code=400, detail=f"Page {page} exceeds page count {page_count}.")

    raw_blocks = pdf_service.extract_page_blocks(paper_id, page)
    raw_overlay_tokens = pdf_service.extract_page_overlay_tokens(paper_id, page)
    page_size = pdf_service.get_page_size(paper_id, page)

    zh_map: dict = {}
    if translate:
        blocks_to_translate = [b for b in raw_blocks if b["en"].strip()]
        if blocks_to_translate:
            try:
                zh_list = llm_client.translate_batch([b["en"] for b in blocks_to_translate])
                for b, zh in zip(blocks_to_translate, zh_list):
                    zh_map[b["block_id"]] = zh
            except Exception as e:
                for b in blocks_to_translate:
                    zh_map[b["block_id"]] = f"[翻译失败: {e}]"

    blocks: List[Block] = []
    for b in raw_blocks:
        blocks.append(Block(
            block_id=b["block_id"],
            type=b["type"],
            reading_order=b["reading_order"],
            en=b["en"],
            zh=zh_map.get(b["block_id"], ""),
            x=b.get("x", 0.0),
            y=b.get("y", 0.0),
            width=b.get("width", 0.0),
            height=b.get("height", 0.0),
        ))

    overlay_tokens: List[OverlayToken] = []
    for token in raw_overlay_tokens:
        overlay_tokens.append(OverlayToken(
            token_id=token["token_id"],
            text=token["text"],
            x=token.get("x", 0.0),
            y=token.get("y", 0.0),
            width=token.get("width", 0.0),
            height=token.get("height", 0.0),
        ))

    marks = mark_store.get_marks(paper_id, page)

    return PageResponse(
        paper_id=paper_id,
        page_number=page,
        page_count=page_count,
        page_width=page_size["width"],
        page_height=page_size["height"],
        blocks=blocks,
        overlay_tokens=overlay_tokens,
        marks=marks,
    )


# ── POST /api/marks ────────────────────────────────────────────────────────────
@app.post("/api/marks", response_model=Mark)
def save_mark(req: SaveMarkRequest):
    """Translate, classify, and persist a mark."""
    try:
        meta = pdf_service.get_paper_meta(req.paper_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Paper {req.paper_id} not registered.")

    # 1. Translate the selected text
    try:
        ai_translation = llm_client.translate_to_zh(req.selected_original)
    except Exception as e:
        ai_translation = f"[翻译失败: {e}]"

    # 2. Classify
    try:
        classification = llm_client.classify_mark(
            paper_title=meta.get("title", ""),
            doi=meta.get("doi", ""),
            page_number=req.page_number,
            mark_type=req.mark_type,
            selected_original=req.selected_original,
            ai_translation=ai_translation,
            user_comment=req.user_comment,
        )
    except Exception as e:
        classification = {
            "target_note": f"Writing Note - {req.mark_type}",
            "sub_category": req.mark_type,
            "ai_summary": "",
            "possible_use_in_my_paper": "",
            "keywords": [],
            "confidence": 0.0,
        }

    # 3. Build mark
    mark_id = mark_store.next_mark_id(req.paper_id)
    mark = Mark(
        mark_id=mark_id,
        zotero_item_id=req.zotero_item_id,
        paper_id=req.paper_id,
        paper_title=meta.get("title", ""),
        doi=meta.get("doi", ""),
        authors=meta.get("authors", []),
        year=meta.get("year", ""),
        source_side="left_pdf",
        selected_language="en",
        selected_original=req.selected_original,
        ai_translation=ai_translation,
        page_number=req.page_number,
        pdf_rects=req.pdf_rects,
        mark_type=req.mark_type,
        target_note=classification.get("target_note", ""),
        sub_category=classification.get("sub_category", ""),
        ai_summary=classification.get("ai_summary", ""),
        possible_use_in_my_paper=classification.get("possible_use_in_my_paper", ""),
        keywords=classification.get("keywords", []),
        confidence=float(classification.get("confidence", 0.0)),
        user_comment=req.user_comment,
        created_at=datetime.utcnow().isoformat(),
    )

    # 4. Save
    mark_store.add_mark(mark)
    return mark


# ── GET /api/marks ─────────────────────────────────────────────────────────────
@app.get("/api/marks", response_model=List[Mark])
def get_marks(
    paper_id: str = Query(...),
    page: Optional[int] = Query(None),
):
    return mark_store.get_marks(paper_id, page)


# ── DELETE /api/marks/{mark_id} ────────────────────────────────────────────────
@app.delete("/api/marks/{mark_id}", status_code=204)
def delete_mark(mark_id: str):
    found = mark_store.delete_mark(mark_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Mark {mark_id} not found.")


# ── POST /api/notes/generate ───────────────────────────────────────────────────
@app.post("/api/notes/generate", response_model=GenerateNoteResponse)
def generate_note(req: GenerateNoteRequest):
    """Generate a Writing Note Markdown from all marks of a given note_type."""
    try:
        md = note_generator.generate_and_save(req.note_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return GenerateNoteResponse(note_type=req.note_type, note_markdown=md)


@app.post("/api/translate/snippets", response_model=TranslateSnippetsResponse)
def translate_snippets(req: TranslateSnippetsRequest):
    texts = [text.strip() for text in req.texts if text and text.strip()]
    if not texts:
        return TranslateSnippetsResponse(translations=[])

    try:
        translations = llm_client.translate_batch(texts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return TranslateSnippetsResponse(translations=translations)


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "AI Bilingual Reader"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, reload=False)
