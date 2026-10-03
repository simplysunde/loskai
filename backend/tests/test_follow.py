"""A Docker route that follows its container (shared/follow.py).

Docker and Caddy are faked at the module boundary: `derived_upstreams` stands in for the
daemon's listing, `caddy_service.upsert_route` records pushes, and the event stream is a
fake that blocks like the real one until it is closed.
"""

import asyncio
import threading

import httpx
import pytest

from loskai.shared import follow
from loskai.shared import instances as instances_store
from loskai.shared import settings as settings_store
from loskai.shared.instances import Instance

# conftest stubs `follow.watch` for every test, so no lifespan opens a real event stream.
# Module import runs before any fixture does, so this is still the real one.
WATCH = follow.watch

CONTAINER = "whoami-whoami-1"
OLD, NEW = "192.168.10.220:8081", "192.168.10.220:8082"


@pytest.fixture
def pushed(monkeypatch):
    settings_store.update({"base_domain": "smoke.test"})
    calls: list[tuple[str, str]] = []

    async def fake_upsert(_client, inst, base):
        assert base == "smoke.test"
        calls.append((inst.id, inst.upstream))

    monkeypatch.setattr(follow.caddy_service, "upsert_route", fake_upsert)
    return calls


def _docker_says(monkeypatch, derived: dict):
    asked = []

    def fake():
        asked.append(1)
        return dict(derived)

    monkeypatch.setattr(follow, "derived_upstreams", fake)
    return asked


def _route(id="whoami", container=CONTAINER, upstream=OLD, follows=True, **kw) -> Instance:
    inst = Instance(
        **{"subdomain": id, **kw},
        id=id, name=id, type="docker", container=container,
        upstream=upstream, follow_container=follows,
    )
    return instances_store.upsert_instance(inst)


def _stored(id="whoami") -> str | None:
    return instances_store.get_instance(id).upstream


# --- reconcile: one container ---


async def test_a_moved_port_repoints_the_route_and_pushes_it(monkeypatch, pushed):
    _route()
    _docker_says(monkeypatch, {CONTAINER: NEW})

    assert await follow.reconcile(None, CONTAINER) == NEW
    assert _stored() == NEW
    assert pushed == [("whoami", NEW)]


async def test_an_unchanged_port_pushes_nothing(monkeypatch, pushed):
    _route()
    _docker_says(monkeypatch, {CONTAINER: OLD})

    assert await follow.reconcile(None, CONTAINER) is None
    assert pushed == []


async def test_a_route_set_by_hand_is_never_touched(monkeypatch, pushed):
    """follow_container False is the default for every record that predates it: its stored
    upstream stays exactly as set, whatever the container does."""
    _route(follows=False)
    asked = _docker_says(monkeypatch, {CONTAINER: NEW})

    assert await follow.reconcile(None, CONTAINER) is None
    assert _stored() == OLD
    assert pushed == [] and asked == []  # not even worth asking Docker


@pytest.mark.parametrize(
    "fields",
    [{"subdomain": None}, {"route_mode": "dns_only"}],
    ids=["unrouted", "dns-only"],
)
async def test_only_a_proxied_route_follows(monkeypatch, pushed, fields):
    _route(**fields)
    _docker_says(monkeypatch, {CONTAINER: NEW})

    assert await follow.reconcile(None, CONTAINER) is None
    assert pushed == []


async def test_an_unlinked_container_is_ignored(monkeypatch, pushed):
    _route()
    asked = _docker_says(monkeypatch, {"stray-1": NEW})

    assert await follow.reconcile(None, "stray-1") is None
    assert asked == []


async def test_a_port_that_can_no_longer_be_derived_leaves_the_route_alone(monkeypatch, pushed):
    """An old address that may still work beats none."""
    _route()
    _docker_says(monkeypatch, {CONTAINER: None})

    assert await follow.reconcile(None, CONTAINER) is None
    assert _stored() == OLD
    assert pushed == []


