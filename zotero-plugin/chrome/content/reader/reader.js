"use strict";

const API_BASE = "http://127.0.0.1:8765";
const PAGE_IMAGE_SCALE = 2;
const NOTE_TYPE_OPTIONS = [
  "Writing Note - Introduction",
  "Writing Note - Research Gap",
  "Writing Note - Methods",
  "Writing Note - Validation",
  "Writing Note - Results",
  "Writing Note - Discussion",
  "Writing Note - Limitations",
  "Writing Note - Useful Expressions",
];

const MARK_COLORS = {
  "Background": "rgba(108,140,191,0.45)",
  "Research Gap": "rgba(224,85,85,0.45)",
  "Method": "rgba(76,175,130,0.45)",
  "Assumption": "rgba(156,111,191,0.45)",
  "Validation": "rgba(76,175,80,0.45)",
  "Result Expression": "rgba(255,152,0,0.45)",
  "Limitation": "rgba(244,67,54,0.45)",
  "Discussion": "rgba(33,150,243,0.45)",
  "Good Sentence": "rgba(255,235,59,0.45)",
};

const MARK_TYPE_ZH = {
  "Background": "\u7814\u7a76\u80cc\u666f",
  "Research Gap": "\u7814\u7a76\u7a7a\u767d",
  "Method": "\u65b9\u6cd5",
  "Assumption": "\u5047\u8bbe",
  "Validation": "\u9a8c\u8bc1",
  "Result Expression": "\u7ed3\u679c\u8868\u8ff0",
  "Limitation": "\u5c40\u9650",
  "Discussion": "\u8ba8\u8bba",
  "Good Sentence": "\u4f73\u53e5",
};

const State = {
  paperId: "",
  title: "",
  doi: "",
  pageCount: 1,
  zoteroItemId: 0,
  currentPage: 1,
  currentPageBlocks: [],
  currentPageOverlayTokens: [],
  pageMarks: [],
  allPaperMarks: [],
  pendingSelection: null,
  selectedMarkType: null,
  selectedNoteType: "",
  lastNoteMarkdown: "",
  lastNoteType: "",
  renderToken: 0,
  translatedPageCache: new Map(),
  markMetaZhCache: new Map(),
  pageImageObjectUrl: null,
  selectionDrag: null,
};

const $ = id => document.getElementById(id);

const El = {
  leftPanel: $("left-panel"),
  pdfContainer: $("pdf-container"),
  pdfError: $("pdf-error"),
  pageImage: $("pdf-page-image"),
  pdfFallbackText: $("pdf-fallback-text"),
  textLayer: $("text-layer"),
  dragSelectionBox: $("drag-selection-box"),
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
  loadingText: $("loading-text"),
  topbarTitle: $("topbar-title"),
  noteTypeTrigger: $("note-type-trigger"),
  noteTypeMenu: $("note-type-menu"),
};

(async function init() {
  try {
    parseURLParams();
    setupResizer();
    setupButtons();
    bindSelectionEvents();
    setupResizeHandler();
    await renderPage(State.currentPage);
  } catch (error) {
    console.error("[Reader] Initialization failed:", error);
    showLeftPanelError(`Reader initialization failed: ${error.message}`);
    El.blocksContainer.innerHTML =
      `<div style="color:#9c5a35;padding:12px">Reader initialization failed: ${esc(error.message)}</div>`;
  }
})();

function setupResizeHandler() {
  let _resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      renderTextOverlay(State.currentPageOverlayTokens);
    }, 150);
  });
}

function parseURLParams() {
  const params = new URLSearchParams(window.location.search);
  State.paperId = params.get("paper_id") || "";
  State.title = params.get("title") || "";
  State.doi = params.get("doi") || "";
  State.pageCount = parseInt(params.get("page_count") || "1", 10);
  State.zoteroItemId = parseInt(params.get("zotero_item_id") || "0", 10);

  document.title = State.title || "AI Bilingual Reader";
  El.topbarTitle.textContent = State.title || "AI Bilingual Reader";
  El.topbarTitle.title = State.title || "AI Bilingual Reader";
}

