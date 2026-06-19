"""Shared slowapi rate limiter instance — import from here everywhere."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
