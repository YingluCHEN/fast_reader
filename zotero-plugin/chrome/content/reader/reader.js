"use strict";

// ── Constants ────────────────────────────────────────────────────────────────
const API_BASE = "http://127.0.0.1:8765";

const MARK_COLORS = {
  "Background":        "rgba(108,140,191,0.45)",
  "Research Gap":      "rgba(224, 85, 85,0.45)",
  "Method":            "rgba( 76,175,130,0.45)",
  "Assumption":        "rgba(156,111,191,0.45)",
  "Validation":        "rgba( 76,175, 80,0.45)",
  "Result Expression": "rgba(255,152,  0,0.45)",
  "Limitation":        "rgba(244, 67, 54,0.45)",
  "Discussion":        "rgba( 33,150,243,0.45)",
  "Good Sentence":     "rgba(255,235, 59,0.45)",
};

// ── State ────────────────────────────────────────────────────────────────────
const State = {
  paperId: "",
  title: "",
  doi: "",
  pageCount: 1,
  zoteroItemId: 0,
  currentPage: 1,
  pdfDoc: null,
  pdfScale: 1.5,
  pageMarks: [],      // marks for current page
  allMarks: [],       // all marks (for note generation)
  pendingSelection: null, // { text, rects, range }
  selectedMarkType: null,
  lastNoteMarkdown: "",
  lastNoteType: "",
};

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const El = {
  canvas: $("pdf-canvas"),
  textLayer: $("text-layer"),
  hlCanvas: $("highlight-canvas"),
  blocksContainer: $("blocks-container"),
  marksContainer: $("marks-container"),
  markToolbar: $("mark-toolbar"),
  toolbarComment: $("toolbar-comment"),
  noteModal: $("note-modal"),
  noteModalTitle: $("note-modal-title"),
  noteModalContent: $("note-modal-content"),
  pageIndicator: $("page-indicator"),
  rightStatus: $("right-status"),
  loadingOverlay: $("loading-overlay"),
  topbarTitle: $("topbar-title"),
};

// ── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  parseURLParams();
  setupResizer();
  setupButtons();
  await loadPDF();
  await renderPage(State.currentPage);
})();

function parseURLParams() {
  const p = new URLSearchParams(window.location.search);
  State.paperId      = p.get("paper_id")      || "";
  State.title        = p.get("title")          || "";
  State.doi          = p.get("doi")            || "";
  State.pageCount    = parseInt(p.get("page_count") || "1", 10);
  State.zoteroItemId = parseInt(p.get("zotero_item_id") || "0", 10);

  document.title = State.title || "AI Bilingual Reader";
  El.topbarTitle.textContent = State.title;
  El.topbarTitle.title = State.title;
}

// ── PDF loading ───────────────────────────────────────────────────────────────
async function loadPDF() {
  showLoading("Loading PDF…");
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdfUrl = `${API_BASE}/api/read/pdf/${State.paperId}`;
    State.pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    State.pageCount = State.pdfDoc.numPages;
  } catch (e) {
    console.error("[Reader] PDF load error:", e);
    El.blocksContainer.innerHTML = `<div style="color:#f55;padding:12px">Failed to load PDF: ${e.message}</div>`;
  } finally {
    hideLoading();
  }
}

// ── Page rendering ────────────────────────────────────────────────────────────
async function renderPage(pageNum) {
  State.currentPage = Math.max(1, Math.min(pageNum, State.pageCount));
  El.pageIndicator.textContent = `Page ${State.currentPage} / ${State.pageCount}`;

  showLoading("Rendering…");
  try {
    await Promise.all([
      renderPDFPage(State.currentPage),
      loadPageData(State.currentPage),
    ]);
    redrawHighlights();
  } finally {
    hideLoading();
  }
}

