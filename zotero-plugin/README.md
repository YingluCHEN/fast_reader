# Zotero AI Bilingual Reading Assistant Plugin

Zotero 7+ plugin. Select an item with a PDF → right-click → **AI Bilingual Read**.

Opens a dual-pane reader:
- **Left**: Original PDF via PDF.js — select text, mark it, highlight is saved
- **Right**: AI Chinese translation of the current page + marks list

## Install

### 1. Start the local AI service first

```bash
cd local-ai-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # add your LLM_API_KEY
python app.py
```

### 2. Pack the plugin as XPI

```bash
cd zotero-plugin
npm install
node scripts/pack.js
# → ai-bilingual-reader.xpi
```

### 3. Install in Zotero

- Zotero → Tools → Add-ons → gear icon → Install Add-on From File
- Select `ai-bilingual-reader.xpi`
- Restart Zotero

## Usage

1. Select any Zotero item that has a PDF attachment.
2. Right-click → **AI Bilingual Read**.
3. The dual-pane reader opens.
4. **Left panel**: Scroll/navigate PDF. Select text → choose mark type → Save Mark.
5. **Right panel**: Read AI translation. Click a mark to flash-highlight it in the PDF.
6. Use **Generate Writing Note** (top bar) to generate a structured Markdown note.
7. Use **Save to Zotero Note** to write the note back into Zotero.

## Mark Types

| Type | Purpose |
|------|---------|
| Background | Background / context |
| Research Gap | Identified gap in the literature |
| Method | Methodology description |
| Assumption | Key assumption made by authors |
| Validation | Validation experiment or result |
| Result Expression | Key result phrasing |
| Limitation | Acknowledged limitation |
| Discussion | Discussion / interpretation |
| Good Sentence | Well-written academic expression |

## Architecture

```
Zotero UI (bootstrap.js)
  └─ Right-click menu → AI Bilingual Read
       └─ POST /api/read/start → paper_id
       └─ Opens chrome://ai-bilingual-reader/content/reader/index.html

Reader Window (reader.js)
  ├─ Left:  PDF.js renders PDF from GET /api/read/pdf/{paper_id}
  │          Text selection → POST /api/marks
  │          Highlights drawn on <canvas>
  └─ Right: GET /api/read/page → blocks + AI translation
             Marks list (click → flash highlight)
             Generate Note → POST /api/notes/generate
             Save to Zotero Note → Zotero.Items API
```

## File Structure

```
zotero-plugin/
├── manifest.json          # Plugin metadata (Zotero 7+)
├── bootstrap.js           # Plugin lifecycle + menu injection
├── chrome.manifest        # Chrome URL registration
├── chrome/content/
│   └── reader/
│       ├── index.html     # Reader UI
│       ├── reader.js      # PDF.js + marks + highlights
│       └── style.css      # Dark theme styles
└── src/                   # TypeScript source (reference)
    ├── main.ts
    ├── apiClient.ts
    ├── zoteroItem.ts
    ├── noteWriter.ts
    └── settings.ts
```
