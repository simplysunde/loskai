"""Tools: the shipped files are valid, a bad one says every problem, and what runs is
built from the file — the target only ever an argument."""

import os
import re
import shutil
import subprocess

import pytest

from loskai.modules.ssh import status, tool
from loskai.modules.ssh.tool import ToolError


def test_the_tools_come_git_claude_tailscale_tmux_then_the_rest_by_id():
    assert list(tool.load()) == ["git", "claude", "tailscale", "tmux", "proxmox", "services", "system"]


def test_every_shipped_tool_is_valid():
    tools = tool.load()

    assert {"system", "services", "proxmox", "tmux", "tailscale", "claude"} <= set(tools)
    assert tools["claude"].requires == ("claude", "tmux", "git") and tools["claude"].actions["attach"].session == "claude"
    # Claude Code is its sessions — a project's buttons follow its own; its git is the Git tool's.
    assert set(tools["claude"].actions) == {"start", "attach", "stop", "new", "update", "stop-all"}
    assert {a.id: (a.when, a.otherwise) for a in tools["claude"].actions.values() if a.when} == {
        "attach": ("running", "disabled"), "start": ("stopped", "hidden"), "stop": ("running", "hidden")}
    assert {"pull", "push", "terminal", "pull-all", "push-all", "clone", "account-key", "test-key", "every-key", "own-key",
            "machine-key", "key-on-host", "label-key", "delete-key"} == set(tools["git"].actions)
    assert tools["git"].actions["clone"].ask == "repo" and tools["git"].actions["test-key"].ask == "host"
    # The tests drop down, their answer Done or Failed, and so does making the account key —
    # Keys shows it; deleting one stays open to read.
    assert all(tools["git"].actions[a].automatic for a in ("test-key", "every-key", "key-on-host", "account-key"))
    assert tools["git"].actions["account-key"].ask == "key-comment"
    assert not tools["git"].actions["delete-key"].automatic
    assert tools["tmux"].actions["new"].ask == "session" and tools["tmux"].actions["attach"].session is False
    assert tools["system"].actions["reboot"].confirm
    assert tools["proxmox"].requires == ("pct", "qm")


@pytest.mark.parametrize("url", [
    "https://github.com/simplysunde/loskai.git", "git@github.com:simplysunde/loskai.git",
    "ssh://git@192.168.10.216:2222/sunde/loskai.git", "http://192.168.10.216:3000/sunde/loskai.git",
])
def test_clone_takes_an_https_or_ssh_remote(url):
    assert tool.TARGETS["repo"].fullmatch(url)


@pytest.mark.parametrize("url", [
    "-oProxyCommand=x", "ext::sh -c touch", "ssh://-oProxyCommand=x/a", "file:///etc/passwd", "/srv/repo",
    "git@host:-x", "https://h/a b", "https://h/a;rm", "git@-h:x",
    "ssh://-Efoo@host/x", "ssh://-oProxyCommand=x@host/a",  # a user an old git hands ssh as an option
])
def test_clone_refuses_an_option_another_transport_or_a_path(url):
    """`$1` is quoted, but git reads it: never an option, and never `ext::`, which runs a command."""
    assert not tool.TARGETS["repo"].fullmatch(url)


@pytest.mark.parametrize("host", ["github.com", "codeberg.org", "git.home.lan:2222", "192.168.10.216"])
def test_test_key_takes_a_host_and_a_port(host):
    assert tool.TARGETS["host"].fullmatch(host)


@pytest.mark.parametrize("host", ["-oProxyCommand=x", "git@github.com", "github.com:x", "a b", "h;rm", "h/x", ""])
def test_test_key_refuses_an_option_a_user_or_anything_else(host):
    assert not tool.TARGETS["host"].fullmatch(host)


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_the_account_key_is_made_once_with_its_name_and_renamed_after(tmp_path):
    run = tool.load()["git"].actions["account-key"].run
    env = {**os.environ, "HOME": str(tmp_path)}

    def name(value):
        return subprocess.run(["sh", "-c", run, "sh", value], capture_output=True, text=True, env=env, timeout=30)

    first = name("sunde@codebox")
    assert first.returncode == 0, first.stderr
    pub = (tmp_path / ".ssh" / "id_ed25519.pub").read_text()
    assert pub.startswith("ssh-ed25519 ") and pub.strip().endswith(" sunde@codebox (loskai: account)")
    assert not (tmp_path / ".ssh" / "id_ed25519").read_text().count("ENCRYPTED")  # no passphrase
    assert (tmp_path / ".ssh" / "id_ed25519").stat().st_mode & 0o077 == 0
    assert "PRIVATE" not in first.stdout

    # Again, with another name: the same key, renamed — never a second.
    again = name("codebox laptop")
    renamed = (tmp_path / ".ssh" / "id_ed25519.pub").read_text()
    assert again.returncode == 0 and renamed.split()[1] == pub.split()[1]
    assert renamed.strip().endswith(" codebox laptop (loskai: account)")
    assert sorted(p.name for p in (tmp_path / ".ssh").iterdir()) == ["id_ed25519", "id_ed25519.pub"]
    # A key with its public half lost gets it back, not replaced.
    (tmp_path / ".ssh" / "id_ed25519.pub").unlink()
    back = name("codebox")
    assert back.returncode == 0 and (tmp_path / ".ssh" / "id_ed25519.pub").read_text().split()[1] == pub.split()[1]


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_an_account_key_with_a_passphrase_is_kept_as_it_is(tmp_path):
    (tmp_path / ".ssh").mkdir()
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "secret", "-C", "me@laptop",
                    "-f", str(tmp_path / ".ssh" / "id_ed25519")], check=True)
    out = subprocess.run(["sh", "-c", tool.load()["git"].actions["account-key"].run, "sh", "codebox"],
                         capture_output=True, text=True, env={**os.environ, "HOME": str(tmp_path)}, timeout=30)

    assert out.returncode == 0 and "passphrase" in out.stdout
    assert (tmp_path / ".ssh" / "id_ed25519.pub").read_text().strip().endswith(" me@laptop")


@pytest.mark.parametrize("value", ["sunde@codebox", "codebox laptop", "work-pc_2.home"])
def test_a_key_s_name_is_plain_words(value):
    assert tool.TARGETS["key-comment"].fullmatch(value)


@pytest.mark.parametrize("value", ["", " lead", "trail ", "a(b)", "a\nb", "x" * 61, "it's", "a$b"])
def test_a_key_s_name_refuses_the_mark_s_brackets_and_anything_else(value):
    assert not tool.TARGETS["key-comment"].fullmatch(value)


