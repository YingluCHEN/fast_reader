/**
 * readerWindow.ts — Opens and tracks the dual-pane reader window.
 * Logic is also embedded directly in bootstrap.js for the XPI entry point.
 */
import { Settings } from "./settings";
import { saveNoteToZotero } from "./noteWriter";

const _openWindows = new Map<number, Window>();

export interface PaperInfo {
  paper_id: string;
  title: string;
  doi: string;
  page_count: number;
}

export function openReaderWindow(
  parentWin: Window,
  paperInfo: PaperInfo,
  zoteroItemId: number
): void {
  // Reuse existing window for the same item
  if (_openWindows.has(zoteroItemId)) {
    const existing = _openWindows.get(zoteroItemId)!;
    try { existing.focus(); return; } catch { _openWindows.delete(zoteroItemId); }
  }

  const params = new URLSearchParams({
    paper_id:       paperInfo.paper_id,
    title:          paperInfo.title   || "",
    doi:            paperInfo.doi     || "",
    page_count:     String(paperInfo.page_count),
    zotero_item_id: String(zoteroItemId),
  });

  const url = `chrome://ai-bilingual-reader/content/reader/index.html?${params}`;

  const win = parentWin.open(
    url,
    `ai-reader-${zoteroItemId}`,
    "chrome,dialog=no,resizable=yes,width=1400,height=900,scrollbars=yes"
  ) as Window | null;

  if (!win) return;

  _openWindows.set(zoteroItemId, win);
  win.addEventListener("unload", () => _openWindows.delete(zoteroItemId));

  // Expose Zotero note writer to the reader window
  (win as any).saveNoteToZotero = saveNoteToZotero;
}
