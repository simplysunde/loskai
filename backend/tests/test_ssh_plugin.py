"""Plugins: the shipped files are valid, a bad one says every problem, and what runs is
built from the file — the target only ever an argument."""

import subprocess

import pytest

from loskai.modules.ssh import plugin
from loskai.modules.ssh.plugin import PluginError


def test_every_shipped_plugin_is_valid():
    plugins = plugin.load()

    assert {"system", "services", "proxmox"} <= set(plugins)
    assert plugins["system"].actions["reboot"].confirm
    assert plugins["proxmox"].requires == ("pct", "qm")


def test_a_bad_plugin_names_every_problem():
    doc = {
        "name": "X", "description": "",
        "requires": ["tmux", "kubectl"],
        "install": {"git": {"packages": {"apt": "git"}}, "tmux": {"packages": {"yum": "tmux"}}},
        "actions": {"Go": {"label": "Go", "description": "d", "run": "true"},
                    "go": {"label": "Go", "run": "", "target": "disk", "on": "service", "colour": "red"}},
    }
    with pytest.raises(PluginError) as err:
        plugin.parse("x", doc)

    message = str(err.value)
    for part in ("`description` is required", "'kubectl' isn't a tool", "`install.git`: not in `requires`",
                 "'yum' isn't a package manager", "`actions.Go`: an action id", "`actions.go.description`",
                 "`actions.go.run`", "`actions.go.target`", "unknown keys: colour, on"):
        assert part in message


def test_an_action_runs_the_command_for_the_machine_s_package_manager():
    system = plugin.load()["system"]

    assert plugin.action_script(system, "update", "dnf") == "sudo dnf -y upgrade --refresh"
    assert plugin.action_script(system, "reboot", None) == "sudo reboot"
    with pytest.raises(PluginError, match="no command for"):
        plugin.action_script(system, "update", None)
    with pytest.raises(PluginError, match="no action"):
        plugin.action_script(system, "format-disk", "apt")


def test_a_required_tool_installs_from_its_package_or_its_script():
    p = plugin.parse("t", {
        "name": "T", "description": "d", "requires": ["tmux", "claude", "pct"],
        "install": {"tmux": {"packages": {"apt": "tmux"}}, "claude": {"script": "curl -fsSL https://example/install.sh | bash"}},
        "actions": {"go": {"label": "Go", "description": "d", "run": "true"}},
    })

    assert plugin.install_script(p, "tmux", "apt") == "sudo apt-get update && sudo apt-get install -y tmux"
    assert plugin.install_script(p, "claude", "apk").startswith("curl ")
    with pytest.raises(PluginError, match="no tmux package"):
        plugin.install_script(p, "tmux", "dnf")
    with pytest.raises(PluginError, match="has to be there already"):
        plugin.install_script(p, "pct", "apt")


@pytest.mark.parametrize(("kind", "target", "ok"), [
    ("service", "nginx", True), ("service", "getty@tty1", True), ("service", "a b", False),
    ("container", "jellyfin-jellyfin-1", True), ("container", "-rm", False),
    ("lxc", "101", True), ("vm", "abc", False), (None, None, True), (None, "nginx", False),
    ("service", None, False),
])
def test_a_target_is_checked_against_its_kind(kind, target, ok):
    if ok:
        plugin.check_target(kind, target)
    else:
        with pytest.raises(PluginError):
            plugin.check_target(kind, target)


def test_the_target_reaches_the_command_as_an_argument_never_as_code():
    # Even a target that got past the check could only ever be $1.
    command = plugin.visible('printf "<%s>" "$1"', "x; touch /tmp/pwned", None)
    out = subprocess.run(["sh", "-c", command], input="\n", capture_output=True, text=True, timeout=10).stdout

    assert out.startswith("<x; touch /tmp/pwned>")
    assert "[done, exit 0] Enter closes this." in out


def test_a_failing_action_says_its_exit_status():
    out = subprocess.run(["sh", "-c", plugin.visible("exit 3", None, None)], input="\n",
                         capture_output=True, text=True, timeout=10).stdout

    assert "[done, exit 3]" in out


def test_with_tmux_the_action_runs_in_a_session_named_after_it():
    name = plugin.session_name("services", "restart-container", "jelly.fin:1")
    command = plugin.visible("true", None, name)

    assert name == "loskai-services-restart-container-jelly_fin_1"
    assert command.startswith("tmux new-session -A -s loskai-services-restart-container-jelly_fin_1 ")
