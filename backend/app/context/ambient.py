"""Build a formatted ambient context string (time + location + weather)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


async def build_ambient_context(
    lat: float | None = None,
    lon: float | None = None,
    city: str | None = None,
    country: str | None = None,
    timestamp: str | None = None,
) -> str:
    parts: list[str] = []

    # Time / date — frontend sends pre-formatted local time string, use as-is
    if timestamp:
        parts.append(timestamp)
    else:
        parts.append(datetime.now(timezone.utc).strftime("%I:%M %p UTC, %A %B %d %Y").lstrip("0"))

    # Location
    loc = ", ".join(filter(None, [city, country]))
    if loc:
        parts.append(f"Location: {loc}")

    # Weather via OpenWeatherMap
    from app.config import get_settings
    s = get_settings()
    if lat is not None and lon is not None and s.openweathermap_api_key:
        try:
            from app.providers._http import client as http_client
            c = http_client()
            resp = await c.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={
                    "lat": lat, "lon": lon,
                    "appid": s.openweathermap_api_key,
                    "units": "metric",
                },
                timeout=5.0,
            )
            if resp.is_success:
                data = resp.json()
                temp = round(data["main"]["temp"])
                feels = round(data["main"]["feels_like"])
                desc = data["weather"][0]["description"]
                humidity = data["main"]["humidity"]
                parts.append(f"Weather: {temp}°C (feels {feels}°C), {desc}, humidity {humidity}%")
        except Exception as exc:
            logger.debug("Weather fetch failed (non-critical): %s", exc)

    return " | ".join(parts)
