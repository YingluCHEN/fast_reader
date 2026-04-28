export const Settings = {
  API_BASE: "http://127.0.0.1:8765",
  PLUGIN_ID: "ai-bilingual-reader@fast-reader.example",

  get(key: string, defaultValue: string = ""): string {
    try {
      return (Zotero.Prefs.get(`extensions.ai-bilingual-reader.${key}`, true) as string) || defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key: string, value: string): void {
    try {
      Zotero.Prefs.set(`extensions.ai-bilingual-reader.${key}`, value, true);
    } catch (e) {
      Zotero.log(`[AI Bilingual Reader] Failed to set pref ${key}: ${e}`);
    }
  },

  apiBase(): string {
    return this.get("apiBase", this.API_BASE);
  },
};
