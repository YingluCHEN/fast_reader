import { getSelectedItemMeta } from "./zoteroItem";
import { ApiClient } from "./apiClient";
import { saveNoteToZotero } from "./noteWriter";
import { Settings } from "./settings";

declare const Zotero: any;
declare const Services: any;

const openWindows = new Map<number, Window>();

export async function onMenuCommand(win: Window): Promise<void> {
  try {
    const meta = await getSelectedItemMeta();
    if (!meta) {
      alert("Please select a Zotero item.");
      return;
    }
    if (!meta.pdfPath) {
      alert("No PDF attachment found for this item.");
      return;
    }

    let paperInfo;
    try {
      paperInfo = await ApiClient.startReading({
        zotero_item_id: meta.zoteroItemId,
        pdf_path: meta.pdfPath,
        title: meta.title,
        doi: meta.doi,
        authors: meta.authors,
        year: meta.year,
      });
    } catch (e: any) {
      alert(
        `Cannot reach local AI service at ${Settings.apiBase()}.\n\nPlease start it:\n  cd local-ai-service && python app.py\n\n${e.message}`
      );
      return;
    }

    openReaderWindow(win, paperInfo, meta.zoteroItemId);
  } catch (e: any) {
    console.error("[AI Bilingual Reader]", e);
    alert(`Error: ${e.message}`);
  }
}

function openReaderWindow(
  parentWin: Window,
  paperInfo: { paper_id: string; title: string; doi: string; page_count: number },
  zoteroItemId: number
): void {
  if (openWindows.has(zoteroItemId)) {
    try {
      openWindows.get(zoteroItemId)!.focus();
      return;
    } catch {
      openWindows.delete(zoteroItemId);
    }
  }

  const params = new URLSearchParams({
    paper_id: paperInfo.paper_id,
    title: paperInfo.title || "",
    doi: paperInfo.doi || "",
    page_count: String(paperInfo.page_count),
    zotero_item_id: String(zoteroItemId),
  });

  const url = `chrome://ai-bilingual-reader/content/reader/index.html?${params}`;
  const readerWin = parentWin.open(
    url,
    `ai-reader-${zoteroItemId}`,
    "chrome,dialog=no,resizable=yes,width=1400,height=900,scrollbars=yes"
  ) as Window | null;

  if (readerWin) {
    openWindows.set(zoteroItemId, readerWin);
    readerWin.addEventListener("unload", () => openWindows.delete(zoteroItemId));
    // Expose note-writer to reader window
    (readerWin as any).saveNoteToZotero = saveNoteToZotero;
  }
}
