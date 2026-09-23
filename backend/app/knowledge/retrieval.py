"""
Hybrid retrieval over the RCA/ticket/manual/email knowledge base.

Combines:
  - BM25 keyword search (rank_bm25) over document text
  - TF-IDF cosine similarity as a lightweight local stand-in for a dense
    sentence-embedding retriever (no external embedding API/model is used in
    this prototype -- see docs/TECHNICAL_DOCUMENTATION.md "Upgrade path" for
    swapping in sentence-transformers + FAISS/Qdrant)
  - A historical success-rate boost (documents whose fix_action is recorded
    as having actually resolved the issue rank above ones that didn't)

Results are blended into a single re-ranked score, approximating the
"hybrid vector + BM25 + cross-encoder re-rank" pipeline described in the
submitted architecture at a scale and dependency footprint appropriate for
a hackathon prototype.
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
    def __init__(self, documents: list[dict]):
        self.documents = documents
        self.texts = [d["text"] for d in documents]
        self.doc_by_id = {d["doc_id"]: d for d in documents}

        tokenized = [_tokenize(t) for t in self.texts]
        self.bm25 = BM25Okapi(tokenized)

        self.vectorizer = TfidfVectorizer(stop_words="english", max_features=4000)
        self.tfidf_matrix = self.vectorizer.fit_transform(self.texts)

    @classmethod
    def from_jsonl(cls, path: Path = KB_PATH) -> "HybridRetriever":
        docs = []
        with open(path) as f:
            for line in f:
                docs.append(json.loads(line))
        return cls(docs)

    def _normalize(self, scores: np.ndarray) -> np.ndarray:
        if scores.max() - scores.min() < 1e-9:
            return np.zeros_like(scores)
        return (scores - scores.min()) / (scores.max() - scores.min())

    def search(
        self,
        query: str,
        component: str | None = None,
        symptom_tags: list[str] | None = None,
        top_k: int = 5,
        bm25_weight: float = 0.4,
        vector_weight: float = 0.4,
        success_weight: float = 0.2,
    ) -> list[RetrievalResult]:
        query_terms = _tokenize(query)
        if symptom_tags:
            query_terms += [t for tag in symptom_tags for t in _tokenize(tag)]

        bm25_scores = np.array(self.bm25.get_scores(query_terms))

        query_text = query + " " + " ".join(symptom_tags or [])
        q_vec = self.vectorizer.transform([query_text])
        vector_scores = cosine_similarity(q_vec, self.tfidf_matrix)[0]

        bm25_norm = self._normalize(bm25_scores)
        vector_norm = self._normalize(vector_scores)
        success_boost = np.array(
            [0.15 if d.get("success") else -0.05 for d in self.documents]
        )

        blended = (
            bm25_weight * bm25_norm + vector_weight * vector_norm + success_weight * success_boost
        )

        candidate_idx = list(range(len(self.documents)))
        if component:
            candidate_idx = [i for i in candidate_idx if self.documents[i]["component"] == component]
        if not candidate_idx:
            candidate_idx = list(range(len(self.documents)))

        ranked = sorted(candidate_idx, key=lambda i: blended[i], reverse=True)[:top_k]

        return [
            RetrievalResult(
                doc_id=self.documents[i]["doc_id"],
                score=round(float(blended[i]), 4),
                bm25_score=round(float(bm25_norm[i]), 4),
                vector_score=round(float(vector_norm[i]), 4),
                success_boost=float(success_boost[i]),
                doc=self.documents[i],
            )
            for i in ranked
        ]

    def get_document(self, doc_id: str) -> dict | None:
        return self.doc_by_id.get(doc_id)
