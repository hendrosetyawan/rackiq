"""
Fault knowledge graph: Component -> Symptom -> Root Cause -> Fix Action -> Source Ticket.

Built from the same synthetic KB documents used by the hybrid retriever, using
networkx as a lightweight in-process graph store for the prototype (swap for
a Neo4j deployment for production multi-user querying -- see
docs/TECHNICAL_DOCUMENTATION.md "Upgrade path"). Used to surface fixes that
share a root cause or symptom with the current alert even when their exact
wording doesn't score highly in text retrieval ("graph traversal" expansion
in the submitted architecture).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import networkx as nx

REPO_ROOT = Path(__file__).resolve().parents[3]
KB_PATH = REPO_ROOT / "data" / "kb" / "documents.jsonl"


def _node_id(kind: str, value: str) -> str:
    h = hashlib.sha1(value.encode()).hexdigest()[:10]
    return f"{kind}:{h}"


class FaultKnowledgeGraph:
    def __init__(self, documents: list[dict]):
        self.graph = nx.DiGraph()
        self.documents = documents
        self._build(documents)

    @classmethod
    def from_jsonl(cls, path: Path = KB_PATH) -> "FaultKnowledgeGraph":
        docs = []
        with open(path) as f:
            for line in f:
                docs.append(json.loads(line))
        return cls(docs)

    def _build(self, documents: list[dict]):
        g = self.graph
        for doc in documents:
            comp_node = _node_id("component", doc["component"])
            g.add_node(comp_node, kind="component", label=doc["component"])

            root_node = _node_id("root_cause", doc["root_cause"])
            g.add_node(root_node, kind="root_cause", label=doc["root_cause"])

            fix_node = _node_id("fix", doc["fix_action"])
            g.add_node(fix_node, kind="fix", label=doc["fix_action"], success=doc["success"])

            ticket_node = _node_id("ticket", doc["doc_id"])
            g.add_node(ticket_node, kind="ticket", label=doc["source_ref"], doc_id=doc["doc_id"])

            g.add_edge(comp_node, root_node, relation="has_root_cause")
            g.add_edge(root_node, fix_node, relation="resolved_by")
            g.add_edge(fix_node, ticket_node, relation="documented_in")

            for tag in doc["symptom_tags"]:
                symptom_node = _node_id("symptom", tag)
                g.add_node(symptom_node, kind="symptom", label=tag)
                g.add_edge(comp_node, symptom_node, relation="exhibits")
                g.add_edge(symptom_node, root_node, relation="indicates")

    def related_fixes(self, component: str, symptom_tags: list[str], max_hops: int = 3) -> list[dict]:
        """
        Traverse component -> symptom -> root_cause -> fix -> ticket paths to
        surface fixes connected to this component/symptom set, even ones that
        don't share exact wording with a text query.
        """
        comp_node = _node_id("component", component)
        if comp_node not in self.graph:
            return []

        symptom_nodes = {_node_id("symptom", tag) for tag in symptom_tags}
        results = []
        seen_fix_nodes = set()

        for _, target, data in self.graph.out_edges(comp_node, data=True):
            node_data = self.graph.nodes[target]
            if node_data["kind"] != "symptom":
                continue
            if symptom_tags and target not in symptom_nodes:
                continue
            for _, root_node, _ in self.graph.out_edges(target, data=True):
                for _, fix_node, _ in self.graph.out_edges(root_node, data=True):
                    if fix_node in seen_fix_nodes:
                        continue
                    seen_fix_nodes.add(fix_node)
                    fix_data = self.graph.nodes[fix_node]
                    tickets = [
                        self.graph.nodes[t]["doc_id"]
                        for _, t in self.graph.out_edges(fix_node)
                    ]
                    results.append(
                        {
                            "root_cause": self.graph.nodes[root_node]["label"],
                            "fix_action": fix_data["label"],
                            "success": fix_data.get("success"),
                            "supporting_doc_ids": tickets,
                            "via_symptom": node_data["label"],
                        }
                    )
        return results

    def stats(self) -> dict:
        kinds = {}
        for _, data in self.graph.nodes(data=True):
            kinds[data["kind"]] = kinds.get(data["kind"], 0) + 1
        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            "by_kind": kinds,
        }
