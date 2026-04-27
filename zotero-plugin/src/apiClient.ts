import { Settings } from "./settings";

export interface PaperMeta {
  zotero_item_id: number;
  pdf_path: string;
  title: string;
  doi: string;
  authors: Array<{ firstName: string; lastName: string }>;
  year: string;
}

export interface StartReadingResponse {
  paper_id: string;
  title: string;
  doi: string;
  page_count: number;
  status: string;
}

export interface Block {
  block_id: string;
  type: string;
  reading_order: number;
  en: string;
  zh: string;
}

export interface Mark {
  mark_id: string;
  zotero_item_id: number;
  paper_id: string;
  paper_title: string;
  doi: string;
  authors: Array<{ firstName: string; lastName: string }>;
  year: string;
  source_side: "left_pdf";
  selected_language: "en";
  selected_original: string;
  ai_translation: string;
  page_number: number;
  pdf_rects: Array<{ x: number; y: number; width: number; height: number }>;
  mark_type: string;
  target_note: string;
  sub_category: string;
  ai_summary: string;
  possible_use_in_my_paper: string;
  keywords: string[];
  confidence: number;
  user_comment: string;
  created_at: string;
}

export interface PageResponse {
  paper_id: string;
  page_number: number;
  page_count: number;
  blocks: Block[];
  marks: Mark[];
}

export interface SaveMarkRequest {
  paper_id: string;
  zotero_item_id: number;
  page_number: number;
  selected_original: string;
  pdf_rects: Array<{ x: number; y: number; width: number; height: number }>;
  mark_type: string;
  user_comment: string;
}

export interface GenerateNoteResponse {
  note_type: string;
  note_markdown: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${Settings.apiBase()}${path}`;
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API ${path} → ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export const ApiClient = {
  startReading(meta: PaperMeta): Promise<StartReadingResponse> {
    return request("/api/read/start", {
      method: "POST",
      body: JSON.stringify(meta),
    });
  },

  getPage(paperId: string, page: number, translate = true): Promise<PageResponse> {
    const q = new URLSearchParams({
      paper_id: paperId,
      page: String(page),
      translate: String(translate),
    });
    return request(`/api/read/page?${q}`);
  },

  saveMark(data: SaveMarkRequest): Promise<Mark> {
    return request("/api/marks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  getMarks(paperId: string, page?: number): Promise<Mark[]> {
    const q = new URLSearchParams({ paper_id: paperId });
    if (page !== undefined) q.set("page", String(page));
    return request(`/api/marks?${q}`);
  },

  generateNote(noteType: string): Promise<GenerateNoteResponse> {
    return request("/api/notes/generate", {
      method: "POST",
      body: JSON.stringify({ note_type: noteType }),
    });
  },
};
