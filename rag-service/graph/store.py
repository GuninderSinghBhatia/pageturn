"""Neo4j side of the graph: write the merged graph, and ask simple questions about it.

Our nodes carry the label `Term`, so they never touch other data in the database
(for example the test nodes from playground.py).
"""

import os

from dotenv import load_dotenv
from langchain_neo4j import Neo4jGraph

load_dotenv()


def connect() -> Neo4jGraph:
    # refresh_schema=False: reading the schema needs the APOC plugin, which we do not use.
    return Neo4jGraph(
        url=os.getenv("NEO4J_URI"),
        username=os.getenv("NEO4J_USERNAME"),
        password=os.getenv("NEO4J_PASSWORD"),
        refresh_schema=False,
    )


def clear_terms(db: Neo4jGraph) -> None:
    """Delete only the graph built by this package (label Term). Other nodes stay."""
    db.query("MATCH (t:Term) DETACH DELETE t")


def write_graph(db: Neo4jGraph, nodes: list[dict], edges: list[dict]) -> None:
    """Write merged nodes and edges. Every node and edge keeps its pages + chunk ids.

    node: {key, name, aliases, pages, chunk_ids}
    edge: {source, target, relation, pages, chunk_ids}   (source/target are node keys)
    """
    db.query("CREATE CONSTRAINT term_key IF NOT EXISTS FOR (t:Term) REQUIRE t.key IS UNIQUE")
    db.query(
        """
        UNWIND $nodes AS n
        MERGE (t:Term {key: n.key})
        SET t.name = n.name, t.aliases = n.aliases, t.pages = n.pages, t.chunk_ids = n.chunk_ids
        """,
        params={"nodes": nodes},
    )
    # A relationship type cannot be a query parameter, so every edge is RELATES and the
    # relation text is a property.
    db.query(
        """
        UNWIND $edges AS e
        MATCH (a:Term {key: e.source}), (b:Term {key: e.target})
        MERGE (a)-[r:RELATES {relation: e.relation}]->(b)
        SET r.pages = e.pages, r.chunk_ids = e.chunk_ids
        """,
        params={"edges": edges},
    )


def stats(db: Neo4jGraph) -> dict:
    """The G2 'done when' check: node count, edge count, 10 nodes with the most links."""
    node_count = db.query("MATCH (t:Term) RETURN count(t) AS c")[0]["c"]
    edge_count = db.query("MATCH (:Term)-[r:RELATES]->(:Term) RETURN count(r) AS c")[0]["c"]
    top = db.query(
        """
        MATCH (t:Term)
        RETURN t.name AS name, COUNT { (t)--() } AS links, size(t.pages) AS pages
        ORDER BY links DESC LIMIT 10
        """
    )
    return {"nodes": node_count, "edges": edge_count, "top": top}
