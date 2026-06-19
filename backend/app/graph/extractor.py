"""Extract structured entities from conversation turns using LLM."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from app.providers import get_llm_router
from app.providers.base import ChatMessage

logger = logging.getLogger(__name__)

_SYSTEM = (
    "Extract ONLY explicitly stated entities from the user's message about THEMSELVES.\n"
    "Return ONLY valid JSON with these keys (empty list = nothing found):\n"
    '{"persons":[{"name":"string","relation":"father|mother|sister|brother|friend|partner|colleague|..."}],'
    '"places":[{"name":"string","rel":"lives_in|from|visited","type":"city|country|state|venue|..."}],'
    '"topics":["string"],'
    '"organizations":[{"name":"string","rel":"works_at|worked_at|studied_at|founded"}],'
    '"facts":["short fact max 15 words"]}\n'
    "INCLUDE: names, relationships, locations, jobs, hobbies, skills, goals.\n"
    "EXCLUDE: questions asked, document content, greetings, things about AI.\n"
    "Return {} if nothing qualifies."
)


@dataclass
class Entities:
    persons: list[dict] = field(default_factory=list)
    places: list[dict] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    organizations: list[dict] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not any([self.persons, self.places, self.topics, self.organizations, self.facts])


async def extract(text: str) -> Entities:
    router = get_llm_router()
    msgs = [
        ChatMessage(role="system", content=_SYSTEM),
        ChatMessage(role="user", content=text[:800]),
    ]
    try:
        raw = await router.run(lambda p: p.complete(msgs))
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            return Entities()
        data = json.loads(m.group())
        return Entities(
            persons=[p for p in data.get("persons", []) if p.get("name")],
            places=[p for p in data.get("places", []) if p.get("name")],
            topics=[t for t in data.get("topics", []) if str(t).strip()],
            organizations=[o for o in data.get("organizations", []) if o.get("name")],
            facts=[f for f in data.get("facts", []) if str(f).strip()],
        )
    except Exception as exc:
        logger.warning("entity extraction failed: %s", exc)
        return Entities()
