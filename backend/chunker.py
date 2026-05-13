from __future__ import annotations

import re
from typing import TYPE_CHECKING, Callable, Dict, List, Sequence

if TYPE_CHECKING:
    ChunkEmbedder = Callable[[Sequence[str]], Sequence[Sequence[float]]]
else:
    ChunkEmbedder = Callable

DEFAULT_CHUNK_METHOD = "fixed"
CHUNK_METHODS: List[Dict[str, str]] = [
    {
        "id": "fixed",
        "label": "Fixed Window",
        "description": "Character-based chunks with overlap. Best for predictable chunk sizing.",
    },
    {
        "id": "sentence",
        "label": "Sentence",
        "description": "Groups complete sentences into chunks for cleaner boundaries.",
    },
    {
        "id": "paragraph",
        "label": "Paragraph",
        "description": "Keeps paragraphs together when possible and falls back for oversized blocks.",
    },
    {
        "id": "semantic",
        "label": "Semantic",
        "description": "Uses topic-shift scoring between neighboring sentences for more natural boundaries.",
    },
    {
        "id": "markdown",
        "label": "Heading-aware",
        "description": "Splits around headings first, then chunks each section for cleaner document structure.",
    },
    {
        "id": "adaptive",
        "label": "Adaptive",
        "description": "Auto-selects sentence, paragraph, or semantic chunking based on document shape.",
    },
]

_CHUNK_METHOD_IDS = {item["id"] for item in CHUNK_METHODS}


def list_chunk_methods() -> List[Dict[str, str]]:
    return [dict(item) for item in CHUNK_METHODS]


def _validate_inputs(chunk_size: int, overlap: int, method: str) -> None:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if overlap < 0:
        raise ValueError("overlap must be >= 0")
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")
    if method not in _CHUNK_METHOD_IDS:
        raise ValueError(f"Unknown chunk method: {method}")


def _split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n{2,}", text)
    return [part.strip() for part in parts if part and part.strip()]


def _split_paragraphs(text: str) -> List[str]:
    parts = re.split(r"\n\s*\n+", text)
    return [part.strip() for part in parts if part and part.strip()]


