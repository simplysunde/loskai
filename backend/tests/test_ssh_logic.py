"""The SSH config editor: one entry's lines change, every other line stays as written."""



from loskai.modules.ssh import logic

HAND_WRITTEN = """\
# My machines — written by hand
Host *
    ServerAliveInterval 30

Host nas
  hostname=192.168.10.50
  User admin
  # the NAS listens on 2222
  Port 2222

# Proxmox, in the rack
Host pve pve.lan
    HostName 192.168.10.10
    User root

Match host *.lan
    ForwardAgent no
"""


def test_reads_each_plain_alias_with_ssh_s_default_port():
    hosts = logic.hosts(HAND_WRITTEN)

    assert hosts["nas"] == {"port": 2222, "hostname": "192.168.10.50", "user": "admin"}
    assert hosts["pve"] == hosts["pve.lan"] == {"port": 22, "hostname": "192.168.10.10", "user": "root"}
    assert "*" not in hosts  # a pattern, not a machine


def test_the_first_entry_for_an_alias_wins_as_in_ssh():
    text = "Host a\n    User first\n\nHost a\n    User second\n"

    assert logic.hosts(text)["a"]["user"] == "first"


def test_editing_an_entry_changes_only_its_lines():
    out = logic.set_host(HAND_WRITTEN, "nas", {"HostName": "192.168.10.51", "User": "admin", "Port": None})

    expected = HAND_WRITTEN.replace("hostname=192.168.10.50", "hostname=192.168.10.51").replace(
        "  Port 2222\n", ""
    )
    assert out == expected  # keyword spelling, `=`, indentation and the comment all kept


def test_a_new_option_goes_at_the_end_of_its_entry_with_its_indentation():
    out = logic.set_host(HAND_WRITTEN, "nas", {"Port": "2200", "IdentitiesOnly": "yes"})

    assert "  Port 2200\n  IdentitiesOnly yes\n\n# Proxmox, in the rack\n" in out


def test_a_new_entry_is_appended_after_a_blank_line():
    out = logic.set_host(HAND_WRITTEN, "pi", logic.machine_options("192.168.10.60", "pi", 22))

    assert out == HAND_WRITTEN + "\nHost pi\n    HostName 192.168.10.60\n    User pi\n"


def test_the_first_entry_in_an_empty_file():
    out = logic.set_host("", "pi", logic.machine_options("192.168.10.60", "pi", 2222))

    assert out == "Host pi\n    HostName 192.168.10.60\n    User pi\n    Port 2222\n"


def test_nothing_to_set_adds_nothing():
    assert logic.set_host(HAND_WRITTEN, "pi", {"User": None}) == HAND_WRITTEN


def test_renaming_changes_only_that_alias():
    out = logic.rename_host(HAND_WRITTEN, "pve", "proxmox")

    assert "Host proxmox pve.lan\n" in out
    assert out.replace("Host proxmox pve.lan", "Host pve pve.lan") == HAND_WRITTEN


def test_a_rename_onto_another_entry_collides_and_onto_its_own_alias_doesnt():
    assert logic.rename_collides(HAND_WRITTEN, "nas", "pve")
    assert not logic.rename_collides(HAND_WRITTEN, "pve", "pve.lan")  # the same entry
    assert not logic.rename_collides(HAND_WRITTEN, "nas", "storage")
    assert not logic.rename_collides(HAND_WRITTEN, "nope", "pve")  # nothing to rename


def test_removing_an_entry_keeps_the_comment_that_introduces_the_next():
    out = logic.remove_host(HAND_WRITTEN, "nas")

    assert "Host nas" not in out and "the NAS listens" not in out
    assert "    ServerAliveInterval 30\n\n# Proxmox, in the rack\nHost pve pve.lan\n" in out


def test_removing_one_alias_of_several_keeps_the_entry():
    out = logic.remove_host(HAND_WRITTEN, "pve.lan")

    assert "Host pve\n    HostName 192.168.10.10\n" in out


def test_removing_the_last_entry_leaves_no_trailing_blank_lines():
    text = "Host a\n    User x\n\nHost b\n    User y\n"

    assert logic.remove_host(text, "b") == "Host a\n    User x\n"
    assert logic.remove_host("Host a\n    User x\n", "a") == ""


def test_unknown_aliases_change_nothing():
    assert logic.rename_host(HAND_WRITTEN, "nope", "x") == HAND_WRITTEN
    assert logic.remove_host(HAND_WRITTEN, "nope") == HAND_WRITTEN