async function renderPage(pageNum) {
  const token = ++State.renderToken;
  State.currentPage = Math.max(1, Math.min(pageNum, State.pageCount));
  El.pageIndicator.textContent = `Page ${State.currentPage} / ${State.pageCount}`;

  try {
    const allMarksPromise = apiGet(`/api/marks?paper_id=${encodeURIComponent(State.paperId)}`).catch(() => []);
    El.rightStatus.textContent = "loading blocks...";
    const fastResponse = await apiGet(
      `/api/read/page?paper_id=${encodeURIComponent(State.paperId)}&page=${State.currentPage}&translate=false`
    );
    State.allPaperMarks = await allMarksPromise;
    if (token !== State.renderToken) {
      return;
    }

    State.pageCount = fastResponse.page_count || State.pageCount;
    State.currentPageBlocks = fastResponse.blocks || [];
    State.currentPageOverlayTokens = fastResponse.overlay_tokens || [];
    State.pageMarks = fastResponse.marks || [];
    renderMarksLocalized(State.pageMarks);
    hydrateMarkMetaChinese(State.pageMarks);
    renderBlocks(State.currentPageBlocks, false);
    await renderPageImage(State.currentPage, State.currentPageBlocks, token);
    renderTextOverlay(State.currentPageOverlayTokens);
    redrawHighlights();

    const cacheKey = `${State.paperId}:${State.currentPage}`;
    if (State.translatedPageCache.has(cacheKey)) {
      const cached = State.translatedPageCache.get(cacheKey);
      if (token !== State.renderToken) {
        return;
      }
      State.currentPageOverlayTokens = cached.overlay_tokens || State.currentPageOverlayTokens;
      // Keep marks from the fresh fast-fetch above — cache may be stale
      renderBlocks(cached.blocks || [], true);
      renderTextOverlay(State.currentPageOverlayTokens);
      redrawHighlights();
      El.rightStatus.textContent = `${(cached.blocks || []).length} blocks`;
      prefetchPage(State.currentPage + 1);
      return;
    }

    El.rightStatus.textContent = "translating...";
    const translatedResponse = await apiGet(
      `/api/read/page?paper_id=${encodeURIComponent(State.paperId)}&page=${State.currentPage}&translate=true`
    );
    State.translatedPageCache.set(cacheKey, translatedResponse);
    if (token !== State.renderToken) {
      return;
    }

    State.currentPageOverlayTokens = translatedResponse.overlay_tokens || State.currentPageOverlayTokens;
    renderBlocks(translatedResponse.blocks || [], true);
    renderTextOverlay(State.currentPageOverlayTokens);
    redrawHighlights();
    El.rightStatus.textContent = `${(translatedResponse.blocks || []).length} blocks`;
    prefetchPage(State.currentPage + 1);
  } catch (error) {
    if (token !== State.renderToken) {
      return;
    }
    showLeftPanelError(`Failed to render page ${State.currentPage}: ${error.message}`);
    El.blocksContainer.innerHTML =
      `<div style="color:#9c5a35;padding:12px">Loading failed: ${esc(error.message)}</div>`;
    El.rightStatus.textContent = "error";
  }
}

