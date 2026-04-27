export interface ZoteroPaperMeta {
  zoteroItemId: number;
  title: string;
  doi: string;
  year: string;
  authors: Array<{ firstName: string; lastName: string }>;
  pdfPath: string | null;
}

export async function getSelectedItemMeta(): Promise<ZoteroPaperMeta | null> {
  const pane = Zotero.getActiveZoteroPane();
  if (!pane) return null;
  const items = pane.getSelectedItems();
  if (!items || items.length === 0) return null;
  const item = items[0];
  return buildMeta(item);
}

export async function buildMeta(item: Zotero.Item): Promise<ZoteroPaperMeta> {
  const creators = (item.getCreators() || []).map(c => ({
    firstName: c.firstName || "",
    lastName: c.lastName || "",
  }));

  const pdfPath = await findPDFPath(item);

  return {
    zoteroItemId: item.id,
    title: item.getField("title") || "",
    doi: item.getField("DOI") || "",
    year: item.getField("year") || "",
    authors: creators,
    pdfPath,
  };
}

async function findPDFPath(item: Zotero.Item): Promise<string | null> {
  const attIds: number[] = item.getAttachments();
  for (const attId of attIds) {
    const att = Zotero.Items.get(attId) as Zotero.Item;
    if (att && att.attachmentContentType === "application/pdf") {
      const path = att.getFilePath();
      if (path) return path;
    }
  }
  return null;
}
