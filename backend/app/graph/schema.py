"""Create Neo4j constraints and indexes on first startup."""
from __future__ import annotations

import logging

from app.config import get_settings

from .client import get_driver

logger = logging.getLogger(__name__)

_CONSTRAINTS = [
    "CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
    "CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)",
    "CREATE INDEX place_name IF NOT EXISTS FOR (p:Place) ON (p.name)",
    "CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name)",
    "CREATE INDEX org_name IF NOT EXISTS FOR (o:Organization) ON (o.name)",
]


async def ensure_schema() -> None:
    driver = get_driver()
    s = get_settings()
    async with driver.session(database=s.neo4j_database) as session:
        for stmt in _CONSTRAINTS:
            try:
                await session.run(stmt)
            except Exception as exc:
                logger.debug("schema stmt skipped (likely exists): %s", exc)
    logger.info("Graph: schema ready")