async function renderPageImage(pageNum, blocks, token) {
  const path =
    `/api/read/page-image?paper_id=${encodeURIComponent(State.paperId)}&page=${pageNum}&scale=${PAGE_IMAGE_SCALE}`;

  try {
    const blob = await apiGetBlob(path);
    if (token !== State.renderToken) {
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const size = await loadImageIntoElement(El.pageImage, objectUrl);
    if (token !== State.renderToken) {
      URL.revokeObjectURL(objectUrl);
      return;
    }

    if (State.pageImageObjectUrl) {
      URL.revokeObjectURL(State.pageImageObjectUrl);
    }
    State.pageImageObjectUrl = objectUrl;

    El.pdfContainer.style.width = `${size.width}px`;
    El.pdfContainer.style.height = `${size.height}px`;
    El.textLayer.style.width = `${size.width}px`;
    El.textLayer.style.height = `${size.height}px`;
    El.hlCanvas.width = size.width;
    El.hlCanvas.height = size.height;
    El.pdfFallbackText.classList.add("hidden");
    El.pageImage.classList.remove("hidden");
    clearLeftPanelError();
  } catch (error) {
    console.error("[Reader] Page image load error:", error);
    renderTextFallback(blocks, error.message);
  }
}

function renderTextOverlay(tokens) {
  if (El.pdfFallbackText && !El.pdfFallbackText.classList.contains("hidden")) {
    El.textLayer.innerHTML = "";
    clearOverlayTokenSelection();
    return;
  }

  const width = El.pageImage.clientWidth || El.pageImage.naturalWidth;
  const height = El.pageImage.clientHeight || El.pageImage.naturalHeight;
  if (!width || !height) {
    return;
  }

  El.textLayer.innerHTML = "";
  El.textLayer.style.width = `${width}px`;
  El.textLayer.style.height = `${height}px`;
  clearOverlayTokenSelection();
  hideDragSelectionBox();
  State.selectionDrag = null;

  (tokens || []).forEach((token, index) => {
    const span = document.createElement("span");
    span.className = "pdf-text-span";
    span.textContent = token.text || "";
    span.dataset.tokenId = token.token_id || "";
    span.dataset.tokenIndex = String(index);
    span.style.left = `${(token.x || 0) * width}px`;
    span.style.top = `${(token.y || 0) * height}px`;
    span.style.width = `${(token.width || 0) * width}px`;
    span.style.height = `${(token.height || 0) * height}px`;
    span.style.fontSize = `${Math.max(10, (token.height || 0) * height * 0.86)}px`;
    El.textLayer.appendChild(span);
  });
}

function renderTextFallback(blocks, reason) {
  const hint = reason.includes("404")
    ? "Image preview endpoint is unavailable. Please restart local-ai-service to load the new /api/read/page-image route."
    : `Image preview unavailable. Switched to text preview. ${reason}`;
  showLeftPanelError(hint);
  El.pageImage.classList.add("hidden");
  El.textLayer.innerHTML = "";
  El.hlCanvas.width = 0;
  El.hlCanvas.height = 0;
  El.pdfFallbackText.classList.remove("hidden");

  if (!blocks.length) {
    El.pdfFallbackText.innerHTML = "<p>No text blocks available for this page.</p>";
    return;
  }

  El.pdfFallbackText.innerHTML = blocks.map(block =>
    `<p class="pdf-fallback-paragraph">${esc(block.en || "")}</p>`
  ).join("");
}

function renderBlocks(blocks, translated) {
  if (!blocks.length) {
    El.blocksContainer.innerHTML =
      '<div style="color:#7b6a48;padding:12px">No text blocks on this page.</div>';
    return;
  }

  El.blocksContainer.innerHTML = blocks.map(block => `
    <div class="block-item" data-block-id="${esc(block.block_id)}">
      <div class="block-en">${esc(block.en)}</div>
      <div class="block-zh">${translated ? esc(block.zh || "") : '<span class="block-zh-placeholder">Translating...</span>'}</div>
    </div>
  `).join("");
}

function renderMarks(marks) {
  if (!marks.length) {
    if (State.allPaperMarks.length) {
      const pages = Array.from(new Set(State.allPaperMarks.map(mark => mark.page_number)))
        .sort((a, b) => a - b)
        .join(", ");
      El.marksContainer.innerHTML =
        `<div style="color:#7b6a48;padding:8px;font-size:12px">No marks on page ${State.currentPage}. This paper already has ${State.allPaperMarks.length} mark(s) on page(s): ${esc(pages)}.</div>`;
      return;
    }

    El.marksContainer.innerHTML =
      '<div style="color:#7b6a48;padding:8px;font-size:12px">No marks saved for this paper yet.</div>';
    return;
  }

  El.marksContainer.innerHTML = marks.map(mark => {
    const colorClass = `mark-color-${(mark.mark_type || "").replace(/\s+/g, "-")}`;
    return `
      <div class="mark-item ${colorClass}" data-mark-id="${esc(mark.mark_id)}">
        <div class="mark-item-header">
          <span class="mark-type-badge">${esc(mark.mark_type)}</span>
          <button class="mark-delete-btn" data-mark-id="${esc(mark.mark_id)}" title="Delete mark">✕</button>
        </div>
        <div class="mark-original" onclick="flashMark('${esc(mark.mark_id)}')">"${esc(mark.selected_original)}"</div>
        <div class="mark-zh">${esc(mark.ai_translation || "")}</div>
        ${mark.ai_summary ? `<div class="mark-summary">${esc(mark.ai_summary)}</div>` : ""}
        ${mark.possible_use_in_my_paper ? `<div class="mark-possible-use">💡 ${esc(mark.possible_use_in_my_paper)}</div>` : ""}
        ${mark.user_comment ? `<div class="mark-user-comment">📝 ${esc(mark.user_comment)}</div>` : ""}
      </div>
    `;
  }).join("");

  El.marksContainer.querySelectorAll(".mark-delete-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      deleteMark(btn.dataset.markId);
    });
  });
}

