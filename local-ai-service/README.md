# Local AI Service — Zotero AI Bilingual Reader

FastAPI backend running at `http://127.0.0.1:8765`.

## Setup

```bash
cd local-ai-service

# 1. Create virtual environment
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env — set LLM_API_KEY, LLM_BASE_URL, LLM_MODEL

# 4. Start the service
python app.py
```

The service listens on `http://127.0.0.1:8765`.

## API Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/read/start` | Register a PDF, get paper_id |
| GET | `/api/read/pdf/{paper_id}` | Stream PDF bytes for PDF.js |
| GET | `/api/read/page` | Get blocks + AI translation + page marks |
| POST | `/api/marks` | Save mark (AI translates + classifies) |
| GET | `/api/marks` | Get marks for a paper/page |
| POST | `/api/notes/generate` | Generate Writing Note Markdown |
| GET | `/health` | Health check |

## Local LLM (Ollama)

```env
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
```

## Data

- `data/marks.json` — all saved marks
- `data/notes/*.md` — generated Writing Note files