def _forge(tmp_path, keys: dict[str, tuple[str, str]], config: str, greetings: dict[str, str]):
    """A home with `keys` (name → passphrase, comment) and `config`, and an `ssh` that logs
    each call and greets a key in `greetings` as the forge would, refuses any other — or,
    once `tmp_path/blocked` exists, refuses the connection itself."""
    home = tmp_path / "home"
    (home / ".ssh").mkdir(parents=True)
    for name, (passphrase, comment) in keys.items():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-C", comment,
                        "-f", str(home / ".ssh" / name)], check=True)
    (home / ".ssh" / "config").write_text(config)
    greet = tmp_path / "greet"
    greet.mkdir()
    for name, text in greetings.items():
        (greet / name).write_text(text + "\n")
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "ssh").write_text(
        f"#!/bin/sh\n[ \"$1\" = -G ] && exec {shutil.which('ssh')} -F $HOME/.ssh/config \"$@\"\n"
        f'echo "$*" >> {tmp_path}/ssh.log\n'
        f'[ -e {tmp_path}/blocked ] && {{ echo "ssh: connect to host github.com port 22: Connection refused" >&2; exit 255; }}\n'
        # After as many calls as blocked-after says, a host that stops answering — a ban.
        f'[ -e {tmp_path}/blocked-after ] && [ $(wc -l < {tmp_path}/ssh.log) -gt $(cat {tmp_path}/blocked-after) ] && '
        f'{{ echo "ssh: connect to host github.com port 22: Connection refused" >&2; exit 255; }}\n'
        'k=; prev=; for a; do [ "$prev" = -i ] && k=${a##*/}; prev=$a; done\n'
        f'[ -n "$k" ] && [ -f {greet}/$k ] && {{ cat {greet}/$k >&2; exit 1; }}\n'
        'echo "git@github.com: Permission denied (publickey)." >&2; exit 255\n')
    (bin_ / "ssh").chmod(0o755)
    env = {**os.environ, "HOME": str(home), "PATH": f"{bin_}:{os.environ['PATH']}"}

    def run(action, host):
        script = tool.load()["git"].actions[action].run
        out = subprocess.run(["sh", "-c", script, "sh", host], capture_output=True, text=True, env=env, timeout=60)
        calls = (tmp_path / "ssh.log").read_text().splitlines() if (tmp_path / "ssh.log").exists() else []
        (tmp_path / "ssh.log").unlink(missing_ok=True)
        return out, [line.split() for line in out.stdout.splitlines()], calls
    return run


GREETINGS = {
    "github.com": "Hi sunde! You've successfully authenticated, but GitHub does not provide shell access.",
    "deploy_site": "Hi sunde/site! You've successfully authenticated, but GitHub does not provide shell access.",
}


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_test_key_tries_only_the_keys_meant_for_the_host_each_alone(tmp_path):
    run = _forge(tmp_path, {
        "github.com": ("", "vm@box for github.com"),  # made for it (New key for a host)
        "deploy_site": ("", "vm@box site"), "old": ("", "vm@box"), "locked": ("secret", "vm@box"),
    }, "Host gh\n  HostName github.com\n  Port 2222\n", GREETINGS)

    out, lines, calls = run("test-key", "gh")

    assert out.returncode == 0, out.stdout + out.stderr
    assert lines[0][:4] == ["gh", "(github.com,", "port", "2222)"]
    # ssh offers gh its defaults — none of them here — and one key is made for github.com:
    # that one alone is tried. Not deploy_site, which a forge may count as a failed login.
    assert lines[1:] == [["github.com", "gets", "in", "as", "sunde"]]
    # One connection: that key alone, on the alias's host and port, nothing from the config
    # added, and nothing that could prompt.
    assert len(calls) == 1 and "git@github.com" in calls[0]
    for option in ("-F /dev/null", "IdentitiesOnly=yes", "-p 2222", "BatchMode=yes", "StrictHostKeyChecking=accept-new"):
        assert option in calls[0]

    # A host none is meant for says so, and tries nothing.
    none, _, calls = run("test-key", "codeberg.org")
    assert none.returncode == 1 and "None here" in none.stdout and "Try every key" in none.stdout
    assert all("-i" not in c.split() for c in calls)


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_test_key_finds_the_key_new_key_for_a_host_made_by_its_mark(tmp_path):
    """New key for a host writes `(loskai: for <host>)`; Test key, its next step, tries it."""
    run = _forge(tmp_path, {"github.com": ("", "vm@box (loskai: for github.com)")}, "", GREETINGS)
    out, lines, _ = run("test-key", "github.com")
    assert out.returncode == 0, out.stdout
    assert lines[1:] == [["github.com", "gets", "in", "as", "sunde"]]


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_a_skipped_passphrase_key_isnt_counted_as_tried(tmp_path):
    """The first key has a passphrase and isn't tried; the next is refused at once: the port, not a ban."""
    run = _forge(tmp_path, {"a-locked": ("secret", "vm@box"), "b-open": ("", "vm@box")}, "", {})
    (tmp_path / "blocked").touch()
    out, _, calls = run("every-key", "github.com")
    assert out.returncode == 1 and "Nothing answers SSH on github.com" in out.stdout and "fail2ban" not in out.stdout
    assert len(calls) == 1


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_test_key_tries_the_key_ssh_config_names_for_an_alias(tmp_path):
    run = _forge(tmp_path, {"site-key": ("", "vm@box"), "old": ("", "vm@box")},
                 "Host gh-site\n  HostName github.com\n  IdentityFile ~/.ssh/site-key\n  IdentitiesOnly yes\n",
                 {"site-key": GREETINGS["deploy_site"]})
    out, lines, _ = run("test-key", "gh-site")
    assert out.returncode == 0 and lines[1:] == [["site-key", "gets", "in", "as", "sunde/site", "(a", "deploy", "key)"]]


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_try_every_key_tries_each_says_which_get_in_and_stops_where_the_host_does(tmp_path):
    run = _forge(tmp_path, {
        "github.com": ("", "vm@box for github.com"), "deploy_site": ("", "vm@box site"),
        "old": ("", "vm@box"), "locked": ("secret", "vm@box"),
    }, "Host gh\n  HostName github.com\n  Port 2222\n", GREETINGS)

    out, lines, calls = run("every-key", "gh")

    assert out.returncode == 0, out.stdout + out.stderr
    assert ["deploy_site", "gets", "in", "as", "sunde/site", "(a", "deploy", "key)"] in lines
    assert ["github.com", "gets", "in", "as", "sunde"] in lines
    assert ["old", "refused"] in lines
    assert ["locked", "has", "a", "passphrase:", "not", "tried"] in lines
    assert len(calls) == 3  # one a key; the passphrase key isn't tried

    # A host that stops answering ends it: the rest aren't tried.
    (tmp_path / "blocked").touch()
    stopped, _, calls = run("every-key", "gh")
    # The first one refused: nothing answers there — the port, not a ban.
    assert stopped.returncode == 1 and "Nothing answers SSH on github.com, port 2222" in stopped.stdout
    assert "fail2ban" not in stopped.stdout and len(calls) == 1
    # One answered, then it stopped: that may be a ban, and the rest aren't tried.
    (tmp_path / "blocked").unlink()
    (tmp_path / "blocked-after").write_text("1")
    banned, _, calls = run("every-key", "gh")
    assert banned.returncode == 1 and "stopped answering after 2" in banned.stdout and "fail2ban" in banned.stdout
    assert len(calls) == 2


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_a_keys_own_test_tries_it_alone_on_the_host_named(tmp_path):
    run = _forge(tmp_path, {"deploy_site": ("", "vm@box site"), "github.com": ("", "vm@box for github.com"),
                            "old": ("", "vm@box")}, "Host gh\n  HostName github.com\n  Port 2222\n", GREETINGS)

    out, lines, calls = run("key-on-host", "deploy_site@gh")

    assert out.returncode == 0, out.stdout + out.stderr
    assert lines == [["gh", "(github.com,", "port", "2222):"], ["deploy_site", "gets", "in", "as", "sunde/site", "(a", "deploy", "key)"]]
    # That key alone, once — not the one made for github.com.
    assert len(calls) == 1 and "/deploy_site" in calls[0] and "-p 2222" in calls[0] and "IdentitiesOnly=yes" in calls[0]

    refused, lines, calls = run("key-on-host", "old@codeberg.org:2222")
    assert refused.returncode == 1 and lines == [["codeberg.org,", "port", "2222:"], ["old", "refused"]]
    assert "-p 2222" in calls[0] and "git@codeberg.org" in calls[0]
    missing, _, calls = run("key-on-host", "nope@github.com")
    assert missing.returncode == 1 and "No key nope here." in missing.stdout and calls == []


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_every_key_loskai_makes_says_what_it_is_for(tmp_path):
    a = tool.load()["git"].actions
    home, projects, run = _home_with_projects(tmp_path, {"site": "git@github.com:me/site.git"})
    for script, args in ((a["account-key"].run, ("me@box",)), (a["own-key"].run, ("site",))):
        assert run(script, *args).returncode == 0
    comment = lambda name: (home / ".ssh" / f"{name}.pub").read_text().split(" ", 2)[2].strip()  # noqa: E731
    assert comment("id_ed25519").endswith("(loskai: account)")
    assert comment("deploy_site").endswith("(loskai: deploy site)")


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_label_writes_what_a_key_is_for_on_it_and_the_key_stays_the_same(tmp_path):
    (tmp_path / ".ssh").mkdir()
    for name, passphrase in (("work", ""), ("locked", "secret")):
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-C", "me@laptop",
                        "-f", str(tmp_path / ".ssh" / name)], check=True)
    env = {**os.environ, "HOME": str(tmp_path)}
    run = tool.load()["git"].actions["label-key"].run

    def label(value):
        return subprocess.run(["sh", "-c", run, "sh", value], capture_output=True, text=True, env=env, timeout=30)

    def key(name):
        return (tmp_path / ".ssh" / f"{name}.pub").read_text().split()

    before = key("work")
    assert label("work@for:github.com").returncode == 0
    assert key("work")[:2] == before[:2]  # the same key: its type and data
    assert " ".join(key("work")[2:]) == "me@laptop (loskai: for github.com)"
    # Again: the old mark replaced, what came before it kept.
    assert label("work@deploy:site").stdout.strip() == "work: me@laptop (loskai: deploy site)"
    assert label("work@login").returncode == 0 and " ".join(key("work")[2:]) == "me@laptop (loskai: login)"
    # A key with a passphrase can't be written without it: said, and left as it was.
    locked = label("locked@account")
    assert locked.returncode == 1 and "has a passphrase" in locked.stdout and key("locked")[2:] == ["me@laptop"]
    assert label("nope@login").returncode == 1


