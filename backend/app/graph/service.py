"""Neo4j knowledge graph: store user entities and query context."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import get_settings

from .client import get_driver
from .extractor import Entities, extract
from .schema import ensure_schema

logger = logging.getLogger(__name__)
_schema_ready = False

# Whitelisted relationship types — prevents Cypher injection
_PLACE_REL: dict[str, str] = {
    "lives_in": "LIVES_IN", "live_in": "LIVES_IN", "home": "LIVES_IN",
    "from": "FROM", "originally_from": "FROM", "hometown": "FROM",
    "visited": "VISITED", "traveling_to": "VISITED", "been_to": "VISITED",
}
_ORG_REL: dict[str, str] = {
    "works_at": "WORKS_AT", "work_at": "WORKS_AT", "employed_at": "WORKS_AT",
    "worked_at": "WORKED_AT",
    "studied_at": "STUDIED_AT", "study_at": "STUDIED_AT", "attended": "STUDIED_AT",
    "founded": "FOUNDED", "co_founded": "FOUNDED",
}


async def warmup() -> None:
    global _schema_ready
    try:
        await ensure_schema()
        _schema_ready = True
    except Exception as exc:
        logger.warning("Graph warmup failed: %s", exc)


# ── Write ─────────────────────────────────────────────────────────────────────

async def _write_entities(tx, user_id: str, entities: Entities, now: str) -> None:
    await tx.run("MERGE (u:User {id: $uid})", uid=user_id)

    for p in entities.persons:
        name = str(p.get("name", "")).strip()
        if not name:
            continue
        await tx.run(
            "MATCH (u:User {id: $uid}) "
            "MERGE (p:Person {name: $name}) "
            "SET p.relation = $rel "
            "MERGE (u)-[:KNOWS]->(p)",
            uid=user_id, name=name, rel=str(p.get("relation", "")).strip(),
        )

    for pl in entities.places:
        name = str(pl.get("name", "")).strip()
        if not name:
            continue
        rel_type = _PLACE_REL.get(str(pl.get("rel", "")).lower().strip(), "VISITED")
        ptype = str(pl.get("type", "")).strip()
        await tx.run(
            f"MATCH (u:User {{id: $uid}}) "
            f"MERGE (pl:Place {{name: $name}}) "
            f"SET pl.type = $ptype "
            f"MERGE (u)-[:{rel_type}]->(pl)",
            uid=user_id, name=name, ptype=ptype,
        )

    for t in entities.topics:
        t = str(t).strip()
        if t:
            await tx.run(
                "MATCH (u:User {id: $uid}) "
                "MERGE (t:Topic {name: $name}) "
                "MERGE (u)-[:INTERESTED_IN]->(t)",
                uid=user_id, name=t,
            )

    for o in entities.organizations:
        name = str(o.get("name", "")).strip()
        if not name:
            continue
        rel_type = _ORG_REL.get(str(o.get("rel", "")).lower().strip(), "ASSOCIATED_WITH")
        await tx.run(
            f"MATCH (u:User {{id: $uid}}) "
            f"MERGE (o:Organization {{name: $name}}) "
            f"MERGE (u)-[:{rel_type}]->(o)",
            uid=user_id, name=name,
        )

    for fact in entities.facts:
        fact = str(fact).strip()
        if fact:
            await tx.run(
                "MATCH (u:User {id: $uid}) "
                "CREATE (f:Fact {text: $text, created_at: $ts}) "
                "CREATE (u)-[:HAS_FACT]->(f)",
                uid=user_id, text=fact, ts=now,
            )


async def add_turn(user_id: str, question: str, _answer: str = "") -> None:
    """Extract entities from user message and persist in knowledge graph."""
    entities = await extract(question)
    if entities.is_empty():
        return
    now = datetime.now(timezone.utc).isoformat()
    driver = get_driver()
    s = get_settings()
    try:
        async with driver.session(database=s.neo4j_database) as session:
            await session.execute_write(_write_entities, user_id, entities, now)
        logger.info("Graph: stored entities for user %.8s", user_id)
    except Exception as exc:
        logger.warning("Graph write failed: %s", exc)


# ── Read ──────────────────────────────────────────────────────────────────────

async def query_context(user_id: str, _query: str = "") -> str:
    """Return a formatted context string of known facts about this user."""
    try:
        driver = get_driver()
        s = get_settings()
        async with driver.session(database=s.neo4j_database) as session:
            result = await session.run(
                """
                MATCH (u:User {id: $uid})-[r]->(n)
                RETURN type(r) AS rel,
                       labels(n)[0] AS label,
                       CASE WHEN 'Fact' IN labels(n) THEN n.text ELSE n.name END AS value,
                       n.relation AS extra,
                       n.type AS ntype
                LIMIT 60
                """,
                uid=user_id,
            )
            records = await result.data()

        if not records:
            return ""

        lines: list[str] = []
        for r in records:
            label = r.get("label", "")
            rel = str(r.get("rel", "")).replace("_", " ").lower()
            value = str(r.get("value") or "")
            extra = str(r.get("extra") or "")
            ntype = str(r.get("ntype") or "")

            if not value:
                continue

            if label == "Person":
                lines.append(f"knows {extra} named {value}" if extra else f"knows {value}")
            elif label == "Place":
                lines.append(f"{rel}: {value}" + (f" ({ntype})" if ntype else ""))
            elif label == "Topic":
                lines.append(f"interested in: {value}")
            elif label == "Organization":
                lines.append(f"{rel}: {value}")
            elif label == "Fact":
                lines.append(value)

        if not lines:
            return ""
        return "Knowledge graph (user facts):\n" + "\n".join(f"- {l}" for l in lines)
    except Exception as exc:
        logger.warning("Graph query failed: %s", exc)
        return ""
