// Converts Markdown to simple HTML for Zotero notes
function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/^(?!<[hbpul])/gm, "<p>")
    .replace(/<p>(<\/p>)?$/gm, "");
}

const NOTE_TITLE_PREFIX = "[Writing] ";

const NOTE_TYPES = [
  "Writing Note - Introduction",
  "Writing Note - Research Gap",
  "Writing Note - Methods",
  "Writing Note - Validation",
  "Writing Note - Results",
  "Writing Note - Discussion",
  "Writing Note - Limitations",
  "Writing Note - Useful Expressions",
];

function noteTypeToTitle(noteType: string): string {
  // "Writing Note - Research Gap" → "[Writing] Research Gap"
  const suffix = noteType.replace(/^Writing Note - /, "");
  return `${NOTE_TITLE_PREFIX}${suffix}`;
}

export async function saveNoteToZotero(
  zoteroItemId: number,
  noteType: string,
  markdown: string
): Promise<void> {
  const item = Zotero.Items.get(zoteroItemId);
  if (!item) throw new Error(`Zotero item ${zoteroItemId} not found`);

  const noteTitle = noteTypeToTitle(noteType);
  const htmlContent = `<h2>${noteTitle}</h2>\n${markdownToHtml(markdown)}`;

  // Search for an existing note with this title among children
  const childIds: number[] = item.getNotes();
  let existingNote: Zotero.Item | null = null;

  for (const noteId of childIds) {
    const note = Zotero.Items.get(noteId) as Zotero.Item;
    if (note && note.isNote()) {
      const content = note.getNote() || "";
      if (content.includes(noteTitle)) {
        existingNote = note;
        break;
      }
    }
  }

  if (existingNote) {
    existingNote.setNote(htmlContent);
    await existingNote.saveTx();
  } else {
    const newNote = new Zotero.Item("note");
    newNote.setNote(htmlContent);
    newNote.parentID = item.id;
    await newNote.saveTx();
  }
}

export { NOTE_TYPES, noteTypeToTitle };
