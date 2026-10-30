"""The SSH config editor: one entry's lines change, every other line stays as written."""

import asyncssh

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


def test_the_public_key_is_read_from_the_encrypted_private_key():
    key = asyncssh.generate_private_key("ssh-ed25519", comment="loskai")
    encrypted = key.export_private_key("openssh", passphrase="secret").decode()

    assert logic.public_key_of(encrypted, "loskai") == key.export_public_key("openssh").decode().strip()