@pytest.mark.parametrize("value", ["work@account", "work@login", "work@for:git.home.lan", "id_ed25519@deploy:my.site"])
def test_a_key_label_is_one_of_four(value):
    assert tool.TARGETS["key-label"].fullmatch(value)


@pytest.mark.parametrize("value", ["work", "work@", "work@other", "work@for:", "work@for:-x", "work@deploy:a/b",
                                   "-x@login", "work@login@login", "work@for:a b"])
def test_a_key_label_refuses_anything_else(value):
    assert not tool.TARGETS["key-label"].fullmatch(value)


# ssh's own files in ~/.ssh: never a key's name, so no action on a key reaches one.
SSH_FILES = ["authorized_keys", "authorized_keys2", "known_hosts", "known_hosts.old", "config", "environment", "rc"]


def test_ssh_s_own_files_are_the_ones_the_key_kind_refuses():
    assert sorted(status.SSH_FILES) == sorted(SSH_FILES)


@pytest.mark.parametrize("name", SSH_FILES)
def test_a_key_is_never_one_of_sshs_own_files(name):
    assert not tool.TARGETS["key"].fullmatch(name)
    assert not tool.TARGETS["key-label"].fullmatch(f"{name}@login")
    assert not tool.TARGETS["key-host"].fullmatch(f"{name}@github.com")


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_delete_touches_only_key_pairs(tmp_path):
    """Delete acts on a key with its public half, never another file there."""
    a = tool.load()["git"].actions
    ssh = tmp_path / ".ssh"
    ssh.mkdir()
    (ssh / "authorized_keys").write_text("ssh-ed25519 AAAA loskai\n")
    (ssh / "notes").write_text("not a key\n")
    env = {**os.environ, "HOME": str(tmp_path)}

    def run(action, value):
        return subprocess.run(["sh", "-c", a[action].run, "sh", value], capture_output=True, text=True, env=env, timeout=30)

    # Past the page's checks — straight at the script.
    for name in ("authorized_keys", "notes"):
        out = run("delete-key", name)
        assert out.returncode == 1 and "isn't a key" in out.stdout
        assert (ssh / name).exists()
    assert (ssh / "authorized_keys").read_text() == "ssh-ed25519 AAAA loskai\n"


def test_an_ssh_alias_with_an_underscore_is_a_host_too():
    """`Host gitea_lan` in ~/.ssh/config: the page fills a key's Test with it."""
    assert tool.TARGETS["host"].fullmatch("gitea_lan:2222")
    assert tool.TARGETS["key-host"].fullmatch("id_ed25519@gitea_lan")
    assert tool.TARGETS["key-label"].fullmatch("id_ed25519@for:gitea_lan")
    assert not tool.TARGETS["host"].fullmatch("_lan")


@pytest.mark.parametrize("value", ["id_ed25519@github.com", "deploy_my.site@git.home.lan:2222"])
def test_a_key_and_a_host_are_taken_together(value):
    assert tool.TARGETS["key-host"].fullmatch(value)


@pytest.mark.parametrize("value", ["github.com", "id@-oProxyCommand=x", "-x@github.com", "../id@github.com", "id@a b", "id@h@h"])
def test_a_key_and_a_host_refuse_an_option_a_path_or_anything_else(value):
    assert not tool.TARGETS["key-host"].fullmatch(value)


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_try_every_key_stops_at_ten(tmp_path):
    run = _forge(tmp_path, {f"k{i:02}": ("", "vm@box") for i in range(12)}, "", {})
    out, lines, calls = run("every-key", "github.com")
    assert ["Stopped", "at", "10", "keys."] in lines and len(calls) == 10


def test_test_key_and_try_every_key_try_a_key_the_same_way():
    """They differ in which keys; the part that tries one is the same, word for word."""
    a = tool.load()["git"].actions

    def one_key(run):
        start = run.index("name=${k##*/}")
        return run[start:run.index("esac; done", start)]

    assert one_key(a["test-key"].run) == one_key(a["every-key"].run) == one_key(a["key-on-host"].run)
    assert "Connection refused" in one_key(a["test-key"].run)


def _home_with_projects(tmp_path, remotes: dict[str, str]):
    """A home folder with a project per remote, and an `ssh` on the PATH that logs how it
    was called and serves each repository from `tmp_path/remotes` as the forge would — or,
    given REFUSE, refuses any call naming it."""
    home, projects = tmp_path / "home", tmp_path / "home" / "projects"
    for name, url in remotes.items():
        subprocess.run(["git", "init", "-q", str(projects / name)], check=True)
        subprocess.run(["git", "-C", str(projects / name), "remote", "add", "origin", url], check=True)
        path = url.split(":", 1)[1] if url.startswith("git@") else "/" + url.split("/", 3)[3]
        subprocess.run(["git", "init", "-q", "--bare", str(tmp_path / "remotes" / path.lstrip("/"))], check=True)
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "ssh").write_text(
        # `ssh -G` is the real one, on this home's config: ssh reads the account's own, not $HOME's.
        f"#!/bin/sh\nc=$HOME/.ssh/config; [ -f $c ] || c=/dev/null\n"
        f"[ \"$1\" = -G ] && exec {shutil.which('ssh')} -F $c \"$@\"\n"
        f"echo \"$*\" >> {tmp_path}/ssh.log\n"
        '[ -n "$REFUSE" ] && case "$*" in *"$REFUSE"*) echo "Permission denied (publickey)." >&2; exit 255;; esac\n'
        f'for a; do last=$a; done\ncd {tmp_path}/remotes || exit 1\neval "set -- $last"\nexec "$1" "${{2#/}}"\n')
    (bin_ / "ssh").chmod(0o755)
    env = {**os.environ, "HOME": str(home), "PROJECTS": str(projects), "PATH": f"{bin_}:{os.environ['PATH']}"}

    def run(script, *args, **extra):
        return subprocess.run(["sh", "-c", script, "sh", *args], capture_output=True, text=True,
                              env={**env, **extra}, timeout=30)
    return home, projects, run


