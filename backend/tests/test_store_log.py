"""The two logs (the SSH log, the sign-in log): one JSON line an entry, owner-only, trimmed."""

import json

from loskai.shared import store


def test_a_log_is_read_newest_first(tmp_path):
    path = tmp_path / "x.log"
    path.write_text("\n".join([
        '{"event": "open", "user": "ola"}',
        "not json",
        '{"event": "install", "user": "admin"}',
        '{"event": "close", "user": "ola"}',
    ]))

    assert [e["event"] for e in store.read_log(path, 10)] == ["close", "install", "open"]
    assert [e["event"] for e in store.read_log(path, 2)] == ["close", "install"]
    assert store.read_log(tmp_path / "none.log", 10) == []


def test_a_log_read_for_a_match_finds_it_past_the_limit_of_others(tmp_path):
    path = tmp_path / "x.log"
    for n, machine in enumerate(["nas"] + ["pve"] * 5):
        store.append_log(path, {"n": n, "machine": machine})

    assert [e["n"] for e in store.read_log(path, 2, {"machine": "nas"})] == [0]


def test_a_log_is_owner_only_and_trimmed_to_its_last_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "LOG_KEEP", 3)
    path = tmp_path / "x.log"
    for n in range(30):
        store.append_log(path, {"n": n, "pad": "x" * 200})

    assert path.stat().st_mode & 0o777 == 0o600
    kept = [json.loads(line)["n"] for line in path.read_text().splitlines()]
    assert len(kept) <= 2 * 3 + 1
    assert kept[-1] == 29 and kept == list(range(kept[0], 30))