function renderMarksLocalized(marks) {
  if (!marks.length) {
    if (State.allPaperMarks.length) {
      const pages = Array.from(new Set(State.allPaperMarks.map(mark => mark.page_number)))
        .sort((a, b) => a - b)
        .join(", ");
      El.marksContainer.innerHTML =
        `<div style="color:#7b6a48;padding:8px;font-size:12px">当前第 ${State.currentPage} 页没有标注。这篇文献已有 ${State.allPaperMarks.length} 条标注，位于第 ${esc(pages)} 页。</div>`;
      return;
    }

    El.marksContainer.innerHTML =
      '<div style="color:#7b6a48;padding:8px;font-size:12px">这篇文献暂时还没有标注。</div>';
    return;
  }

  El.marksContainer.innerHTML = marks.map(mark => {
    const colorClass = `mark-color-${(mark.mark_type || "").replace(/\s+/g, "-")}`;
    const markTypeLabel = MARK_TYPE_ZH[mark.mark_type] || mark.mark_type || "";
    const summary = getLocalizedMarkText(mark.ai_summary || "");
    const possibleUse = getLocalizedMarkText(mark.possible_use_in_my_paper || "");
    return `
      <div class="mark-item ${colorClass}" data-mark-id="${esc(mark.mark_id)}">
        <div class="mark-item-header">
          <span class="mark-type-badge">${esc(markTypeLabel)}</span>
          <button class="mark-delete-btn" data-mark-id="${esc(mark.mark_id)}" title="Delete mark">删除</button>
        </div>
        <div class="mark-original" onclick="flashMark('${esc(mark.mark_id)}')">"${esc(mark.selected_original)}"</div>
        <div class="mark-zh">${esc(mark.ai_translation || "")}</div>
        ${summary ? `<div class="mark-summary">${esc(summary)}</div>` : ""}
        ${possibleUse ? `<div class="mark-possible-use">可用于：${esc(possibleUse)}</div>` : ""}
        ${mark.user_comment ? `<div class="mark-user-comment">备注：${esc(mark.user_comment)}</div>` : ""}
      </div>
    `;
  }).join("");

  El.marksContainer.querySelectorAll(".mark-delete-btn").forEach(btn => {
    btn.addEventListener("click", event => {
      event.stopPropagation();
      deleteMark(btn.dataset.markId);
    });
  });
}

function getLocalizedMarkText(text) {
  if (!text) {
    return "";
  }
  return State.markMetaZhCache.get(text) || text;
}

