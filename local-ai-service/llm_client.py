"""OpenAI-compatible LLM client for translation and classification."""
from __future__ import annotations
import json
import os
import re
from typing import Tuple
from openai import OpenAI

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=os.environ.get("LLM_API_KEY", "sk-placeholder"),
            base_url=os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
        )
    return _client


def _model() -> str:
    return os.environ.get("LLM_MODEL", "gpt-4o-mini")


# ── Formula extraction ────────────────────────────────────────────────────────
# Order matters: longer/more-specific patterns first.
_FORMULA_PATTERNS = [
    # Display math: $$...$$
    r"\$\$[\s\S]+?\$\$",
    # Display math: \[...\]
    r"\\\[[\s\S]+?\\\]",
    # Display math: \begin{...}...\end{...}
    r"\\begin\{[^}]+\}[\s\S]+?\\end\{[^}]+\}",
    # Inline math: $...$  (non-greedy, no newline inside)
    r"\$[^$\n]+?\$",
    # Inline math: \(...\)
    r"\\\([\s\S]+?\\\)",
    # Standalone variable-like tokens: e.g. α, β, R², Δx, σ²
    r"(?<!\w)[A-Za-zα-ωΑ-Ω][₀-₉⁰-⁹_^{}\d]*(?:[_^][{]?[A-Za-z\d]+[}]?)+(?!\w)",
]
_FORMULA_RE = re.compile("|".join(_FORMULA_PATTERNS))
_PLACEHOLDER = "⟨EQ{i}⟩"


def _extract_formulas(text: str) -> Tuple[str, list]:
    """Replace all formulas with placeholders. Returns (masked_text, formulas)."""
    formulas: list = []

    def replacer(m: re.Match) -> str:
        idx = len(formulas)
        formulas.append(m.group(0))
        return _PLACEHOLDER.format(i=idx)

    masked = _FORMULA_RE.sub(replacer, text)
    return masked, formulas


def _restore_formulas(text: str, formulas: list) -> str:
    """Put the original formula strings back."""
    for i, f in enumerate(formulas):
        text = text.replace(_PLACEHOLDER.format(i=i), f)
    return text


def translate_to_zh(text: str) -> str:
    """Translate English academic text to concise Chinese, preserving all formulas."""
    masked, formulas = _extract_formulas(text)

    prompt = (
        "You are an academic paper reading assistant.\n\n"
        "Translate the following English academic text into concise Chinese for rapid reading.\n\n"
        "Requirements:\n"
        "1. Prioritize the main idea over polished wording.\n"
        "2. IMPORTANT: tokens in the form ⟨EQ0⟩, ⟨EQ1⟩, … are formula placeholders. "
        "Copy them verbatim into the translation at the same position. Do NOT translate, "
        "rephrase, or remove them.\n"
        "3. Preserve citations (e.g. [1], Smith et al.), figure/table numbers, and units.\n"
        "4. Do not add explanations.\n"
        "5. Do not omit key claims.\n"
        "6. Use concise academic Chinese.\n"
        "7. Return only the Chinese translation.\n\n"
        f"Text:\n{masked}"
    )
    resp = _get_client().chat.completions.create(
        model=_model(),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1000,
        temperature=0.2,
    )
    translated_masked = resp.choices[0].message.content.strip()
    return _restore_formulas(translated_masked, formulas)


def classify_mark(
    paper_title: str,
    doi: str,
    page_number: int,
    mark_type: str,
    selected_original: str,
    ai_translation: str,
    user_comment: str,
) -> dict:
    """Classify a mark into Writing Note categories. Returns dict."""
    prompt = (
        "You are an academic writing-note organizer.\n\n"
        f"The user selected a passage from the original English PDF and marked it as: {mark_type}.\n\n"
        "Classify this passage into a writing-oriented note system.\n\n"
        "Input:\n"
        f"- Paper title: {paper_title}\n"
        f"- DOI: {doi}\n"
        f"- Page: {page_number}\n"
        f"- Mark type: {mark_type}\n"
        f"- Selected original text: {selected_original}\n"
        f"- Chinese translation: {ai_translation}\n"
        f"- User comment: {user_comment}\n\n"
        "Available target notes:\n"
        "1. Writing Note - Introduction\n"
        "2. Writing Note - Research Gap\n"
        "3. Writing Note - Methods\n"
        "4. Writing Note - Validation\n"
        "5. Writing Note - Results\n"
        "6. Writing Note - Discussion\n"
        "7. Writing Note - Limitations\n"
        "8. Writing Note - Useful Expressions\n\n"
        "Choose one target note and one sub_category.\n\n"
        "Return JSON only:\n"
        '{\n'
        '  "target_note": "...",\n'
        '  "sub_category": "...",\n'
        '  "ai_summary": "...",\n'
        '  "possible_use_in_my_paper": "...",\n'
        '  "keywords": ["...", "..."],\n'
        '  "confidence": 0.0\n'
        '}'
    )
    resp = _get_client().chat.completions.create(
        model=_model(),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=600,
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Extract JSON from markdown code block if present
        m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
        if m:
            return json.loads(m.group(1))
        return {
            "target_note": f"Writing Note - {mark_type}",
            "sub_category": mark_type,
            "ai_summary": selected_original[:200],
            "possible_use_in_my_paper": "",
            "keywords": [],
            "confidence": 0.5,
        }


def generate_note_markdown(note_type: str, marks_json: str) -> str:
    """Generate structured Markdown note from marks."""
    prompt = (
        "You are an academic writing-note organizer.\n\n"
        "The user is building a writing-oriented research note from marked passages across multiple papers.\n\n"
        "Task:\n"
        "Organize the following marked passages into a structured Markdown note.\n\n"
        "Requirements:\n"
        "1. Group entries by sub_category.\n"
        "2. Keep the selected English original.\n"
        "3. Keep the Chinese understanding.\n"
        "4. Keep source information: paper title, DOI if available, page number.\n"
        "5. Add \"Possible use in my paper\" for each entry.\n"
        "6. Do not invent claims outside the marked passages.\n"
        "7. Do not remove source passages.\n"
        "8. Use concise academic Chinese.\n\n"
        f"Target note:\n{note_type}\n\n"
        f"Marked passages:\n{marks_json}\n\n"
        "Return only Markdown."
    )
    resp = _get_client().chat.completions.create(
        model=_model(),
        messages=[{"role": "user", "content": prompt}],
        max_tokens=3000,
        temperature=0.2,
    )
    return resp.choices[0].message.content.strip()
