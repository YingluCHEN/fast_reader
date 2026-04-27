# Zotero AI Bilingual Reading Assistant

Zotero 7+ 插件，支持 AI 双语阅读、划词 mark、Writing Note 生成。

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