async function hydrateMarkMetaChinese(marks) {
  const texts = Array.from(new Set(
    marks
      .flatMap(mark => [mark.ai_summary || "", mark.possible_use_in_my_paper || ""])
      .map(text => text.trim())
      .filter(text => text && looksEnglishLike(text) && !State.markMetaZhCache.has(text))
  ));

  if (!texts.length) {
    return;
  }

  try {
    const response = await apiPost("/api/translate/snippets", { texts });
    const translations = response.translations || [];
    texts.forEach((text, index) => {
      const zh = (translations[index] || "").trim();
      if (zh) {
        State.markMetaZhCache.set(text, zh);
      }
    });
    renderMarksLocalized(State.pageMarks);
  } catch (_error) {
    // Keep original English if translation fails.
  }
}

function looksEnglishLike(text) {
  return /[A-Za-z]/.test(text) && !/[\u4e00-\u9fff]/.test(text);
}

function prefetchPage(pageNum) {
  if (pageNum < 1 || pageNum > State.pageCount) return;
  const cacheKey = `${State.paperId}:${pageNum}`;
  if (State.translatedPageCache.has(cacheKey)) return;
  apiGet(
    `/api/read/page?paper_id=${encodeURIComponent(State.paperId)}&page=${pageNum}&translate=true`
  ).then(response => {
    if (!State.translatedPageCache.has(cacheKey)) {
      State.translatedPageCache.set(cacheKey, response);
    }
  }).catch(() => {});
}

