"use strict";

/* global Components, Services, ChromeUtils */

var { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

// ─── Plugin state ────────────────────────────────────────────────────────────
var AIBilingualReader = {
  id: "ai-bilingual-reader@zotero",
  _menuItem: null,
  _windows: new Map(), // itemID → reader window

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  init({ id, version, rootURI }) {
    this.rootURI = rootURI;
    this._addToAllWindows();
    Services.wm.addListener(this._windowListener);
  },

  shutdown() {
    Services.wm.removeListener(this._windowListener);
    this._removeFromAllWindows();
    this._windows.forEach(w => { try { w.close(); } catch (e) {} });
    this._windows.clear();
  },

  // ── Window management ─────────────────────────────────────────────────────
  _addToAllWindows() {
    const wins = Services.wm.getEnumerator("navigator:browser");
    while (wins.hasMoreElements()) {
      const win = wins.getNext();
      if (!win.AIBilingualReader) this._addToWindow(win);
    }
    // Zotero main window type
    const zwins = Services.wm.getEnumerator("zotero:basicViewer");
    while (zwins.hasMoreElements()) {
      const win = zwins.getNext();
      if (!win.AIBilingualReader) this._addToWindow(win);
    }
  },

  _removeFromAllWindows() {
    const wins = Services.wm.getEnumerator("navigator:browser");
    while (wins.hasMoreElements()) {
      this._removeFromWindow(wins.getNext());
    }
  },

  _addToWindow(win) {
    if (!win.document) return;
    win.AIBilingualReader = this;
    this._injectMenu(win);
  },

  _removeFromWindow(win) {
    this._removeMenu(win);
    delete win.AIBilingualReader;
  },

  _windowListener: {
    onOpenWindow(xulWindow) {
      const win = xulWindow.QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsIDOMWindow);
      win.addEventListener("load", function onLoad() {
        win.removeEventListener("load", onLoad);
        if (win.AIBilingualReader) return;
        AIBilingualReader._addToWindow(win);
      });
    },
    onCloseWindow() {},
    onWindowTitleChange() {},
  },

  // ── Context menu injection ─────────────────────────────────────────────────
  _injectMenu(win) {
    const doc = win.document;
    // Zotero item context menu id
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup) return;

    if (doc.getElementById("ai-bilingual-read-menuitem")) return;

    const sep = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuseparator"
    );
    sep.id = "ai-bilingual-read-sep";

    const item = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      "menuitem"
    );
    item.id = "ai-bilingual-read-menuitem";
    item.setAttribute("label", "AI Bilingual Read");
    item.setAttribute("oncommand", "AIBilingualReader.onMenuCommand(window);");

    popup.appendChild(sep);
    popup.appendChild(item);
  },

  _removeMenu(win) {
    const doc = win.document;
    ["ai-bilingual-read-sep", "ai-bilingual-read-menuitem"].forEach(id => {
      const el = doc.getElementById(id);
      if (el) el.remove();
    });
  },

  // ── Menu handler ──────────────────────────────────────────────────────────
  async onMenuCommand(win) {
    try {
      const item = Zotero.getActiveZoteroPane().getSelectedItems()[0];
      if (!item) {
        Services.prompt.alert(win, "AI Bilingual Reader", "Please select a Zotero item.");
        return;
      }

      const pdfPath = await this._getPDFPath(item);
      if (!pdfPath) {
        Services.prompt.alert(win, "AI Bilingual Reader", "No PDF attachment found for this item.");
        return;
      }

      const paperMeta = this._extractMeta(item);

      // Register the paper with the backend
      let paperInfo;
      try {
        paperInfo = await this._startReading(paperMeta, pdfPath);
      } catch (e) {
        Services.prompt.alert(win, "AI Bilingual Reader",
          `Cannot reach local AI service at http://127.0.0.1:8765.\n\nPlease start it with:\n  python app.py\n\nError: ${e.message}`);
        return;
      }

      this._openReaderWindow(win, paperInfo, pdfPath, item.id);
    } catch (e) {
      Cu.reportError(e);
      Services.prompt.alert(win, "AI Bilingual Reader", `Error: ${e.message}`);
    }
  },

  async _getPDFPath(item) {
    const attachments = item.getAttachments();
    for (const attId of attachments) {
      const att = Zotero.Items.get(attId);
      if (att && att.attachmentContentType === "application/pdf") {
        const path = att.getFilePath();
        if (path) return path;
      }
    }
    return null;
  },

  _extractMeta(item) {
    const creators = (item.getCreators() || []).map(c => ({
      firstName: c.firstName || "",
      lastName: c.lastName || "",
    }));
    return {
      zotero_item_id: item.id,
      title: item.getField("title") || "",
      doi: item.getField("DOI") || "",
      year: item.getField("year") || "",
      authors: creators,
    };
  },

  async _startReading(meta, pdfPath) {
    const body = { ...meta, pdf_path: pdfPath };
    const resp = await fetch("http://127.0.0.1:8765/api/read/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
    return resp.json();
  },

  _openReaderWindow(parentWin, paperInfo, pdfPath, zoteroItemId) {
    // If a reader for this item is already open, focus it
    if (this._windows.has(zoteroItemId)) {
      const existing = this._windows.get(zoteroItemId);
      try {
        existing.focus();
        return;
      } catch (e) {
        this._windows.delete(zoteroItemId);
      }
    }

    const params = new URLSearchParams({
      paper_id: paperInfo.paper_id,
      title: paperInfo.title || "",
      doi: paperInfo.doi || "",
      page_count: String(paperInfo.page_count || 1),
      zotero_item_id: String(zoteroItemId),
    });

    const url = `chrome://ai-bilingual-reader/content/reader/index.html?${params.toString()}`;

    const readerWin = parentWin.open(
      url,
      `ai-bilingual-reader-${zoteroItemId}`,
      "chrome,dialog=no,resizable=yes,width=1400,height=900,scrollbars=yes"
    );

    if (readerWin) {
      readerWin._zoteroItemId = zoteroItemId;
      this._windows.set(zoteroItemId, readerWin);
      readerWin.addEventListener("unload", () => {
        this._windows.delete(zoteroItemId);
      });
    }
  },
};

// ─── Bootstrap entry points ───────────────────────────────────────────────────
function startup({ id, version, rootURI }) {
  AIBilingualReader.init({ id, version, rootURI });
}

function shutdown() {
  AIBilingualReader.shutdown();
}

function install() {}
function uninstall() {}