async def test_a_failed_caddy_push_still_stores_the_new_upstream(monkeypatch, pushed):
    """Same contract as machine propagation: the store is right, so Sync is a repair."""
    _route()
    _docker_says(monkeypatch, {CONTAINER: NEW})

    async def caddy_down(_client, _inst, _base):
        raise httpx.ConnectError("caddy unreachable")

    monkeypatch.setattr(follow.caddy_service, "upsert_route", caddy_down)

    assert await follow.reconcile(None, CONTAINER) == NEW
    assert _stored() == NEW


async def test_an_edit_made_while_docker_was_asked_wins(monkeypatch, pushed):
    """The follower reads, asks Docker, then writes. Someone setting the address by hand in
    between must not be overwritten by a value derived from the state before their edit."""
    _route()

    def docker_slow_while_user_edits():
        _route(upstream="10.0.0.9:9000", follows=False)
        return {CONTAINER: NEW}

    monkeypatch.setattr(follow, "derived_upstreams", docker_slow_while_user_edits)

    assert await follow.reconcile(None, CONTAINER) is None
    assert _stored() == "10.0.0.9:9000"
    assert pushed == []


# --- reconcile_all: catch-up ---


async def test_catch_up_moves_every_following_route_from_one_listing(monkeypatch, pushed):
    _route()
    _route(id="pair", container="pair-web-1", upstream="192.168.10.220:8082")
    _route(id="manual", container="manual-1", follows=False)
    asked = _docker_says(
        monkeypatch,
        {CONTAINER: NEW, "pair-web-1": "192.168.10.220:9999", "manual-1": NEW},
    )

    assert sorted(await follow.reconcile_all(None)) == sorted([CONTAINER, "pair-web-1"])
    assert len(asked) == 1
    assert _stored("manual") == OLD


async def test_catch_up_with_nothing_following_never_asks_docker(monkeypatch, pushed):
    _route(follows=False)
    asked = _docker_says(monkeypatch, {CONTAINER: NEW})

    assert await follow.reconcile_all(None) == []
    assert asked == []


# --- watch: the event loop ---


class FakeStream:
    """Hands out its events, then blocks like Docker's stream until close() — which is the
    only thing that releases a real read stuck in its thread at shutdown."""

    def __init__(self, events):
        self._events = list(events)
        self._closed = threading.Event()

    def __iter__(self):
        return self

    def __next__(self):
        if self._events:
            return self._events.pop(0)
        self._closed.wait(timeout=5)
        raise StopIteration

    def close(self):
        self._closed.set()

    @property
    def closed(self):
        return self._closed.is_set()


def _start(name):
    return {"Action": "start", "Actor": {"Attributes": {"name": name}}}


async def _until(predicate, timeout=2.0):
    for _ in range(int(timeout / 0.01)):
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never became true")


async def test_a_start_event_repoints_the_route(monkeypatch, pushed):
    _route()
    _docker_says(monkeypatch, {CONTAINER: NEW})
    stream = FakeStream([_start("unrelated-1"), _start(CONTAINER)])
    monkeypatch.setattr(follow.docker_client, "container_events", lambda: stream)

    task = asyncio.create_task(WATCH(None))
    await _until(lambda: _stored() == NEW)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert pushed == [("whoami", NEW)]
    assert stream.closed, "shutdown must close the stream, or its reader thread never returns"


async def test_the_daemon_going_away_is_retried_and_caught_up(monkeypatch, pushed):
    """No event arrives for a change made while the stream was down — so each (re)connect
    starts with a catch-up."""
    monkeypatch.setattr(follow, "RETRY_INITIAL", 0.01)
    _route()
    _docker_says(monkeypatch, {CONTAINER: NEW})
    attempts = []
    stream = FakeStream([])

    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise OSError("docker.sock: connection refused")
        return stream

    monkeypatch.setattr(follow.docker_client, "container_events", flaky)

    task = asyncio.create_task(WATCH(None))
    await _until(lambda: _stored() == NEW)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert len(attempts) == 2
    assert pushed == [("whoami", NEW)]