def test_a_match_block_is_never_taken_for_a_host():
    out = logic.set_host(HAND_WRITTEN, "host", {"User": "x"})

    assert out.endswith("Match host *.lan\n    ForwardAgent no\n\nHost host\n    User x\n")


def test_port_22_is_left_out():
    assert logic.machine_options("10.0.0.1", "u", 22)["Port"] is None
    assert logic.machine_options("10.0.0.1", "u", 2222)["Port"] == "2222"


def test_the_authorized_keys_line_restricts_the_key_to_the_docker_host():
    key = "ssh-ed25519 AAAAC3Nza loskai"

    assert logic.authorized_keys_line(key, "192.168.10.216") == 'from="192.168.10.216" ssh-ed25519 AAAAC3Nza loskai'
    assert logic.authorized_keys_line(key, None) == key


# --- known_hosts, by machine id ---


def test_known_hosts_are_kept_by_machine_id():
    text = logic.set_known("", "nas", "ssh-ed25519 AAAA")
    text = logic.set_known(text, "pve", "ssh-ed25519 BBBB")

    assert logic.known_key(text, "nas") == "ssh-ed25519 AAAA"
    assert logic.known_key(text, "ghost") is None
    # Trusting again replaces the old key rather than adding a second.
    text = logic.set_known(text, "nas", "ssh-ed25519 CCCC")
    assert text.count("nas ") == 1 and logic.known_key(text, "nas") == "ssh-ed25519 CCCC"
    assert logic.forget_known(text, "nas") == "pve ssh-ed25519 BBBB\n"


# --- The install script, run for real by sh ---


def _install(home, existing: str | None, lines: str):
    import subprocess

    ssh = home / ".ssh"
    if existing is not None:
        ssh.mkdir(mode=0o700)
        (ssh / "authorized_keys").write_text(existing)
    subprocess.run(
        ["sh", "-c", logic.INSTALL_SCRIPT], input=lines, text=True, check=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
    )
    return (ssh / "authorized_keys")


def test_install_adds_the_lines_to_a_fresh_account(tmp_path):
    path = _install(tmp_path, None, "ssh-ed25519 MAIN loskai\nrestrict ssh-ed25519 ST loskai-status\n")

    assert path.read_text() == "ssh-ed25519 MAIN loskai\nrestrict ssh-ed25519 ST loskai-status\n"
    assert path.stat().st_mode & 0o777 == 0o600


def test_install_keeps_your_keys_and_replaces_only_loskai_s(tmp_path):
    mine = "ssh-ed25519 MINE me@laptop\n"
    old = 'from="10.0.0.1" ssh-ed25519 OLD loskai\nrestrict ssh-ed25519 OLDST loskai-status\n'

    path = _install(tmp_path, mine + old, "ssh-ed25519 NEW loskai\nrestrict ssh-ed25519 NEWST loskai-status\n")

    assert path.read_text() == mine + "ssh-ed25519 NEW loskai\nrestrict ssh-ed25519 NEWST loskai-status\n"
    assert not (tmp_path / ".ssh" / "authorized_keys.loskai-new").exists()


def _uninstall(home):
    import subprocess

    subprocess.run(["sh", "-c", logic.UNINSTALL_SCRIPT], text=True, check=True,
                   env={"HOME": str(home), "PATH": "/usr/bin:/bin"})


def test_uninstall_takes_out_only_loskai_s_lines(tmp_path):
    mine = "ssh-ed25519 MINE me@laptop\nssh-ed25519 OTHER loskai-but-not\n"
    path = _install(tmp_path, mine, "ssh-ed25519 MAIN loskai\nrestrict ssh-ed25519 ST loskai-status\n")

    _uninstall(tmp_path)

    assert path.read_text() == mine
    assert path.stat().st_mode & 0o777 == 0o600


def test_uninstall_with_nothing_there_does_nothing(tmp_path):
    _uninstall(tmp_path)  # no ~/.ssh at all

    assert not (tmp_path / ".ssh").exists()
    path = _install(tmp_path, "", "ssh-ed25519 MAIN loskai\n")
    _uninstall(tmp_path)
    assert path.read_text() == ""


def test_taking_off_loskai_s_things_starts_with_the_sudo_rule():
    # While Loskai's key still gets in: the rule allows its own removal, so no password.
    script = logic.UNINSTALL_SCRIPT
    assert script.index("sudo -n rm -f /etc/sudoers.d/loskai") < script.index("authorized_keys")
    assert "echo '!sudo-rule'" in script
