"""
Fault knowledge graph: Component -> Symptom -> Root Cause -> Fix -> Ticket.

In-process networkx graph built from the knowledge-base documents (swap for
Neo4j for multi-user querying at scale -- see docs/TECHNICAL_DOCUMENTATION.md).
Used to surface fixes that share a symptom / root cause with the current
alert even when their wording doesn't score highly in text retrieval.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import networkx as nx

REPO_ROOT = Path(__file__).resolve().parents[3]
KB_PATH = REPO_ROOT / "data" / "kb" / "documents.jsonl"


def _nid(kind: str, value: str) -> str:
    return f"{kind}:{hashlib.sha1(value.encode()).hexdigest()[:10]}"


class FaultKnowledgeGraph:
    def __init__(self, documents: list[dict]):
        self.graph = nx.DiGraph()
        g = self.graph
        for d in documents:
            comp, root = _nid("component", d["component"]), _nid("root_cause", d["root_cause"])
            fix, ticket = _nid("fix", d["template_id"]), _nid("ticket", d["doc_id"])
            g.add_node(comp, kind="component", label=d["component"])
            g.add_node(root, kind="root_cause", label=d["root_cause"])
            g.add_node(fix, kind="fix", label=d["fix_action"], template_id=d["template_id"])
            g.add_node(ticket, kind="ticket", label=d["source_ref"], doc_id=d["doc_id"], success=d["success"])
            g.add_edge(comp, root, relation="has_root_cause")
            g.add_edge(root, fix, relation="resolved_by")
            g.add_edge(fix, ticket, relation="documented_in")
            for tag in d["symptom_tags"]:
                sym = _nid("symptom", tag)
                g.add_node(sym, kind="symptom", label=tag)
                g.add_edge(comp, sym, relation="exhibits")
                g.add_edge(sym, root, relation="indicates")

    @classmethod
    def from_jsonl(cls, path: Path = KB_PATH) -> "FaultKnowledgeGraph":
        with open(path) as f:
            return cls([json.loads(line) for line in f])

    def related_fixes(self, component: str, symptom_tags: list[str]) -> list[dict]:
        """Traverse component -> symptom -> root cause -> fix for the given symptoms."""
        comp = _nid("component", component)
        if comp not in self.graph:
            return []
        wanted = {_nid("symptom", t) for t in symptom_tags}
        out, seen = [], set()
        for _, sym in self.graph.out_edges(comp):
            if self.graph.nodes[sym]["kind"] != "symptom" or (wanted and sym not in wanted):
                continue
            for _, root in self.graph.out_edges(sym):
                for _, fix in self.graph.out_edges(root):
                    node = self.graph.nodes[fix]
                    if node.get("kind") != "fix" or fix in seen:
                        continue
                    seen.add(fix)
                    tickets = [self.graph.nodes[t] for _, t in self.graph.out_edges(fix)]
                    out.append(dict(template_id=node["template_id"], fix_action=node["label"],
                                    root_cause=self.graph.nodes[root]["label"], via_symptom=self.graph.nodes[sym]["label"],
                                    supporting_doc_ids=[t["doc_id"] for t in tickets if t.get("success")][:3],
                                    n_docs=len(tickets)))
        return out

    def stats(self) -> dict:
        kinds: dict[str, int] = {}
        for _, data in self.graph.nodes(data=True):
            kinds[data["kind"]] = kinds.get(data["kind"], 0) + 1
        return {"nodes": self.graph.number_of_nodes(), "edges": self.graph.number_of_edges(), "by_kind": kinds}
