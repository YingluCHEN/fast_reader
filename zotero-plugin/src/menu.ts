/**
 * menu.ts — Context menu injection helpers (TypeScript reference).
 * In practice, menu injection is done directly in bootstrap.js
 * to avoid needing a compiled JS step for the plugin lifecycle code.
 */
export const MENU_ITEM_ID = "ai-bilingual-read-menuitem";
export const MENU_SEP_ID  = "ai-bilingual-read-sep";
export const MENU_LABEL   = "AI Bilingual Read";

export function injectMenu(doc: Document, onCommand: () => void): void {
  const popup = doc.getElementById("zotero-itemmenu");
  if (!popup || doc.getElementById(MENU_ITEM_ID)) return;

  const sep = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuseparator"
  );
  sep.id = MENU_SEP_ID;

  const item = doc.createElementNS(
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
    "menuitem"
  );
  item.id = MENU_ITEM_ID;
  item.setAttribute("label", MENU_LABEL);
  item.addEventListener("command", onCommand);

  popup.appendChild(sep);
  popup.appendChild(item);
}

export function removeMenu(doc: Document): void {
  [MENU_SEP_ID, MENU_ITEM_ID].forEach(id => {
    doc.getElementById(id)?.remove();
  });
}