async function renderPDFPage(pageNum) {
  if (!State.pdfDoc) return;

  const page = await State.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: State.pdfScale });

  El.canvas.width  = viewport.width;
  El.canvas.height = viewport.height;
  El.hlCanvas.width  = viewport.width;
  El.hlCanvas.height = viewport.height;

  const ctx = El.canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Text layer
  El.textLayer.innerHTML = "";
  El.textLayer.style.width  = `${viewport.width}px`;
  El.textLayer.style.height = `${viewport.height}px`;

  const textContent = await page.getTextContent();
  pdfjsLib.renderTextLayer({
    textContent,
    container: El.textLayer,
    viewport,
    textDivs: [],
  });
}

// ── Page data (blocks + marks) ────────────────────────────────────────────────
async function loadPageData(pageNum) {
  try {
    El.blocksContainer.innerHTML = `<div style="color:#888;padding:12px">Loading AI translation…</div>`;
    El.rightStatus.textContent = "translating…";

    const resp = await apiGet(`/api/read/page?paper_id=${State.paperId}&page=${pageNum}&translate=true`);

    renderBlocks(resp.blocks || []);
    State.pageMarks = resp.marks || [];
    renderMarks(State.pageMarks);
    El.rightStatus.textContent = `${(resp.blocks || []).length} blocks`;
  } catch (e) {
    El.blocksContainer.innerHTML = `<div style="color:#f55;padding:12px">Translation failed: ${e.message}</div>`;
    El.rightStatus.textContent = "error";
  }
}

function renderBlocks(blocks) {
  if (!blocks.length) {
    El.blocksContainer.innerHTML = `<div style="color:#666;padding:12px">No text blocks on this page.</div>`;
    return;
  }
  El.blocksContainer.innerHTML = blocks.map(b => `
    <div class="block-item" data-block-id="${esc(b.block_id)}">
      <div class="block-en">${esc(b.en)}</div>
      <div class="block-zh">${esc(b.zh)}</div>
    </div>
  `).join("");
}

function renderMarks(marks) {
  if (!marks.length) {
    El.marksContainer.innerHTML = `<div style="color:#555;padding:8px;font-size:12px">No marks on this page yet.</div>`;
    return;
  }
  El.marksContainer.innerHTML = marks.map(m => {
    const colorClass = `mark-color-${(m.mark_type || "").replace(/\s+/g, "-")}`;
    return `
    <div class="mark-item ${colorClass}" data-mark-id="${esc(m.mark_id)}" onclick="flashMark('${esc(m.mark_id)}')">
      <span class="mark-type-badge">${esc(m.mark_type)}</span>
      <div class="mark-original">"${esc(m.selected_original)}"</div>
      <div class="mark-zh">${esc(m.ai_translation || "")}</div>
      ${m.ai_summary ? `<div class="mark-summary">${esc(m.ai_summary)}</div>` : ""}
    </div>`;
  }).join("");
}

// ── Highlight canvas ──────────────────────────────────────────────────────────
function redrawHighlights() {
  const ctx = El.hlCanvas.getContext("2d");
  ctx.clearRect(0, 0, El.hlCanvas.width, El.hlCanvas.height);

  for (const mark of State.pageMarks) {
    const color = MARK_COLORS[mark.mark_type] || "rgba(255,255,0,0.35)";
    drawRects(ctx, mark.pdf_rects || [], color, mark.mark_id);
  }
}

function drawRects(ctx, rects, color, markId) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, "0.8)");
  ctx.lineWidth = 1;

  const W = El.hlCanvas.width;
  const H = El.hlCanvas.height;

  for (const r of rects) {
    const x = r.x * W;
    const y = r.y * H;
    const w = r.width * W;
    const h = r.height * H;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
}