def _looks_like_heading(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False

    if re.match(r"^#{1,6}\s+", stripped):
        return True
    if re.match(r"^(chapter|section|part)\b", stripped, flags=re.IGNORECASE):
        return True

    alpha_count = sum(ch.isalpha() for ch in stripped)
    if alpha_count == 0 or len(stripped) > 90:
        return False

    upper_ratio = sum(ch.isupper() for ch in stripped if ch.isalpha()) / alpha_count
    return upper_ratio >= 0.8 and len(stripped.split()) <= 12


def _split_heading_sections(text: str) -> List[str]:
    lines = text.splitlines()
    if not lines:
        return []

    sections: List[str] = []
    current: List[str] = []
    has_heading = False

    for line in lines:
        if _looks_like_heading(line):
            has_heading = True
            if current:
                section = "\n".join(current).strip()
                if section:
                    sections.append(section)
            current = [line.strip()]
            continue
        current.append(line)

    if current:
        section = "\n".join(current).strip()
        if section:
            sections.append(section)

    return sections if has_heading else []


def _joined_length(units: Sequence[str], separator: str) -> int:
    if not units:
        return 0
    return sum(len(unit) for unit in units) + len(separator) * (len(units) - 1)


def _tail_units(units: Sequence[str], separator: str, overlap: int) -> List[str]:
    if overlap <= 0 or not units:
        return []

    selected: List[str] = []
    total = 0
    for unit in reversed(units):
        if selected:
            total += len(separator)
        selected.insert(0, unit)
        total += len(unit)
        if total >= overlap:
            break
    return selected


def _fixed_window_chunks(text: str, chunk_size: int, overlap: int) -> List[str]:
    chunks: List[str] = []
    cursor = 0
    step = chunk_size - overlap

    while cursor < len(text):
        next_cursor = min(cursor + chunk_size, len(text))
        chunk = text[cursor:next_cursor].strip()
        if chunk:
            chunks.append(chunk)
        cursor += step

    return chunks


def _group_units(units: Sequence[str], separator: str, chunk_size: int, overlap: int) -> List[str]:
    chunks: List[str] = []
    current: List[str] = []

    def flush() -> None:
        if not current:
            return
        combined = separator.join(current).strip()
        if combined:
            chunks.append(combined)

    for unit in units:
        if not unit:
            continue

        if len(unit) > chunk_size:
            flush()
            current = []
            chunks.extend(_fixed_window_chunks(unit, chunk_size, overlap))
            continue

        candidate = [*current, unit]
        if not current or _joined_length(candidate, separator) <= chunk_size:
            current = candidate
            continue

        flush()
        current = _tail_units(current, separator, overlap)
        while current and _joined_length([*current, unit], separator) > chunk_size:
            current.pop(0)
        current.append(unit)

    flush()
    return chunks


def _percentile(values: Sequence[float], quantile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]

    position = max(0.0, min(1.0, quantile)) * (len(ordered) - 1)
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    if lower_index == upper_index:
        return ordered[lower_index]

    weight = position - lower_index
    return ordered[lower_index] + (ordered[upper_index] - ordered[lower_index]) * weight


def _tokenize(text: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 2}


def _topic_shift_score(left: str, right: str) -> float:
    left_tokens = _tokenize(left)
    right_tokens = _tokenize(right)
    if not left_tokens or not right_tokens:
        return 0.5

    overlap = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    similarity = overlap / union if union else 0.0
    return 1.0 - similarity


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _semantic_segments(sentences: Sequence[str], chunk_size: int, _embed_texts: ChunkEmbedder | None) -> List[str]:
    if len(sentences) <= 1:
        return list(sentences)

    if _embed_texts is not None:
        embeddings = _embed_texts(list(sentences))
        distances = [
            1.0 - _cosine_similarity(embeddings[i], embeddings[i + 1])
            for i in range(len(embeddings) - 1)
        ]
    else:
        distances = [
            _topic_shift_score(sentences[index], sentences[index + 1])
            for index in range(len(sentences) - 1)
        ]

    threshold = max(0.45, _percentile(distances, 0.75))
    minimum_segment_size = max(180, chunk_size // 3)

    segments: List[str] = []
    current = [sentences[0]]

    for index, sentence in enumerate(sentences[1:], start=1):
        current_text = " ".join(current).strip()
        should_break = distances[index - 1] >= threshold and len(current_text) >= minimum_segment_size
        if should_break:
            segments.append(current_text)
            current = [sentence]
        else:
            current.append(sentence)

    final_segment = " ".join(current).strip()
    if final_segment:
        segments.append(final_segment)
    return segments


def _markdown_chunks(text: str, chunk_size: int, overlap: int, embed_texts: ChunkEmbedder | None) -> List[str]:
    sections = _split_heading_sections(text)
    if not sections:
        sections = _split_paragraphs(text) or [text]

    normalized_sections: List[str] = []
    for section in sections:
        if len(section) <= chunk_size:
            normalized_sections.append(section)
            continue

        sentences = _split_sentences(section)
        semantic_units = _semantic_segments(sentences, chunk_size=chunk_size, _embed_texts=embed_texts)
        normalized_sections.extend(_group_units(semantic_units, "\n\n", chunk_size=chunk_size, overlap=overlap))

    return _group_units(normalized_sections, "\n\n", chunk_size=chunk_size, overlap=overlap)


def _adaptive_method(text: str, chunk_size: int) -> str:
    heading_sections = _split_heading_sections(text)
    paragraph_count = len(_split_paragraphs(text))
    sentence_count = len(_split_sentences(text))

    if heading_sections and len(heading_sections) >= 3:
        return "markdown"
    if paragraph_count >= 6 and sentence_count < 40:
        return "paragraph"
    if sentence_count >= max(18, chunk_size // 70):
        return "semantic"
    return "sentence"


def summarize_chunks(chunks: Sequence[str]) -> Dict[str, float | int]:
    lengths = [len(chunk) for chunk in chunks if chunk]
    if not lengths:
        return {
            "count": 0,
            "avg_length": 0,
            "median_length": 0,
            "min_length": 0,
            "max_length": 0,
        }

    ordered = sorted(lengths)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        median = int((ordered[mid - 1] + ordered[mid]) / 2)
    else:
        median = ordered[mid]

    return {
        "count": len(lengths),
        "avg_length": int(sum(lengths) / len(lengths)),
        "median_length": median,
        "min_length": ordered[0],
        "max_length": ordered[-1],
    }


def chunk_text(
    text: str,
    chunk_size: int = 800,
    overlap: int = 120,
    method: str = DEFAULT_CHUNK_METHOD,
    embed_texts: ChunkEmbedder | None = None,
) -> List[str]:
    """Chunk text using a named strategy."""
    cleaned = (text or "").strip()
    if not cleaned:
        return []

    selected_method = (method or DEFAULT_CHUNK_METHOD).strip().lower()
    _validate_inputs(chunk_size, overlap, selected_method)

    if selected_method == "fixed":
        return _fixed_window_chunks(cleaned, chunk_size=chunk_size, overlap=overlap)

    if selected_method == "sentence":
        sentences = _split_sentences(cleaned) or [cleaned]
        return _group_units(sentences, " ", chunk_size=chunk_size, overlap=overlap)

    if selected_method == "paragraph":
        paragraphs = _split_paragraphs(cleaned) or [cleaned]
        return _group_units(paragraphs, "\n\n", chunk_size=chunk_size, overlap=overlap)

    if selected_method == "markdown":
        return _markdown_chunks(cleaned, chunk_size=chunk_size, overlap=overlap, embed_texts=embed_texts)

    if selected_method == "adaptive":
        method = _adaptive_method(cleaned, chunk_size=chunk_size)
        return chunk_text(
            cleaned,
            chunk_size=chunk_size,
            overlap=overlap,
            method=method,
            embed_texts=embed_texts,
        )

    sentences = _split_sentences(cleaned) or [cleaned]
    semantic_units = _semantic_segments(sentences, chunk_size=chunk_size, _embed_texts=embed_texts)
    return _group_units(semantic_units, "\n\n", chunk_size=chunk_size, overlap=overlap)