def _key_of(home, name):
    """Which key the overview says a project uses."""
    env = {"PATH": os.environ["PATH"], "HOME": str(home), "SSH_ORIGINAL_COMMAND": "facts"}
    out = subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30).stdout
    return next(p["key"] for p in status.parse_facts(out)["projects"] if p["name"] == name)


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_a_project_gets_its_own_key_git_uses_it_alone_and_gives_it_back(tmp_path):
    git_tool = tool.load()["git"]
    home, projects, run = _home_with_projects(tmp_path, {"site": "https://example.invalid/a/site.git"})

    assert _key_of(home, "site") is None
    made = run(git_tool.actions["own-key"].run, "site")
    assert made.returncode == 0, made.stderr
    pub = (home / ".ssh" / "deploy_site.pub").read_text().strip()
    assert pub in made.stdout and "Made site its own key" in made.stdout
    assert "Its remote is over HTTPS" in made.stdout
    # The overview reads back what Own key set.
    assert _key_of(home, "site") == "deploy_site"
    # git hands ssh this key, and only it.
    run('git -C "$PROJECTS/site" ls-remote git@example.invalid:a/site.git')
    assert f"-i {home}/.ssh/deploy_site -o IdentitiesOnly=yes" in (tmp_path / "ssh.log").read_text()

    back = run(git_tool.actions["machine-key"].run, "site")
    assert back.returncode == 0 and "uses the machine's key again" in back.stdout and "Its own key stays" in back.stdout
    assert _key_of(home, "site") is None
    assert run(git_tool.actions["machine-key"].run, "site").stdout.strip() == "site already uses the machine's key."
    # Taken up again: the same key, already on the repository's deploy keys.
    again = run(git_tool.actions["own-key"].run, "site")
    assert "kept from before" in again.stdout and (home / ".ssh" / "deploy_site.pub").read_text().strip() == pub


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_delete_takes_the_key_off_and_its_project_back_to_the_machines(tmp_path):
    git_tool = tool.load()["git"]
    a = git_tool.actions
    home, projects, run = _home_with_projects(tmp_path, {
        "site": "ssh://git@forgejo.lan:2222/sunde/site.git", "blog": "git@github.com:sunde/blog.git"})
    assert run(a["account-key"].run, "me@box").returncode == 0
    assert run(a["own-key"].run, "site").returncode == 0

    # Delete: the files go, and site goes back to the machine's key.
    gone = run(a["delete-key"].run, "deploy_site")
    assert gone.returncode == 0 and "site uses the machine's key again" in gone.stdout
    # Its fingerprint, to find it by where it was added.
    assert re.search(r"Deleted deploy_site, SHA256:\S+\.", gone.stdout) and "find it by that fingerprint" in gone.stdout
    assert not list((home / ".ssh").glob("deploy_site*"))
    assert _key_of(home, "site") is None
    assert run(a["delete-key"].run, "deploy_site").returncode == 1  # nothing left to delete
    assert (home / ".ssh" / "id_ed25519").exists()


@pytest.mark.skipif(not (shutil.which("ssh-keygen") and shutil.which("ssh")), reason="needs ssh and ssh-keygen")
def test_a_key_ssh_config_names_is_never_deleted(tmp_path):
    """A workspace whose submodule pushes through a ~/.ssh/config alias naming its own key."""
    a = tool.load()["git"].actions
    home, projects, run = _home_with_projects(tmp_path, {"workspace": "git@github.com:sunde/workspace.git"})
    (home / ".ssh").mkdir(parents=True, exist_ok=True)
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(home / ".ssh" / "site-key")], check=True)
    (home / ".ssh" / "config").write_text("Host gh-site\n  HostName github.com\n  IdentityFile ~/.ssh/site-key\n  IdentitiesOnly yes\n")
    module = projects / "workspace" / ".git" / "modules" / "public" / "site"
    module.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "--bare", str(tmp_path / "remotes" / "sunde" / "site.git")], check=True)
    (module / "config").write_text('[remote "origin"]\n\turl = https://github.com/sunde/site.git\n'
                                   "\tpushurl = git@gh-site:sunde/site.git\n")

    kept = run(a["delete-key"].run, "site-key")
    assert kept.returncode == 1 and "~/.ssh/config names site-key, for Host gh-site" in kept.stdout
    assert (home / ".ssh" / "site-key").exists()


def test_pull_all_pulls_each_project_with_a_remote_and_says_which_failed(tmp_path):
    import subprocess

    def git(*args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    origin, projects = tmp_path / "origin.git", tmp_path / "projects"
    git("init", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    projects.mkdir()
    git("clone", str(origin), "site", cwd=projects)
    (projects / "site" / "a").write_text("x")
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "--allow-empty", "-m", "one", cwd=projects / "site")
    git("push", "origin", "HEAD:main", cwd=projects / "site")
    git("clone", str(origin), "copy", cwd=projects)
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "--allow-empty", "-m", "two", cwd=projects / "site")
    git("push", "origin", "HEAD:main", cwd=projects / "site")
    git("init", "-q", "local", cwd=projects)  # no remote: left alone

    run = tool.load()["git"].actions["pull-all"].run
    out = subprocess.run(["sh", "-c", f"PROJECTS={projects}; " + run], capture_output=True, text=True, timeout=30)

    assert out.returncode == 0, out.stderr
    assert "== copy" in out.stdout and "== site" in out.stdout and "== local" not in out.stdout
    log = subprocess.run(["git", "log", "--format=%s"], cwd=projects / "copy", capture_output=True, text=True).stdout
    assert log.split() == ["two", "one"]