function flashMark(markId) {
  const mark = State.pageMarks.find(m => m.mark_id === markId);
  if (!mark || !mark.pdf_rects?.length) return;

  const ctx = El.hlCanvas.getContext("2d");
  const W = El.hlCanvas.width;
  const H = El.hlCanvas.height;
  let count = 0;
  const color = MARK_COLORS[mark.mark_type] || "rgba(255,255,0,0.7)";

  const flash = () => {
    redrawHighlights();
    if (count % 2 === 0) {
      ctx.fillStyle = "rgba(255,255,100,0.8)";
      for (const r of mark.pdf_rects) {
        ctx.fillRect(r.x * W, r.y * H, r.width * W, r.height * H);
      }
    }
    count++;
    if (count < 6) setTimeout(flash, 200);
    else redrawHighlights();
  };
  flash();

  // Scroll to the first rect on the left panel
  if (mark.pdf_rects[0]) {
    const r = mark.pdf_rects[0];
    const container = document.getElementById("left-panel");
    const pdfContainer = document.getElementById("pdf-container");
    const pdfTop = pdfContainer.offsetTop;
    container.scrollTop = pdfTop + r.y * El.hlCanvas.height - 100;
  }
}

// ── Text selection & mark toolbar ─────────────────────────────────────────────
El.textLayer.addEventListener("mouseup", handleTextSelection);

function handleTextSelection(e) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const text = selection.toString().trim();
  if (!text || text.length < 5) return;

  const range = selection.getRangeAt(0);
  const containerRect = El.hlCanvas.getBoundingClientRect();
  const clientRects = Array.from(range.getClientRects());

  if (!clientRects.length) return;

  // Normalize to [0,1] relative to the PDF canvas
  const W = El.hlCanvas.width;
  const H = El.hlCanvas.height;

  const normalizedRects = clientRects.map(cr => ({
    x: (cr.left - containerRect.left) / containerRect.width,
    y: (cr.top  - containerRect.top)  / containerRect.height,
    width:  cr.width  / containerRect.width,
    height: cr.height / containerRect.height,
  })).filter(r => r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0);

  if (!normalizedRects.length) return;

  State.pendingSelection = { text, rects: normalizedRects };
  State.selectedMarkType = null;

  // Show toolbar near selection end
  const lastRect = clientRects[clientRects.length - 1];
  showMarkToolbar(lastRect.right + window.scrollX, lastRect.bottom + window.scrollY + 8);
}

function showMarkToolbar(x, y) {
  El.markToolbar.classList.remove("hidden");
  El.toolbarComment.value = "";

  // Clamp to viewport
  const maxX = window.innerWidth  - El.markToolbar.offsetWidth  - 10;
  const maxY = window.innerHeight - El.markToolbar.offsetHeight - 10;
  El.markToolbar.style.left = `${Math.min(x, maxX)}px`;
  El.markToolbar.style.top  = `${Math.min(y, maxY)}px`;

  // Highlight selected type button
  El.markToolbar.querySelectorAll("[data-type]").forEach(btn => {
    btn.classList.remove("active-type");
  });
}

function hideMarkToolbar() {
  El.markToolbar.classList.add("hidden");
  State.pendingSelection = null;
  State.selectedMarkType = null;
  window.getSelection()?.removeAllRanges();
}

// Mark type buttons
El.markToolbar.querySelectorAll("[data-type]").forEach(btn => {
  btn.addEventListener("click", () => {
    El.markToolbar.querySelectorAll("[data-type]").forEach(b => b.style.background = "");
    btn.style.background = "#4a4a7a";
    State.selectedMarkType = btn.dataset.type;
  });
});

$("toolbar-cancel").addEventListener("click", hideMarkToolbar);

$("toolbar-save").addEventListener("click", async () => {
  if (!State.pendingSelection) { hideMarkToolbar(); return; }
  if (!State.selectedMarkType) {
    alert("Please select a mark type.");
    return;
  }
  await saveMark();
});

