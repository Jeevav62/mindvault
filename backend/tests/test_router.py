"""FallbackRouter behaviour: fail over on retryable, abort on non-retryable."""
import pytest

from app.providers.base import ProviderBadRequest, QuotaError
from app.providers.router import AllProvidersFailed, FallbackRouter


class FakeProvider:
    def __init__(self, name, *, raises=None, value=None):
        self.name = name
        self._raises = raises
        self._value = value
        self.calls = 0

    async def complete(self):
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        return self._value


async def test_primary_success_no_fallback():
    p1 = FakeProvider("primary", value="ok")
    p2 = FakeProvider("backup", value="nope")
    router = FallbackRouter([p1, p2], kind="llm")
    assert await router.run(lambda p: p.complete()) == "ok"
    assert p1.calls == 1
    assert p2.calls == 0  # never touched


async def test_quota_error_fails_over():
    p1 = FakeProvider("primary", raises=QuotaError("429", provider="primary"))
    p2 = FakeProvider("backup", value="served-by-backup")
    router = FallbackRouter([p1, p2], kind="llm")
    assert await router.run(lambda p: p.complete()) == "served-by-backup"
    assert p1.calls == 1
    assert p2.calls == 1


async def test_non_retryable_aborts_immediately():
    p1 = FakeProvider("primary", raises=ProviderBadRequest("400", provider="primary"))
    p2 = FakeProvider("backup", value="should-not-reach")
    router = FallbackRouter([p1, p2], kind="llm")
    with pytest.raises(ProviderBadRequest):
        await router.run(lambda p: p.complete())
    assert p2.calls == 0  # bad request -> no point failing over


async def test_all_fail_raises_aggregate():
    p1 = FakeProvider("primary", raises=QuotaError("429", provider="primary"))
    p2 = FakeProvider("backup", raises=QuotaError("429", provider="backup"))
    router = FallbackRouter([p1, p2], kind="llm")
    with pytest.raises(AllProvidersFailed):
        await router.run(lambda p: p.complete())


async def test_unexpected_error_treated_as_retryable():
    p1 = FakeProvider("primary", raises=RuntimeError("boom"))
    p2 = FakeProvider("backup", value="recovered")
    router = FallbackRouter([p1, p2], kind="llm")
    assert await router.run(lambda p: p.complete()) == "recovered"
