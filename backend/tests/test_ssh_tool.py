"""Tools: the shipped files are valid, a bad one says every problem, and what runs is
built from the file — the target only ever an argument."""

import os
import subprocess

import pytest

from loskai.modules.ssh import status, tool
from loskai.modules.ssh.tool import ToolError


def test_every_shipped_tool_is_valid():
    tools = tool.load()

    assert {"system", "services", "proxmox", "tmux", "tailscale", "claude"} <= set(tools)
    assert tools["claude"].requires == ("claude", "tmux", "git") and tools["claude"].actions["open"].session == "claude"
    # Claude Code is its sessions; the project's git is the Git tool's.
    assert set(tools["claude"].actions) == {"open", "end", "new"}
    assert {"pull", "push", "terminal", "pull-all", "clone"} == set(tools["git"].actions)
    assert tools["git"].actions["clone"].ask == "repo"
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
])
def test_clone_refuses_an_option_another_transport_or_a_path(url):
    """`$1` is quoted, but git reads it: never an option, and never `ext::`, which runs a command."""
    assert not tool.TARGETS["repo"].fullmatch(url)


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
    command = tool.visible('printf "<%s>" "$1"', "x; touch /tmp/pwned", None)
    out = subprocess.run(["sh", "-c", command], input="\n", capture_output=True, text=True, timeout=10).stdout

    assert out.startswith("<x; touch /tmp/pwned>")
    assert "[done, exit 0] Enter closes this." in out


def test_a_failing_action_says_its_exit_status():
    out = subprocess.run(["sh", "-c", tool.visible("exit 3", None, None)], input="\n",
                         capture_output=True, text=True, timeout=10).stdout

    assert "[done, exit 3]" in out


def test_an_automatic_action_ends_by_itself_when_it_succeeds_and_waits_when_it_fails():
    ok = subprocess.run(["sh", "-c", tool.visible("echo ran", None, None, automatic=True) + "; echo after"],
                        input="", capture_output=True, text=True, timeout=10).stdout
    failed = subprocess.run(["sh", "-c", tool.visible("exit 3", None, None, automatic=True)], input="\n",
                            capture_output=True, text=True, timeout=10).stdout

    assert ok == "ran\n"  # exited at once: nothing after it ran, nothing waited for Enter
    assert "[failed, exit 3] Enter closes this." in failed


def test_sudo_s_password_is_read_first_and_handed_to_sudo_never_put_in_a_command(tmp_path):
    # A sudo that records what it is given on stdin, and runs the rest.
    fake = tmp_path / "sudo"
    fake.write_text(f'#!/bin/sh\nif [ "$1" = -S ]; then cat > {tmp_path}/given; exit 0; fi\nexec "$@"\n')
    fake.chmod(0o755)
    command = tool.visible("sudo echo ran", None, None, automatic=True, password=True)

    out = subprocess.run(["sh", "-c", command], input="hunter22 x\n", capture_output=True, text=True,
                         timeout=10, env={"PATH": f"{tmp_path}:/usr/bin:/bin", "HOME": str(tmp_path)})

    assert (tmp_path / "given").read_text() == "hunter22 x\n"
    assert out.stdout == "ran\n" and "hunter22" not in command


def test_in_tmux_the_password_reaches_the_pane_through_a_fifo_and_a_running_session_is_attached():
    command = tool.visible("true", None, "loskai-system-update", automatic=True, password=True)

    assert command.startswith("IFS= read -r p; stty echo")
    assert 'mkfifo "$d/p"' in command and 'rm -rf "$d"' in command
    assert "tmux new-session -d -s loskai-system-update" in command
    assert command.endswith("exec tmux attach-session -t =loskai-system-update")


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
    command = tool.visible("true", None, name)

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
    assert tool.parse_folder(typed) == stored
    assert tool.show_folder(stored) == (f"~/{stored}" if stored else "~")


@pytest.mark.parametrize("typed", ["/srv/code", "~/a/b", "~/..", "~/.hidden", "code", "~/a b", ""])
def test_a_projects_folder_elsewhere_is_refused(typed):
    with pytest.raises(ToolError, match="one folder in it"):
        tool.parse_folder(typed)


@pytest.mark.parametrize(("stored", "expected"), [(None, "/h/projects"), ("", "/h"), ("code", "/h/code")])
def test_an_action_finds_the_projects_folder_as_PROJECTS(stored, expected):
    command = tool.visible('printf "<%s>" "$PROJECTS"', None, None, stored)
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

    assert list(git.settings) == ["name", "email"]
    assert git.settings["email"].write == 'git config --global user.email "$1"'


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
        "name": "Ola Nordmann", "email": None}


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