async function saveMark() {
  const { text, rects } = State.pendingSelection;
  const markType  = State.selectedMarkType;
  const comment   = El.toolbarComment.value.trim();

  hideMarkToolbar();
  showLoading("Saving mark…");

  try {
    const body = {
      paper_id:          State.paperId,
      zotero_item_id:    State.zoteroItemId,
      page_number:       State.currentPage,
      selected_original: text,
      pdf_rects:         rects,
      mark_type:         markType,
      user_comment:      comment,
    };

    const mark = await apiPost("/api/marks", body);

    // Add to local state and redraw
    State.pageMarks.push(mark);
    renderMarks(State.pageMarks);
    redrawHighlights();
  } catch (e) {
    alert(`Failed to save mark: ${e.message}`);
  } finally {
    hideLoading();
  }
}

// ── Note generation ───────────────────────────────────────────────────────────
$("btn-generate-note").addEventListener("click", async () => {
  const noteType = $("note-type-select").value;
  if (!noteType) { alert("Please select a note type."); return; }

  showLoading("Generating Writing Note…");
  try {
    const resp = await apiPost("/api/notes/generate", { note_type: noteType });
    State.lastNoteMarkdown = resp.note_markdown;
    State.lastNoteType     = noteType;

    El.noteModalTitle.textContent   = noteType;
    El.noteModalContent.textContent = resp.note_markdown;
    El.noteModal.classList.remove("hidden");
  } catch (e) {
    alert(`Note generation failed: ${e.message}`);
  } finally {
    hideLoading();
  }
});

$("note-modal-close").addEventListener("click", () => El.noteModal.classList.add("hidden"));

$("note-modal-save").addEventListener("click", () => {
  $("btn-save-zotero").click();
});

$("btn-save-zotero").addEventListener("click", async () => {
  if (!State.lastNoteMarkdown) {
    alert("Generate a Writing Note first.");
    return;
  }

  // If Zotero API is accessible from this window (bootstrap exposed it), use it
  if (typeof window.opener?.saveNoteToZotero === "function") {
    showLoading("Saving to Zotero…");
    try {
      await window.opener.saveNoteToZotero(
        State.zoteroItemId,
        State.lastNoteType,
        State.lastNoteMarkdown
      );
      El.noteModal.classList.add("hidden");
      alert("Saved to Zotero Note!");
    } catch (e) {
      alert(`Failed to save to Zotero: ${e.message}`);
    } finally {
      hideLoading();
    }
  } else {
    // Fallback: ask backend to handle it or just show the markdown
    alert("Zotero API not accessible from this window.\n\nThe note markdown is shown in the preview — copy and save manually, or use the Zotero plugin context.");
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────
$("btn-prev").addEventListener("click", () => {
  if (State.currentPage > 1) renderPage(State.currentPage - 1);
});
$("btn-next").addEventListener("click", () => {
  if (State.currentPage < State.pageCount) renderPage(State.currentPage + 1);
});

document.addEventListener("keydown", e => {
  if (El.markToolbar.classList.contains("hidden")) {
    if (e.key === "ArrowLeft"  && State.currentPage > 1) renderPage(State.currentPage - 1);
    if (e.key === "ArrowRight" && State.currentPage < State.pageCount) renderPage(State.currentPage + 1);
  }
});

// ── Resizable split pane ──────────────────────────────────────────────────────
function setupResizer() {
  const resizer   = $("resizer");
  const leftPanel = $("left-panel");
  let dragging = false;

  resizer.addEventListener("mousedown", e => {
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    const container = document.getElementById("main-split");
    const totalW = container.offsetWidth;
    const newLeftW = e.clientX - container.getBoundingClientRect().left;
    const pct = Math.max(30, Math.min(75, (newLeftW / totalW) * 100));
    leftPanel.style.flex = `0 0 ${pct}%`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

// ── Button wiring ─────────────────────────────────────────────────────────────
function setupButtons() {
  // No additional wiring needed beyond inline event listeners
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiGet(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function showLoading(msg = "Loading…") {
  $("loading-text").textContent = msg;
  El.loadingOverlay.classList.remove("hidden");
}
function hideLoading() {
  El.loadingOverlay.classList.add("hidden");
}

// ── Utility ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
