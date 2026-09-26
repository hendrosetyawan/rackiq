"""
Hybrid retrieval over the 12-month RCA / ticket / manual / email knowledge base.

Blends three signals into one re-ranked score:
  - BM25 keyword relevance (rank_bm25) over document text + symptom tags
  - TF-IDF cosine similarity, a lightweight local stand-in for a dense
    sentence-embedding retriever (see docs/TECHNICAL_DOCUMENTATION.md
    "Upgrade path" for sentence-transformers + FAISS/Qdrant)
  - the fix's empirical durable-fix rate across the incident log (how often
    that fix actually held), so proven fixes outrank ones that recurred
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

REPO_ROOT = Path(__file__).resolve().parents[3]
KB_PATH = REPO_ROOT / "data" / "kb" / "documents.jsonl"
_TOKEN_RE = re.compile(r"[a-z0-9_]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


@dataclass
class RetrievalResult:
    doc_id: str
    score: float
    bm25_score: float
    vector_score: float
    success_boost: float
    doc: dict = field(default_factory=dict)


class HybridRetriever:
    def __init__(self, documents: list[dict], durable_rate: dict[str, float] | None = None):
        self.documents = documents
        self.doc_by_id = {d["doc_id"]: d for d in documents}
        self.components = np.array([d["component"] for d in documents])
        index_text = [d["text"] + " " + " ".join(d["symptom_tags"]) for d in documents]
        self.bm25 = BM25Okapi([_tokenize(t) for t in index_text])
        self.vectorizer = TfidfVectorizer(stop_words="english", max_features=8000, ngram_range=(1, 2), sublinear_tf=True)
        self.tfidf = self.vectorizer.fit_transform(index_text)
        rates = durable_rate or {}
        self.success = np.array([rates.get(d.get("template_id"), 0.85 if d.get("success") else 0.3) for d in documents])

    @classmethod
    def from_jsonl(cls, path: Path = KB_PATH, durable_rate: dict[str, float] | None = None) -> "HybridRetriever":
        with open(path) as f:
            return cls([json.loads(line) for line in f], durable_rate)

    @staticmethod
    def _norm(x: np.ndarray) -> np.ndarray:
        span = x.max() - x.min()
        return np.zeros_like(x) if span < 1e-9 else (x - x.min()) / span

    def search(self, query: str, component: str | None = None, symptom_tags: list[str] | None = None, top_k: int = 5,
               bm25_weight: float = 0.4, vector_weight: float = 0.4, success_weight: float = 0.2) -> list[RetrievalResult]:
        tags = symptom_tags or []
        terms = _tokenize(query) + [t for tag in tags for t in _tokenize(tag)] + tags
        bm = self._norm(np.array(self.bm25.get_scores(terms)))
        vec = self._norm(cosine_similarity(self.vectorizer.transform([query + " " + " ".join(tags)]), self.tfidf)[0])
        boost = self.success - 0.5
        blended = bm25_weight * bm + vector_weight * vec + success_weight * boost

        idx = np.arange(len(self.documents))
        if component:
            sel = idx[self.components == component]
            idx = sel if len(sel) else idx
        ranked = idx[np.argsort(-blended[idx])][:top_k]
        return [RetrievalResult(doc_id=self.documents[i]["doc_id"], score=round(float(blended[i]), 4),
                                bm25_score=round(float(bm[i]), 4), vector_score=round(float(vec[i]), 4),
                                success_boost=round(float(boost[i]), 3), doc=self.documents[i]) for i in ranked]

    def get_document(self, doc_id: str) -> dict | None:
        return self.doc_by_id.get(doc_id)
