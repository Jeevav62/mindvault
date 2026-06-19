"""Neo4j AuraDB async driver singleton."""
from __future__ import annotations

import logging

from neo4j import AsyncDriver, AsyncGraphDatabase

from app.config import get_settings

logger = logging.getLogger(__name__)
_driver: AsyncDriver | None = None


def get_driver() -> AsyncDriver:
    global _driver
    if _driver is None:
        s = get_settings()
        _driver = AsyncGraphDatabase.driver(
            s.neo4j_uri,
            auth=(s.neo4j_username, s.neo4j_password),
        )
        logger.info("Neo4j driver created → %s", s.neo4j_uri)
    return _driver


async def aclose() -> None:
    global _driver
    if _driver is not None:
        await _driver.close()
        _driver = None