def test_push_all_pushes_each_project_ahead_of_its_remote_and_skips_the_rest(tmp_path):
    def git(*args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    who = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"]
    origin, projects = tmp_path / "origin.git", tmp_path / "projects"
    git("init", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    projects.mkdir()
    git("clone", str(origin), "site", cwd=projects)
    git(*who, "commit", "--allow-empty", "-m", "one", cwd=projects / "site")
    git("push", "-u", "origin", "HEAD:main", cwd=projects / "site")
    git("clone", str(origin), "copy", cwd=projects)  # up to date: left alone
    git(*who, "commit", "--allow-empty", "-m", "two", cwd=projects / "site")
    git("init", "-q", "local", cwd=projects)  # no remote: left alone
    run = tool.load()["git"].actions["push-all"].run

    out = subprocess.run(["sh", "-c", f"PROJECTS={projects}; " + run], capture_output=True, text=True, timeout=30)

    assert out.returncode == 0, out.stderr
    assert "== site" in out.stdout and "== copy" not in out.stdout and "== local" not in out.stdout
    log = subprocess.run(["git", "log", "--format=%s", "main"], cwd=origin, capture_output=True, text=True).stdout
    assert log.split() == ["two", "one"]
    again = subprocess.run(["sh", "-c", f"PROJECTS={projects}; " + run], capture_output=True, text=True, timeout=30)
    assert again.returncode == 0 and "Nothing to push." in again.stdout
    # A branch with no upstream is tried, and fails saying so.
    git("checkout", "-q", "-b", "new", cwd=projects / "copy")
    failed = subprocess.run(["sh", "-c", f"PROJECTS={projects}; " + run], capture_output=True, text=True, timeout=30)
    assert failed.returncode == 1 and "== copy" in failed.stdout and "upstream" in failed.stderr


def test_every_installer_is_for_a_program_the_overview_detects():
    assert set(tool.INSTALLERS) <= set(status.PROGRAMS)
    for how in tool.INSTALLERS.values():
        assert set(how) in ({"packages"}, {"script"})
        assert set(how.get("packages", {})) <= set(tool.MANAGERS)


def test_a_bad_tool_names_every_problem():
    doc = {
        "name": "X", "description": "",
        "requires": ["tmux", "kubectl"],
        "install": {"tmux": {"packages": {"apt": "tmux"}}},
        "actions": {"Go": {"label": "Go", "description": "d", "run": "true"},
                    "go": {"label": "Go", "run": {"yum": "x"}, "target": "disk", "on": "service", "colour": "red"}},
    }
    with pytest.raises(ToolError) as err:
        tool.parse("x", doc)

    message = str(err.value)
    for part in ("`description` is required", "'kubectl' isn't a program", "unknown keys: install",
                 "'yum' isn't a package manager", "`actions.Go`: an action id", "`actions.go.description`",
                 "`actions.go.target`", "unknown keys: colour, on"):
        assert part in message


def test_an_action_runs_the_command_for_the_machine_s_package_manager():
    system = tool.load()["system"]

    assert tool.action_script(system, "update", "dnf") == "sudo dnf -y upgrade --refresh"
    assert tool.action_script(system, "reboot", None) == "sudo reboot"
    with pytest.raises(ToolError, match="no command for"):
        tool.action_script(system, "update", None)
    with pytest.raises(ToolError, match="no action"):
        tool.action_script(system, "format-disk", "apt")


def test_adding_a_tool_installs_what_it_lacks_packages_in_one_command_then_scripts(monkeypatch):
    monkeypatch.setattr(tool, "INSTALLERS", {
        "tmux": {"packages": {"apt": "tmux", "dnf": "tmux"}},
        "git": {"packages": {"apt": "git"}},
        "claude": {"script": "curl -fsSL https://example/install.sh | bash"},
    })
    t = tool.parse("t", {
        "name": "T", "description": "d", "requires": ["tmux", "git", "claude"],
        "actions": {"go": {"label": "Go", "description": "d", "run": "true"}},
    })

    assert tool.install_script(t, {"curl"}, "apt") == (
        "sudo apt-get update && sudo apt-get install -y tmux git && curl -fsSL https://example/install.sh | bash"
    )
    assert tool.install_script(t, {"git", "claude"}, "dnf") == "sudo dnf install -y tmux"
    with pytest.raises(ToolError, match="No git package for dnf"):
        tool.install_script(t, {"claude", "curl"}, "dnf")
    with pytest.raises(ToolError, match="has everything"):
        tool.install_script(t, {"tmux", "git", "claude"}, "apt")
    with pytest.raises(ToolError, match="can't be installed from here"):
        tool.install_script(tool.load()["proxmox"], set(), "apt")


@pytest.mark.parametrize(("kind", "target", "ok"), [
    ("service", "nginx", True), ("service", "getty@tty1", True), ("service", "a b", False),
    ("service", "-Hroot@10.0.0.9", False), ("service", "--root=/tmp", False),
    ("container", "jellyfin-jellyfin-1", True), ("container", "-rm", False),
    ("lxc", "101", True), ("vm", "abc", False), (None, None, True), (None, "nginx", False),
    ("service", None, False),
    # `$` alone also matches before a trailing newline.
    ("service", "nginx\n", False), ("project", "myproj\n", False), ("lxc", "101\n", False),
])
def test_a_target_is_checked_against_its_kind(kind, target, ok):
    if ok:
        tool.check_target(kind, target)
    else:
        with pytest.raises(ToolError):
            tool.check_target(kind, target)


def test_the_target_reaches_the_command_as_an_argument_never_as_code():
    # Even a target that got past the check could only ever be $1.
    command = tool.terminal_command('printf "<%s>" "$1"', "x; touch /tmp/pwned", None)
    out = subprocess.run(["sh", "-c", command], input="\n", capture_output=True, text=True, timeout=10).stdout

    assert out.startswith("<x; touch /tmp/pwned>")
    assert "[done, exit 0] Enter closes this." in out


def test_a_failing_action_says_its_exit_status():
    out = subprocess.run(["sh", "-c", tool.terminal_command("exit 3", None, None)], input="\n",
                         capture_output=True, text=True, timeout=10).stdout

    assert "[done, exit 3]" in out


def test_an_automatic_action_ends_by_itself_when_it_succeeds_and_waits_when_it_fails():
    ok = subprocess.run(["sh", "-c", tool.terminal_command("echo ran", None, None, automatic=True) + "; echo after"],
                        input="", capture_output=True, text=True, timeout=10).stdout
    failed = subprocess.run(["sh", "-c", tool.terminal_command("exit 3", None, None, automatic=True)], input="\n",
                            capture_output=True, text=True, timeout=10).stdout

    assert ok == "ran\n"  # exited at once: nothing after it ran, nothing waited for Enter
    assert "[failed, exit 3] Enter closes this." in failed


def test_sudo_s_password_is_read_first_and_handed_to_sudo_never_put_in_a_command(tmp_path):
    # A sudo that records what it is given on stdin, and runs the rest.
    fake = tmp_path / "sudo"
    fake.write_text(f'#!/bin/sh\nif [ "$1" = -S ]; then cat > {tmp_path}/given; exit 0; fi\nexec "$@"\n')
    fake.chmod(0o755)
    command = tool.terminal_command("sudo echo ran", None, None, automatic=True, password=True)

    out = subprocess.run(["sh", "-c", command], input="hunter22 x\n", capture_output=True, text=True,
                         timeout=10, env={"PATH": f"{tmp_path}:/usr/bin:/bin", "HOME": str(tmp_path)})

    assert (tmp_path / "given").read_text() == "hunter22 x\n"
    assert out.stdout == "ran\n" and "hunter22" not in command


@pytest.mark.skipif(shutil.which("tmux") is None or shutil.which("script") is None, reason="needs tmux and script")
@pytest.mark.parametrize("password", [False, True])
def test_an_automatic_action_in_tmux_leaves_its_last_lines_on_screen(tmp_path, password):
    """tmux clears its screen as it exits, so a run that ended by itself would leave a
    blank terminal: its last lines are printed again after it, in the terminal's own."""
    command = tool.terminal_command("echo first; echo second", None, "loskai-test-run", automatic=True,
                                    password=password)
    env = {"HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "TMUX_TMPDIR": str(tmp_path), "TERM": "xterm-256color"}
    stdin = "secret\n" if password else ""

    out = subprocess.run(["script", "-qfec", command, "/dev/null"], input=stdin, capture_output=True, text=True,
                         timeout=20, env=env).stdout

    after = out.rsplit("\x1b[?1049l", 1)[-1]  # what stays once tmux has left its screen
    assert "first" in after and "second" in after
    assert not any((tmp_path / ".cache" / "loskai").glob("*"))


def test_in_tmux_the_password_reaches_the_pane_through_a_fifo_and_a_running_session_is_attached():
    command = tool.terminal_command("true", None, "loskai-system-update", automatic=True, password=True)

    assert command.startswith("IFS= read -r p; stty echo")
    assert 'mkfifo "$d/p"' in command and 'rm -rf "$d"' in command
    assert "tmux new-session -d -s loskai-system-update" in command
    assert "tmux attach-session -t =loskai-system-update" in command


_STUB_CLAUDE = """#!/bin/sh
if [ "$1" = auth ]; then case "$(basename "$PWD")" in
  nologin) printf '{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n'; exit 1 ;;
  old) echo "error: unknown command 'auth'" >&2; exit 1 ;;
  hangs) sleep 60 ;;
  *) printf '{\n  "loggedIn": true\n}\n'; exit 0 ;;
esac; fi
echo "$(basename "$PWD") $*" >> "$HOME/args"
case "$(basename "$PWD")" in
  dies) exit 1 ;;
  my.blog) echo "Is this a project you created or one you trust?"; echo "  Yes, I trust this folder"; sleep 60 ;;
  *) sleep 60 ;;
esac
"""


@pytest.mark.skipif(shutil.which("tmux") is None, reason="needs tmux")
def test_claude_starts_in_the_background_says_when_it_waits_or_dies_and_stop_all_keeps_your_own(tmp_path):
    """Claude's Start and Stop all as a machine runs them, on a tmux server of the test's own,
    with a stand-in claude: one that asks to trust its folder (as Claude does in one it was
    never told to trust — found on a real machine), one that exits at once, one not logged in
    (Remote Control then never connects — found on a real machine), and one too old to say."""
    home = tmp_path / "h"
    (home / "bin").mkdir(parents=True)
    for project in ("site", "my.blog", "dies", "nologin", "old", "hangs"):
        (home / "projects" / project / ".git").mkdir(parents=True)
    stub = home / "bin" / "claude"
    stub.write_text(_STUB_CLAUDE)
    stub.chmod(0o755)
    # A conversation in site, so it is continued.
    site = str(home / "projects" / "site")
    conversations = home / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", site)
    conversations.mkdir(parents=True)
    (conversations / "a.jsonl").touch()
    env = {"HOME": str(home), "PATH": f"{home / 'bin'}:/usr/bin:/bin", "TMUX_TMPDIR": str(tmp_path)}
    claude = tool.load()["claude"]

    def run(action, target=None):
        command = tool.terminal_command(tool.action_script(claude, action, "apt"), target, None, "projects", automatic=True)
        return subprocess.Popen(["sh", "-c", command], env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def tmux(*args):
        return subprocess.run(["tmux", *args], env=env, capture_output=True, text=True)

    try:
        started = {p: run("start", p) for p in ("site", "my.blog", "dies", "nologin", "old", "hangs")}
        said = {p: proc.communicate(timeout=30)[0] for p, proc in started.items()}
        assert said["site"].startswith("Claude runs in site, with Remote Control on.")
        assert "Claude asks whether to trust my.blog first: Attach to answer it." in said["my.blog"]
        assert "[failed, exit 1]" in said["my.blog"]
        assert "Claude stopped at once." in said["dies"] and "[failed, exit 1]" in said["dies"]
        assert said["nologin"].startswith("Claude isn't logged in on this machine")
        assert "[failed, exit 1]" in said["nologin"]
        # An older Claude, without auth status, starts as before.
        assert said["old"].startswith("Claude runs in old, with Remote Control on.")
        # One whose auth status never answers is given up on, and starts: Start never hangs on it.
        assert said["hangs"].startswith("Claude runs in hangs, with Remote Control on.")
        args = sorted((home / "args").read_text().splitlines())
        assert f"site --continue --remote-control {os.uname().nodename}: site" in args
        assert f"my.blog --remote-control {os.uname().nodename}: my.blog" in args
        assert run("start", "site").communicate(timeout=30)[0].startswith("Claude already runs in site.")

        # A session of your own whose name starts like Claude's isn't a project's.
        tmux("new-session", "-d", "-s", "claude-notes", "sleep 60")
        assert run("stop-all").communicate(timeout=30)[0].startswith("Stopped 4 Claude sessions.")
        assert tmux("ls", "-F", "#S").stdout.split() == ["claude-notes"]
    finally:
        tmux("kill-server")


def _pane(tmp_path, job):
    """A run's tmux pane, run as tmux would: in its own folder, beside the FIFO."""
    folder = tmp_path / "run"
    folder.mkdir()
    os.mkfifo(folder / "p")
    script = tool._pane_reads_password() + job
    return folder, subprocess.Popen(["sh", "-c", script], cwd=folder, env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
                                    stdout=subprocess.PIPE, text=True)


def test_the_pane_reads_the_password_then_removes_its_folder(tmp_path):
    folder, pane = _pane(tmp_path, 'printf "<%s>" "$p"')
    (folder / "p").write_text("hunter22\n")
    out, _ = pane.communicate(timeout=10)
    assert out == "<hunter22>" and not folder.exists()


def test_a_pane_sent_no_password_ends_rather_than_wait_for_the_next_run(tmp_path, monkeypatch):
    """Cut off between the session starting and the password arriving, the pane used to
    wait on the FIFO for good — and the next run of that action attached to it, blank."""
    monkeypatch.setattr(tool, "PASSWORD_WAIT", 1)
    folder, pane = _pane(tmp_path, "echo ran")
    out, _ = pane.communicate(timeout=10)
    assert pane.returncode != 0 and out == "" and not folder.exists()


def test_automatic_must_be_true_or_false():
    with pytest.raises(tool.ToolError, match="automatic` must be true or false"):
        tool.parse("t", {"name": "T", "description": "d", "actions": {
            "go": {"label": "Go", "description": "d", "automatic": "yes", "run": "true"}}})


def test_with_tmux_the_action_runs_in_a_session_named_after_it():
    services = tool.load()["services"]
    name = tool.session_name(services, services.actions["restart-container"], "jelly.fin:1")
    command = tool.terminal_command("true", None, name)

    assert name == "loskai-services-restart-container-jelly_fin_1"
    assert command.startswith("tmux new-session -A -s loskai-services-restart-container-jelly_fin_1 ")


def test_an_action_can_share_a_session_or_be_tmux_itself():
    t = tool.parse("t", {"name": "T", "description": "d", "actions": {
        "open": {"label": "Open", "description": "d", "target": "project", "session": "claude", "run": "true"},
        "attach": {"label": "Attach", "description": "d", "target": "session", "session": False, "run": "true"},
    }})

    assert tool.session_name(t, t.actions["open"], "site") == "claude-site"
    assert tool.session_name(t, t.actions["attach"], "work") is None


def test_the_overview_says_whose_each_session_is_and_which_rows_run():
    tools = {"claude": tool.parse("claude", {"name": "C", "description": "d", "actions": {
        "open": {"label": "Open", "description": "d", "target": "project", "session": "claude", "run": "true"},
        "end": {"label": "End", "description": "d", "target": "project", "session": "claude", "run": "true"},
        "pull": {"label": "Pull", "description": "d", "target": "project", "run": "true"},
    }})}
    facts = {"ok": True, "projects": [{"name": "site"}, {"name": "my.blog"}, {"name": "idle"}],
             "tmux": [{"name": "claude-site"}, {"name": "claude-my_blog"}, {"name": "claude-gone"},
                      {"name": "work"}]}

    view = tool.claim_sessions(facts, tools)

    # Named as the run names it: a project's `.` is a `_` in tmux.
    assert view["live"] == {"claude": {"project": ["my.blog", "site"]}}
    # A session left from a project no longer there is still Claude Code's, not the user's.
    assert [(s["name"], s["tool"]) for s in view["tmux"]] == [
        ("claude-site", "claude"), ("claude-my_blog", "claude"), ("claude-gone", "claude"), ("work", None)]
    assert facts["tmux"][0] == {"name": "claude-site"}  # the cached overview is not changed in place
    assert tool.claim_sessions({"ok": True, "tmux": None, "projects": None}, tools)["live"] == {}


def test_ask_and_session_are_checked():
    doc = {"name": "T", "description": "d", "actions": {
        "a": {"label": "A", "description": "d", "run": "true", "ask": "colour"},
        "b": {"label": "B", "description": "d", "run": "true", "ask": "session", "target": "session"},
        "c": {"label": "C", "description": "d", "run": "true", "session": "Not ok"},
        "d": {"label": "D", "description": "d", "run": "true", "session": True},
    }}
    with pytest.raises(ToolError) as err:
        tool.parse("t", doc)

    message = str(err.value)
    for part in ("`actions.a.ask` must be one of", "`actions.b`: give `target` or `ask`, not both",
                 "`actions.c.session` must be false", "`actions.d.session` must be false"):
        assert part in message


def test_when_is_running_or_stopped_and_needs_a_target_whose_rows_share_a_session():
    def actions(**extra):
        return {"name": "T", "description": "d", "actions": {
            "attach": {"label": "A", "description": "d", "target": "project", "session": "claude", "run": "true"},
            **extra}}

    t = tool.parse("t", actions(stop={"label": "S", "description": "d", "target": "project", "when": "running",
                                      "otherwise": "disabled", "session": False, "run": "true"}))
    assert t.actions["stop"].when == "running" and t.actions["attach"].when is None
    assert t.actions["stop"].otherwise == "disabled" and t.actions["attach"].otherwise == "hidden"
    assert {k: tool.view(t)["actions"][1][k] for k in ("when", "otherwise")} == {"when": "running", "otherwise": "disabled"}

    with pytest.raises(ToolError) as err:
        tool.parse("t", actions(
            a={"label": "A", "description": "d", "target": "project", "when": "idle", "run": "true"},
            # No action of `session` rows shares a session: running could never be told.
            b={"label": "B", "description": "d", "target": "session", "when": "running", "run": "true"},
            c={"label": "C", "description": "d", "when": "stopped", "run": "true"},
            d={"label": "D", "description": "d", "target": "project", "when": "running", "otherwise": "grey", "run": "true"},
            e={"label": "E", "description": "d", "target": "project", "otherwise": "disabled", "run": "true"},
        ))
    message = str(err.value)
    assert "`actions.a.when` must be one of running, stopped" in message
    assert "`actions.b.when`: needs a `target` whose rows share a `session`" in message
    assert "`actions.c.when`: needs a `target`" in message
    assert "`actions.d.otherwise` must be one of hidden, disabled" in message
    assert "`actions.e.otherwise` needs a `when`" in message


def test_an_action_is_on_its_card_in_a_settings_dialog_or_in_keys():
    doc = {"name": "X", "description": "d", "actions": {
        "a": {"label": "A", "description": "d", "run": "true", "place": "settings"},
        "b": {"label": "B", "description": "d", "run": "true", "place": "menu"},
        "c": {"label": "C", "description": "d", "run": "true", "target": "service", "place": "settings"},
        "d": {"label": "D", "description": "d", "run": "true", "target": "project", "place": "settings"},
        "e": {"label": "E", "description": "d", "run": "true", "target": "key", "place": "keys"},
        "f": {"label": "F", "description": "d", "run": "true", "place": "keys"},
    }}
    with pytest.raises(ToolError) as err:
        tool.parse("x", doc)
    message = str(err.value)
    assert "`actions.b.place` must be one of card, settings, keys" in message
    assert "`actions.c.place`: only a project has a settings dialog" in message
    assert "`actions.e.place`: a key's own actions are on its row in Keys" in message
    assert not any(f"actions.{x}" in message for x in "adf")
    git = tool.load()["git"].actions
    assert {a.id: (a.target, a.place) for a in git.values() if a.place != "card" or a.target == "key"} == {
        "own-key": ("project", "settings"), "machine-key": ("project", "settings"),
        "account-key": (None, "keys"), "test-key": (None, "keys"), "every-key": (None, "keys"),
        "key-on-host": (None, "keys"), "label-key": (None, "keys"), "delete-key": ("key", "card")}


@pytest.mark.parametrize("name", ["id_ed25519", "deploy_site", "deploy_my.site", "work-laptop"])
def test_a_key_is_a_file_name_in_ssh(name):
    assert tool.TARGETS["key"].fullmatch(name)


@pytest.mark.parametrize("name", ["-oProxyCommand=x", "../id_rsa", "a/b", ".hidden", "a b", ""])
def test_a_key_is_never_a_path_or_an_option(name):
    assert not tool.TARGETS["key"].fullmatch(name)


def test_a_script_installer_gets_curl_first_where_it_is_missing():
    tailscale = tool.load()["tailscale"]

    assert tool.install_script(tailscale, set(), "apt") == (
        "sudo apt-get update && sudo apt-get install -y curl && curl -fsSL https://tailscale.com/install.sh | sudo sh"
    )
    assert tool.install_script(tailscale, {"curl"}, "apt") == "curl -fsSL https://tailscale.com/install.sh | sudo sh"
    assert tool.to_install(tailscale, set()) == ["curl", "tailscale"]


@pytest.mark.parametrize(("kind", "name", "ok"), [
    ("session", "work", True), ("session", "0", True), ("session", "loskai-system-update", True),
    ("session", "a b", False), ("session", "-t", False), ("session", "a;b", False),
    ("project", "site", True), ("project", "my.site_2", True), ("project", "..", False),
    ("project", "a/b", False), ("project", ".hidden", False),
])
def test_a_typed_name_is_checked_like_a_target(kind, name, ok):
    if ok:
        tool.check_target(kind, name)
    else:
        with pytest.raises(ToolError):
            tool.check_target(kind, name)


@pytest.mark.parametrize(("typed", "stored"), [
    ("~", ""), ("~/", ""), ("~/projects", "projects"), ("~/code/", "code"), (" ~/my.work ", "my.work"),
])
def test_a_projects_folder_is_home_or_one_folder_in_it(typed, stored):
    assert tool.parse_projects_folder(typed) == stored
    assert tool.show_projects_folder(stored) == (f"~/{stored}" if stored else "~")


@pytest.mark.parametrize("typed", ["/srv/code", "~/a/b", "~/..", "~/.hidden", "code", "~/a b", ""])
def test_a_projects_folder_elsewhere_is_refused(typed):
    with pytest.raises(ToolError, match="one folder in it"):
        tool.parse_projects_folder(typed)


@pytest.mark.parametrize(("stored", "expected"), [(None, "/h/projects"), ("", "/h"), ("code", "/h/code")])
def test_an_action_finds_the_projects_folder_as_PROJECTS(stored, expected):
    command = tool.terminal_command('printf "<%s>" "$PROJECTS"', None, None, stored)
    out = subprocess.run(["sh", "-c", command], input="\n", capture_output=True, text=True, timeout=10,
                         env={"PATH": "/usr/bin:/bin", "HOME": "/h"}).stdout

    assert out.startswith(f"<{expected}>")


# --- Updates without a password ---


@pytest.mark.parametrize(("manager", "steps"), [
    ("apt", ["apt-get update", "apt-get -y dist-upgrade"]),
    ("dnf", ["dnf -y upgrade --refresh"]),
    ("apk", ["apk upgrade -U"]),
    ("pacman", ["pacman -Syu --noconfirm"]),
])
def test_the_sudo_rule_allows_exactly_system_s_update(manager, steps):
    assert tool.update_commands(manager) == steps


def test_the_rule_names_each_command_by_its_path_and_is_checked_before_it_is_used():
    script = tool.allow_script("apt")

    assert ("NOPASSWD: $(command -v apt-get) update, $(command -v apt-get) -y dist-upgrade, "
            "$(command -v rm) -f /etc/sudoers.d/loskai") in script
    assert "visudo -cf $t" in script and "mktemp /etc/sudoers.d/loskai.XXXXXX" in script
    # The root part sits in sh -c '…': no single quote of its own.
    root = script.split("sudo sh -c '", 1)[1].split("' sh ", 1)[0]
    assert "'" not in root
    # The check after it forgets the password just typed.
    assert script.index("sudo -k") < script.index("sudo -n -l apt-get update")


def test_an_update_that_isn_t_plain_sudo_steps_gets_no_rule(monkeypatch):
    system = tool.parse("system", {
        "name": "System", "description": "d",
        "actions": {"update": {"label": "Update", "description": "d", "run": {"apt": "sudo apt-get update; sh"}}},
    })
    monkeypatch.setattr(tool, "load", lambda: {"system": system})

    with pytest.raises(ToolError, match="isn't plain sudo commands"):
        tool.allow_script("apt")
    with pytest.raises(ToolError, match="no command for"):
        tool.update_commands("dnf")


# --- Settings: a value on the machine a tool's card shows and sets ---


def test_git_s_settings_are_its_name_and_email():
    git = tool.load()["git"]

    assert list(git.settings) == ["name", "email", "project-name", "project-email"]
    assert git.settings["email"].write == 'git config --global user.email "$1"'
    assert git.settings["project-email"].target == "project" and git.settings["project-email"].overrides == "email"


def test_a_tool_needs_an_action_or_a_setting_and_a_setting_names_its_kind():
    with pytest.raises(tool.ToolError, match="unless it has `settings`"):
        tool.parse("t", {"name": "T", "description": "d"})
    with pytest.raises(tool.ToolError, match=r"settings.x.value` must be one of"):
        tool.parse("t", {"name": "T", "description": "d", "settings": {
            "x": {"label": "X", "description": "d", "value": "anything", "read": "true", "write": "true"}}})


def test_settings_are_read_in_one_script_and_unset_ones_are_none():
    git = tool.load()["git"]
    script = tool.read_settings_script(git)

    assert script.count("git config --global user.") == 2
    assert tool.parse_settings(git, "#loskai-setting name\nOla Nordmann\n#loskai-setting email\n") == {
        "values": {"name": "Ola Nordmann", "email": None}, "targets": {"project": {}}}


def test_a_project_s_setting_is_written_read_and_taken_off_in_its_repo(tmp_path):
    home = tmp_path / "home"
    projects = home / "projects"
    for name in ("site", "notes", "-x"):
        subprocess.run(["git", "init", "-q", str(projects / name)], check=True)
    git = tool.load()["git"]
    env = {"HOME": str(home), "PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1"}

    def sh(script):
        out = subprocess.run(["sh", "-c", script], env=env, capture_output=True, text=True, timeout=30)
        assert out.returncode == 0, out.stderr
        return out.stdout

    sh(tool.write_setting_script(git, "name", "Ola Nordmann"))
    sh(tool.write_setting_script(git, "project-name", "Ola; $(id)", target_name="site"))
    sh(tool.write_setting_script(git, "project-email", "ola@work.example", target_name="site"))
    read = tool.parse_settings(git, sh(tool.read_settings_script(git)))

    assert read["values"]["name"] == "Ola Nordmann"
    # A folder no project can be named (`-x`) isn't read; one with nothing set reads None.
    assert read["targets"] == {"project": {
        "site": {"project-name": "Ola; $(id)", "project-email": "ola@work.example"},
        "notes": {"project-name": None, "project-email": None}}}
    # Taking one off leaves the global one, and taking off what isn't there is no failure.
    sh(tool.write_setting_script(git, "project-name", "", target_name="site"))
    sh(tool.write_setting_script(git, "project-name", "", target_name="site"))
    assert tool.parse_settings(git, sh(tool.read_settings_script(git)))["targets"]["project"]["site"] == {
        "project-name": None, "project-email": "ola@work.example"}
    who = subprocess.run(["git", "-C", str(projects / "site"), "config", "user.name"], env=env,
                         capture_output=True, text=True).stdout.strip()
    assert who == "Ola Nordmann"


def test_a_project_s_setting_needs_its_project_and_the_machine_s_none():
    git = tool.load()["git"]

    with pytest.raises(tool.ToolError, match="Not a project"):
        tool.write_setting_script(git, "project-name", "Ola")
    with pytest.raises(tool.ToolError, match="Not a project"):
        tool.write_setting_script(git, "project-name", "Ola", target_name="../etc")
    with pytest.raises(tool.ToolError, match="for the machine"):
        tool.write_setting_script(git, "name", "Ola", target_name="site")
    # The machine's name can't be taken off: it has no `unset`.
    with pytest.raises(tool.ToolError, match="Not a valid git name"):
        tool.write_setting_script(git, "name", "")


def test_a_setting_s_target_and_what_it_overrides_are_checked():
    def settings(**extra):
        return {"name": "T", "description": "d", "settings": {
            "n": {"label": "N", "description": "d", "value": "git-name", "read": "true", "write": "true"},
            "p": {"label": "P", "description": "d", "value": "git-name", "read": "true", "write": "true", **extra}}}

    with pytest.raises(tool.ToolError, match=r"settings.p.target` must be one of project"):
        tool.parse("t", settings(target="session"))
    with pytest.raises(tool.ToolError, match=r"settings.p.overrides` is only for a setting with a `target`"):
        tool.parse("t", settings(overrides="n"))
    with pytest.raises(tool.ToolError, match=r"settings.p.overrides` must name a setting of the machine's"):
        tool.parse("t", settings(target="project", overrides="nothing"))
    with pytest.raises(tool.ToolError, match=r"settings.p.unset` must be a command"):
        tool.parse("t", settings(unset=""))
    assert tool.parse("t", settings(target="project", overrides="n", unset="true")).settings["p"].overrides == "n"


def test_a_value_reaches_the_write_command_only_as_1():
    t = tool.parse("t", {"name": "T", "description": "d", "settings": {
        "n": {"label": "N", "description": "d", "value": "git-name", "read": "true", "write": 'printf "<%s>" "$1"'}}})

    out = subprocess.run(["sh", "-c", tool.write_setting_script(t, "n", "Ola; touch /tmp/pwned $(id)")],
                         capture_output=True, text=True, timeout=10).stdout

    assert out == "<Ola; touch /tmp/pwned $(id)>"
    with pytest.raises(tool.ToolError, match="Not a valid git name"):
        tool.write_setting_script(t, "n", "line\nbreak")
    with pytest.raises(tool.ToolError, match="Not a valid git name"):
        tool.write_setting_script(t, "n", "Ola\n")


def test_the_tool_files_are_read_once(monkeypatch):
    reads = []
    real = tool.yaml.safe_load
    monkeypatch.setattr(tool.yaml, "safe_load", lambda text: reads.append(1) or real(text))
    tool._read.cache_clear()

    first = tool.load()
    assert tool.load() is first
    assert len(reads) == len(first)