async function deleteMark(markId) {
  try {
    const response = await fetch(`${API_BASE}/api/marks/${encodeURIComponent(markId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`${response.status}: ${text}`);
    }
    State.pageMarks = State.pageMarks.filter(m => m.mark_id !== markId);
    renderMarksLocalized(State.pageMarks);
    redrawHighlights();
  } catch (error) {
    alert(`Failed to delete mark: ${error.message}`);
  }
}

function redrawHighlights() {
  const ctx = El.hlCanvas.getContext("2d");
  ctx.clearRect(0, 0, El.hlCanvas.width, El.hlCanvas.height);
}

window.flashMark = function flashMark(markId) {
  const mark = State.pageMarks.find(item => item.mark_id === markId);
  if (!mark || !mark.pdf_rects || !mark.pdf_rects.length) {
    return;
  }
  const firstRect = mark.pdf_rects[0];
  if (firstRect && El.leftPanel && El.pdfContainer) {
    const pdfTop = El.pdfContainer.offsetTop;
    El.leftPanel.scrollTop = pdfTop + firstRect.y * El.hlCanvas.height - 100;
  }
};

function bindSelectionEvents() {
  El.textLayer.addEventListener("mousedown", startDragSelection);
  document.addEventListener("mousemove", updateDragSelection);
  document.addEventListener("mouseup", finishDragSelection);

  El.markToolbar.querySelectorAll("[data-type]").forEach(button => {
    button.addEventListener("click", () => {
      El.markToolbar.querySelectorAll("[data-type]").forEach(node => {
        node.style.background = "";
      });
      button.style.background = "#d8c685";
      State.selectedMarkType = button.dataset.type;
    });
  });

  $("toolbar-cancel").addEventListener("click", hideMarkToolbar);
  $("toolbar-save").addEventListener("click", async () => {
    if (!State.pendingSelection) {
      hideMarkToolbar();
      return;
    }
    if (!State.selectedMarkType) {
      alert("Please select a mark type.");
      return;
    }
    await saveMark();
  });
}

function startDragSelection(event) {
  if (event.button !== 0 || !El.pdfFallbackText.classList.contains("hidden")) {
    return;
  }

  const containerRect = El.textLayer.getBoundingClientRect();
  if (!pointInRect(event.clientX, event.clientY, containerRect)) {
    return;
  }

  event.preventDefault();
  hideMarkToolbar(false);
  clearOverlayTokenSelection();

  const start = clientPointToNormalized(event.clientX, event.clientY, containerRect);
  const tokenElement = event.target?.closest?.(".pdf-text-span");
  const tokenIndex = tokenElement ? parseInt(tokenElement.dataset.tokenIndex || "-1", 10) : -1;
  State.selectionDrag = {
    startX: start.x,
    startY: start.y,
    currentX: start.x,
    currentY: start.y,
    startClientX: event.clientX,
    startClientY: event.clientY,
    tokenIndex,
    selectedIndexes: [],
  };
  updateDragSelectionBox(normalizedRectFromPoints(start.x, start.y, start.x, start.y));
}

function updateDragSelection(event) {
  if (!State.selectionDrag) {
    return;
  }

  const containerRect = El.textLayer.getBoundingClientRect();
  // Allow unclamped coordinates so the drag box can extend beyond the page boundary
  const rawX = (event.clientX - containerRect.left) / Math.max(containerRect.width, 1);
  const rawY = (event.clientY - containerRect.top) / Math.max(containerRect.height, 1);
  State.selectionDrag.currentX = rawX;
  State.selectionDrag.currentY = rawY;

  const selectionRect = normalizedRectFromPoints(
    State.selectionDrag.startX,
    State.selectionDrag.startY,
    State.selectionDrag.currentX,
    State.selectionDrag.currentY
  );

  updateDragSelectionBox(selectionRect);
  // Token matching still uses clamped [0,1] coords to stay within page bounds
  const clampedRect = {
    x: clamp01(selectionRect.x),
    y: clamp01(selectionRect.y),
    width: clamp01(Math.min(selectionRect.x + selectionRect.width, 1) - clamp01(selectionRect.x)),
    height: clamp01(Math.min(selectionRect.y + selectionRect.height, 1) - clamp01(selectionRect.y)),
  };
  State.selectionDrag.selectedIndexes = collectSelectedTokenIndexes(clampedRect);
  applyOverlayTokenSelection(State.selectionDrag.selectedIndexes);
}

function finishDragSelection(event) {
  if (!State.selectionDrag) {
    return;
  }

  const drag = State.selectionDrag;
  State.selectionDrag = null;
  hideDragSelectionBox();

  let selectedIndexes = drag.selectedIndexes || [];
  const movedDistance = Math.abs(event.clientX - drag.startClientX) + Math.abs(event.clientY - drag.startClientY);
  if (!selectedIndexes.length && movedDistance < 6 && drag.tokenIndex >= 0) {
    selectedIndexes = [drag.tokenIndex];
    applyOverlayTokenSelection(selectedIndexes);
  }

  if (!selectedIndexes.length) {
    clearOverlayTokenSelection();
    return;
  }

  const selectedTokens = selectedIndexes
    .map(index => State.currentPageOverlayTokens[index])
    .filter(Boolean);
  const text = joinSelectedTokens(selectedTokens);
  const rects = selectedTokens.map(token => ({
    x: clamp01(token.x || 0),
    y: clamp01(token.y || 0),
    width: clamp01(token.width || 0),
    height: clamp01(token.height || 0),
  }));

  if (!text || text.length < 2 || !rects.length) {
    clearOverlayTokenSelection();
    return;
  }

  setPendingSelection(text, rects, event.clientX + window.scrollX + 8, event.clientY + window.scrollY + 8);
}

function showMarkToolbar(x, y) {
  El.markToolbar.classList.remove("hidden");
  El.toolbarComment.value = "";

  const maxX = window.innerWidth - El.markToolbar.offsetWidth - 10;
  const maxY = window.innerHeight - El.markToolbar.offsetHeight - 10;
  El.markToolbar.style.left = `${Math.min(x, maxX)}px`;
  El.markToolbar.style.top = `${Math.min(y, maxY)}px`;

  El.markToolbar.querySelectorAll("[data-type]").forEach(button => {
    button.style.background = "";
  });
}

function setPendingSelection(text, rects, x, y) {
  State.pendingSelection = { text, rects };
  State.selectedMarkType = null;
  showMarkToolbar(x, y);
}

function hideMarkToolbar(clearSelection = true) {
  El.markToolbar.classList.add("hidden");
  State.pendingSelection = null;
  State.selectedMarkType = null;
  if (clearSelection) {
    clearOverlayTokenSelection();
  }
}

async function saveMark() {
  const selection = State.pendingSelection;
  const markType = State.selectedMarkType;
  const comment = El.toolbarComment.value.trim();

  hideMarkToolbar();
  showLoading("Saving mark...");

  try {
    const body = {
      paper_id: State.paperId,
      zotero_item_id: State.zoteroItemId,
      page_number: State.currentPage,
      selected_original: selection.text,
      pdf_rects: selection.rects,
      mark_type: markType,
      user_comment: comment,
    };

    const mark = await apiPost("/api/marks", body);
    State.pageMarks.push(mark);
    State.allPaperMarks.push(mark);
    renderMarksLocalized(State.pageMarks);
    redrawHighlights();
  } catch (error) {
    alert(`Failed to save mark: ${error.message}`);
  } finally {
    hideLoading();
  }
}

function setupButtons() {
  El.noteTypeTrigger.addEventListener("click", event => {
    event.stopPropagation();
    El.noteTypeMenu.classList.toggle("hidden");
  });

  El.noteTypeMenu.querySelectorAll("[data-note-type]").forEach(button => {
    button.addEventListener("click", () => {
      State.selectedNoteType = button.dataset.noteType || "";
      El.noteTypeTrigger.textContent = button.textContent;
      El.noteTypeMenu.classList.add("hidden");
    });
  });

  document.addEventListener("click", event => {
    if (!El.noteTypeMenu.classList.contains("hidden") && !El.noteTypeMenu.contains(event.target) && event.target !== El.noteTypeTrigger) {
      El.noteTypeMenu.classList.add("hidden");
    }
  });

  $("btn-generate-note").addEventListener("click", async () => {
    const noteType = State.selectedNoteType;
    if (!noteType || !NOTE_TYPE_OPTIONS.includes(noteType)) {
      alert("Please choose a note type first.");
      return;
    }

    showLoading("Generating Writing Note...");
    try {
      const response = await apiPost("/api/notes/generate", { note_type: noteType });
      State.lastNoteMarkdown = response.note_markdown;
      State.lastNoteType = noteType;

      El.noteModalTitle.textContent = noteType;
      El.noteModalContent.textContent = response.note_markdown;
      El.noteModal.classList.remove("hidden");
    } catch (error) {
      alert(`Note generation failed: ${error.message}`);
    } finally {
      hideLoading();
    }
  });

  $("note-modal-close").addEventListener("click", () => {
    El.noteModal.classList.add("hidden");
  });

  $("note-modal-save").addEventListener("click", () => {
    $("btn-save-zotero").click();
  });

  $("btn-save-zotero").addEventListener("click", async () => {
    if (!State.lastNoteMarkdown) {
      alert("Generate a Writing Note first.");
      return;
    }

    const saveFn = window._saveNoteToZotero ?? window.opener?._saveNoteToZotero;
    if (typeof saveFn !== "function") {
      alert("Zotero API is not accessible from this reader window.");
      return;
    }

    showLoading("Saving to Zotero...");
    try {
      await saveFn(State.zoteroItemId, State.lastNoteType, State.lastNoteMarkdown);
      El.noteModal.classList.add("hidden");
      alert("Saved to Zotero Note.");
    } catch (error) {
      alert(`Failed to save to Zotero: ${error.message}`);
    } finally {
      hideLoading();
    }
  });

  $("btn-prev").addEventListener("click", () => {
    if (State.currentPage > 1) {
      renderPage(State.currentPage - 1);
    }
  });

  $("btn-next").addEventListener("click", () => {
    if (State.currentPage < State.pageCount) {
      renderPage(State.currentPage + 1);
    }
  });

  document.addEventListener("keydown", event => {
    if (El.markToolbar.classList.contains("hidden")) {
      if (event.key === "ArrowLeft" && State.currentPage > 1) {
        renderPage(State.currentPage - 1);
      }
      if (event.key === "ArrowRight" && State.currentPage < State.pageCount) {
        renderPage(State.currentPage + 1);
      }
    }
  });
}

function setupResizer() {
  const resizer = $("resizer");
  const leftPanel = $("left-panel");
  let dragging = false;

  resizer.addEventListener("mousedown", event => {
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  });

  document.addEventListener("mousemove", event => {
    if (!dragging) {
      return;
    }

    const container = $("main-split");
    const totalWidth = container.offsetWidth;
    const newLeftWidth = event.clientX - container.getBoundingClientRect().left;
    const percent = Math.max(30, Math.min(75, (newLeftWidth / totalWidth) * 100));
    leftPanel.style.flex = `0 0 ${percent}%`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

function loadImageIntoElement(img, objectUrl) {
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    img.onerror = () => reject(new Error("Could not decode page image."));
    img.src = objectUrl;
  });
}

function clearOverlayTokenSelection() {
  El.textLayer.querySelectorAll(".pdf-text-span.is-selected").forEach(node => {
    node.classList.remove("is-selected");
  });
}

function applyOverlayTokenSelection(indexes) {
  clearOverlayTokenSelection();
  indexes.forEach(index => {
    const node = El.textLayer.querySelector(`[data-token-index="${index}"]`);
    node?.classList.add("is-selected");
  });
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function clientPointToNormalized(clientX, clientY, rect) {
  return {
    x: clamp01((clientX - rect.left) / Math.max(rect.width, 1)),
    y: clamp01((clientY - rect.top) / Math.max(rect.height, 1)),
  };
}

function normalizedRectFromPoints(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  return {
    x: clamp01(left),
    y: clamp01(top),
    width: clamp01(right - left),
    height: clamp01(bottom - top),
  };
}

function updateDragSelectionBox(rect) {
  const width = El.textLayer.clientWidth || El.pageImage.clientWidth || 0;
  const height = El.textLayer.clientHeight || El.pageImage.clientHeight || 0;
  El.dragSelectionBox.classList.remove("hidden");
  El.dragSelectionBox.style.left = `${rect.x * width}px`;
  El.dragSelectionBox.style.top = `${rect.y * height}px`;
  El.dragSelectionBox.style.width = `${rect.width * width}px`;
  El.dragSelectionBox.style.height = `${rect.height * height}px`;
}

function hideDragSelectionBox() {
  El.dragSelectionBox.classList.add("hidden");
  El.dragSelectionBox.style.width = "0px";
  El.dragSelectionBox.style.height = "0px";
}

function collectSelectedTokenIndexes(selectionRect) {
  const indexes = [];
  State.currentPageOverlayTokens.forEach((token, index) => {
    const tokenRect = {
      x: clamp01(token.x || 0),
      y: clamp01(token.y || 0),
      width: clamp01(token.width || 0),
      height: clamp01(token.height || 0),
    };
    if (rectsIntersect(tokenRect, selectionRect)) {
      indexes.push(index);
    }
  });
  return indexes;
}

function rectsIntersect(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function joinSelectedTokens(tokens) {
  return tokens.map(token => token.text || "").filter(Boolean).join(" ").trim();
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function apiGetBlob(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.blob();
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

function showLoading(message = "Loading...") {
  El.loadingText.textContent = message;
  El.loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  El.loadingOverlay.classList.add("hidden");
}

function showLeftPanelError(message) {
  El.pdfError.textContent = message;
  El.pdfError.classList.remove("hidden");
}

function clearLeftPanelError() {
  El.pdfError.textContent = "";
  El.pdfError.classList.add("hidden");
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
