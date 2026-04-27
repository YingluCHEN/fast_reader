# Zotero AI Bilingual Reading Assistant

Zotero 7+ 插件，支持 AI 双语阅读、划词 mark、Writing Note 生成。
帮助研究者在 Zotero 中完成英文论文的双语阅读与结构化笔记沉淀。它不是简单的“全文翻译插件”，而是围绕 **Read → Translate → Mark → Understand → Save to Note → Reuse in Writing** 的研究阅读流程设计。
主要是我也没招了，论文真的要写不完了TT

## Quick Start

```bash
# 1. 启动本地 AI 服务
cd local-ai-service
python -m venv .venv && .venv/Scripts/activate   # Windows
pip install -r requirements.txt
cp .env.example .env   # 填入 LLM_API_KEY
python app.py          # → http://127.0.0.1:8765

# 2. 打包并安装插件
cd ../zotero-plugin
npm install && node scripts/pack.js
# Zotero → Tools → Add-ons → Install Add-on From File → ai-bilingual-reader.xpi
```

详情见 `zotero-plugin/README.md` 和 `local-ai-service/README.md`。

##
