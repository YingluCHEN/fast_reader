---
name: Zotero AI Bilingual Reader — project overview
description: Architecture and file map for the Zotero 9 AI bilingual reading plugin built in this project
type: project
---

V0.1 plugin built. Two-component architecture:

**local-ai-service/** (FastAPI, port 8765)
- app.py — main FastAPI app with all routes
- pdf_service.py — PyMuPDF block extraction + paper registry (in-memory)
- llm_client.py — OpenAI-compatible translate + classify + note generation
- mark_store.py — thread-safe marks.json read/write
- note_generator.py — generates Writing Note Markdown
- schemas.py — Pydantic models
- data/marks.json — persisted marks
- data/notes/*.md — generated note files

**zotero-plugin/** (Zotero 7+ bootstrap plugin)
- bootstrap.js — plugin entry: menu injection, window open, Zotero API calls
- chrome.manifest — registers chrome://ai-bilingual-reader/ URL
- chrome/content/reader/ — reader window (index.html + reader.js + style.css)
- src/ — TypeScript reference files (apiClient, noteWriter, etc.)
- scripts/pack.js — packages to .xpi using archiver

**Key decisions:**
- Marks only from left PDF text layer (source_side: "left_pdf")
- pdf_rects stored as normalized [0,1] coords relative to canvas size
- Highlights redrawn on page change from marks.json data
- Note save: reader calls window.opener.saveNoteToZotero (injected by bootstrap)
- PDF streamed from backend GET /api/read/pdf/{paper_id} → PDF.js loads it

**Why:** per spec — left PDF is the evidence layer; right AI translation is read-only understanding layer.
**How to apply:** any mark/highlight feature must touch left panel only.
