"use strict";

var { classes: Cc, interfaces: Ci } = Components;

const CONTENT_PACKAGE = "ai-bilingual-reader";
const ITEM_MENU_ID = "zotero-itemmenu";
const ITEM_COMMAND_ID = "ai-bilingual-read-menuitem";
const ITEM_SEPARATOR_ID = "ai-bilingual-read-sep";
const TOOLS_POPUP_IDS = ["menu_ToolsPopup", "toolsMenuPopup"];
const TOOLS_COMMAND_ID = "ai-bilingual-read-tools-menuitem";

let chromeHandle = null;

function registerChrome(rootURI) {
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup)
    .registerChrome(manifestURI, [
      ["content", CONTENT_PACKAGE, "chrome/content/"],
    ]);
}

var AIBilingualReader = {
  _rootURI: "",
  _windowListener: null,
  _readerWindows: new Map(),

  init({ rootURI }) {
    this._rootURI = rootURI;
    this._addToAllWindows();

    this._windowListener = {
      onOpenWindow: xulWindow => {
        const win = xulWindow
          .QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIDOMWindow);
        win.addEventListener("load", () => this._addToWindow(win), { once: true });
      },
      onCloseWindow: () => {},
      onWindowTitleChange: () => {},
    };

    Services.wm.addListener(this._windowListener);
  },

  shutdown() {
    if (this._windowListener) {
      Services.wm.removeListener(this._windowListener);
      this._windowListener = null;
    }

    this._forEachMainWindow(win => this._removeFromWindow(win));

    this._readerWindows.forEach(win => {
      try {
        win.close();
      } catch (_error) {}
    });
    this._readerWindows.clear();
  },

  _forEachMainWindow(callback) {
    if (typeof Zotero !== "undefined" && typeof Zotero.getMainWindows === "function") {
      for (const win of Zotero.getMainWindows()) {
        callback(win);
      }
      return;
    }

    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      callback(enumerator.getNext());
    }
  },

  _addToAllWindows() {
    this._forEachMainWindow(win => this._addToWindow(win));
  },

  _addToWindow(win) {
    if (!win || !win.document) {
      return;
    }

    this._ensureItemContextMenu(win.document);
    this._ensureToolsMenu(win.document);
  },

  _removeFromWindow(win) {
    if (!win || !win.document) {
      return;
    }

    [
      ITEM_SEPARATOR_ID,
      ITEM_COMMAND_ID,
      TOOLS_COMMAND_ID,
    ].forEach(id => {
      win.document.getElementById(id)?.remove();
    });
  },

  _ensureItemContextMenu(doc) {
    const popup = doc.getElementById(ITEM_MENU_ID);
    if (!popup || doc.getElementById(ITEM_COMMAND_ID)) {
      return;
    }

    const sep = this._createMenuNode(doc, "menuseparator");
    sep.id = ITEM_SEPARATOR_ID;

    const item = this._createMenuNode(doc, "menuitem");
    item.id = ITEM_COMMAND_ID;
    item.setAttribute("label", "AI Bilingual Read");
    item.addEventListener("command", () => this.onMenuCommand(doc.defaultView));

    popup.appendChild(sep);
    popup.appendChild(item);
  },

  _ensureToolsMenu(doc) {
    if (doc.getElementById(TOOLS_COMMAND_ID)) {
      return;
    }

    const popup = this._findToolsPopup(doc);
    if (!popup) {
      return;
    }

    const item = this._createMenuNode(doc, "menuitem");
    item.id = TOOLS_COMMAND_ID;
    item.setAttribute("label", "AI Bilingual Read");
    item.addEventListener("command", () => this.onMenuCommand(doc.defaultView));
    popup.appendChild(item);
  },

  _findToolsPopup(doc) {
    for (const id of TOOLS_POPUP_IDS) {
      const popup = doc.getElementById(id);
      if (popup) {
        return popup;
      }
    }

    const toolsMenu = doc.getElementById("menu_Tools");
    if (toolsMenu && toolsMenu.menupopup) {
      return toolsMenu.menupopup;
    }

    return null;
  },

  _createMenuNode(doc, tagName) {
    return doc.createXULElement
      ? doc.createXULElement(tagName)
      : doc.createElement(tagName);
  },

  async onMenuCommand(win) {
    try {
      const pane = Zotero.getActiveZoteroPane();
      if (!pane) {
        this._alert(win, "Zotero pane not ready.");
        return;
      }

      const items = pane.getSelectedItems();
      if (!items || !items.length) {
        this._alert(win, "Please select a Zotero item.");
        return;
      }

      const item = items[0];
      const pdfPath = await this._getPDFPath(item);
      if (!pdfPath) {
        this._alert(win, "No PDF attachment found for this item.");
        return;
      }

      const meta = this._extractMeta(item, pdfPath);
      let paperInfo;
      try {
        paperInfo = await this._startReading(meta);
      } catch (error) {
        this._alert(
          win,
          "Cannot reach local AI service at http://127.0.0.1:8765\n\n" +
          "Please start it:\n  cd local-ai-service && python app.py\n\n" +
          `Error: ${error.message}`
        );
        return;
      }

      this._openReaderWindow(win, paperInfo, item.id);
    } catch (error) {
      Zotero?.debug?.(`[AI Bilingual Reader] ${error}`);
      this._alert(win, `Error: ${error.message}`);
    }
  },

  async _getPDFPath(item) {
    const attachmentIds = item.getAttachments();
    for (const attachmentId of attachmentIds) {
      const attachment = Zotero.Items.get(attachmentId);
      if (attachment && attachment.attachmentContentType === "application/pdf") {
        const filePath = attachment.getFilePath();
        if (filePath) {
          return filePath;
        }
      }
    }
    return null;
  },

  _extractMeta(item, pdfPath) {
    const creators = (item.getCreators() || []).map(creator => ({
      firstName: creator.firstName || "",
      lastName: creator.lastName || "",
    }));

    return {
      zotero_item_id: item.id,
      pdf_path: pdfPath,
      title: item.getField("title") || "",
      doi: item.getField("DOI") || "",
      year: item.getField("year") || "",
      authors: creators,
    };
  },

  async _startReading(meta) {
    const response = await fetch("http://127.0.0.1:8765/api/read/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status}`);
    }

    return response.json();
  },

  _openReaderWindow(parentWin, paperInfo, zoteroItemId) {
    if (this._readerWindows.has(zoteroItemId)) {
      const existing = this._readerWindows.get(zoteroItemId);
      try {
        existing.focus();
        return;
      } catch (_error) {
        this._readerWindows.delete(zoteroItemId);
      }
    }

    const params = new URLSearchParams({
      paper_id: paperInfo.paper_id,
      title: paperInfo.title || "",
      doi: paperInfo.doi || "",
      page_count: String(paperInfo.page_count || 1),
      zotero_item_id: String(zoteroItemId),
    });

    const readerURL = `chrome://${CONTENT_PACKAGE}/content/reader/index.html?${params.toString()}`;
    const readerWin = parentWin.open(
      readerURL,
      `ai-reader-${zoteroItemId}`,
      "chrome,dialog=no,resizable=yes,width=1400,height=900,scrollbars=yes"
    );

    if (!readerWin) {
      this._alert(parentWin, "Failed to open the AI Bilingual Reader window.");
      return;
    }

    this._readerWindows.set(zoteroItemId, readerWin);
    readerWin.addEventListener("unload", () => this._readerWindows.delete(zoteroItemId));
    readerWin._saveNoteToZotero = (itemId, noteType, markdown) =>
      this._saveNoteToZotero(itemId, noteType, markdown);
  },

  async _saveNoteToZotero(zoteroItemId, noteType, markdown) {
    const item = Zotero.Items.get(zoteroItemId);
    if (!item) {
      throw new Error(`Zotero item ${zoteroItemId} not found`);
    }

    const noteTitle = `[Writing] ${noteType.replace(/^Writing Note - /, "")}`;
    const html = `<h2>${noteTitle}</h2>\n${this._mdToHtml(markdown)}`;

    const childIds = item.getNotes();
    let existing = null;
    for (const noteId of childIds) {
      const note = Zotero.Items.get(noteId);
      if (note && note.isNote() && (note.getNote() || "").includes(noteTitle)) {
        existing = note;
        break;
      }
    }

    if (existing) {
      existing.setNote(html);
      await existing.saveTx();
      return;
    }

    const note = new Zotero.Item("note");
    note.setNote(html);
    note.parentID = item.id;
    await note.saveTx();
  },

  _mdToHtml(md) {
    return md
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n\n+/g, "</p><p>")
      .replace(/^(?!<)/gm, "<p>")
      .replace(/<p>$/gm, "");
  },

  _alert(win, msg) {
    try {
      Services.prompt.alert(win, "AI Bilingual Reader", msg);
    } catch (_error) {
      win?.alert(msg);
    }
  },
};

function startup({ rootURI }) {
  registerChrome(rootURI);
  AIBilingualReader.init({ rootURI });
}

function shutdown() {
  AIBilingualReader.shutdown();
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function install() {}
function uninstall() {}
