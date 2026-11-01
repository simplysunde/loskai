"""Tools: the shipped files are valid, a bad one says every problem, and what runs is
built from the file — the target only ever an argument."""

import subprocess

import pytest

from loskai.modules.ssh import logic, tool
from loskai.modules.ssh.tool import ToolError


def test_every_shipped_tool_is_valid():
    tools = tool.load()

    assert {"system", "services", "proxmox", "tmux", "tailscale"} <= set(tools)
    assert tools["tmux"].actions["new"].ask == "session" and tools["tmux"].actions["attach"].session is False
    assert tools["system"].actions["reboot"].confirm
    assert tools["proxmox"].requires == ("pct", "qm")


def test_every_installer_is_for_a_program_the_overview_detects():
    assert set(tool.INSTALLERS) <= set(logic.PROGRAMS)
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
    ("container", "jellyfin-jellyfin-1", True), ("container", "-rm", False),
    ("lxc", "101", True), ("vm", "abc", False), (None, None, True), (None, "nginx", False),
    ("service", None, False),
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
        "sudo apt-get update && sudo apt-get install -y curl && curl -fsSL https://tailscale.com/install.sh | sh"
    )
    assert tool.install_script(tailscale, {"curl"}, "apt") == "curl -fsSL https://tailscale.com/install.sh | sh"
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
