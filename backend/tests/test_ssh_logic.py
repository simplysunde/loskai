"""The SSH config editor: one entry's lines change, every other line stays as written."""

import os
import subprocess

import asyncssh
import pytest

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


def test_the_public_key_is_read_from_the_encrypted_private_key():
    key = asyncssh.generate_private_key("ssh-ed25519", comment="loskai")
    encrypted = key.export_private_key("openssh", passphrase="secret").decode()

    assert logic.public_key_of(encrypted, "loskai") == key.export_public_key("openssh").decode().strip()


# --- The status key ---


def test_the_status_line_is_restricted_to_its_command_and_the_docker_host():
    line = logic.status_line("ssh-ed25519 AAAA loskai-status", "192.168.10.216")

    options, _, key = line.partition(" ssh-ed25519")
    assert options.startswith('restrict,from="192.168.10.216",command="')
    assert key == " AAAA loskai-status"
    # The forced command sits inside command="…", which a double quote would end early.
    assert '"' not in logic.STATUS_COMMAND and "\\" not in logic.STATUS_COMMAND


def test_without_the_docker_host_the_status_line_is_still_restricted():
    assert logic.status_line("ssh-ed25519 AAAA loskai-status", None).startswith('restrict,command="')


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


# --- What runs ---

OUTPUT = """\
#loskai-status 1
#docker
jellyfin|jellyfin/jellyfin:12.2|Up 2 days (healthy)
bambuddy|ghcr.io/maziggy/bambuddy:1.2|Up 3 hours
#systemd
cron.service loaded active running Regular background program processing daemon
docker.service loaded active running Docker Application Container Engine
getty@tty1.service loaded active running Getty on tty1
nginx.service loaded active running A high performance web server
ssh.service loaded active running OpenBSD Secure Shell server
systemd-journald.service loaded active running Journal Service
pveproxy.service loaded active running PVE API Proxy Server
#pct
VMID       Status     Lock         Name
101        running                 adguard
102        stopped                 old
#qm
      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID
       200 haos                 running    4096              32.00 1234
       201 win                  stopped    8192              64.00 0
"""


def test_running_lists_containers_your_services_and_running_guests():
    out = logic.parse_running(OUTPUT)

    assert [c["name"] for c in out["containers"]] == ["bambuddy", "jellyfin"]
    assert out["containers"][1] == {
        "name": "jellyfin", "image": "jellyfin/jellyfin:12.2", "status": "Up 2 days (healthy)", "ports": [],
    }
    # The base system's services are counted, not listed: cron, getty, ssh, journald, pveproxy.
    assert out["services"] == ["docker", "nginx"]
    assert out["hidden"] == 5
    assert out["guests"] == [
        {"id": "101", "name": "adguard", "kind": "lxc"},
        {"id": "200", "name": "haos", "kind": "vm"},
    ]
    assert out["denied"] == []
    # A line older than v6 says nothing about ports.
    assert out["listening"] is None


LISTEN_OUTPUT = """\
#loskai-status 6
#docker
jellyfin|jellyfin/jellyfin:12.2|Up 2 days|0.0.0.0:8096->8096/tcp, [::]:8096->8096/tcp
postgres|postgres:17|Up 2 days|127.0.0.1:5432->5432/tcp, 0.0.0.0:53->53/udp, 8080/tcp
#systemd
nginx.service loaded active running A high performance web server
#listen
LISTEN 0 4096 0.0.0.0:8096 0.0.0.0:* users:((docker-proxy,pid=1539,fd=8))
@1539 docker.service
LISTEN 0 2048 0.0.0.0:8000 0.0.0.0:* users:((uvicorn,pid=1415,fd=24))
@1415
LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:((nginx,pid=10,fd=6),(nginx,pid=11,fd=6))
@10 nginx.service
@11 nginx.service
LISTEN 0 511 [::]:80 [::]:* users:((nginx,pid=10,fd=7))
@10 nginx.service
LISTEN 0 511 192.168.10.5:8443 0.0.0.0:* users:((nginx,pid=10,fd=8))
@10 nginx.service
LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:* users:((systemd-resolve,pid=689,fd=15))
@689 systemd-resolved.service
LISTEN 0 511 [::1]:6379 [::]:* users:((redis,pid=70,fd=6))
@70 redis.service
LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:((sshd,pid=1916,fd=3),(systemd,pid=1,fd=93))
@1916 ssh.service
@1
LISTEN 0 4096 *:8006 *:* users:((pveproxy worker,pid=50,fd=6))
@50 pveproxy.service
"""


def test_the_ports_a_container_publishes_are_its_tcp_ones_off_loopback():
    out = logic.parse_running(LISTEN_OUTPUT)

    assert {c["name"]: c["ports"] for c in out["containers"]} == {"jellyfin": [8096], "postgres": []}


def test_a_service_s_ports_are_those_off_loopback_with_a_unit_not_the_base_system_s():
    out = logic.parse_running(LISTEN_OUTPUT)

    # Left out: Docker's proxy (jellyfin lists 8096), a process with no unit, loopback (DNS,
    # redis), ssh — base. Proxmox's web UI stays, though base.
    assert out["listening"] == [
        {"service": "nginx", "port": 80, "host": ""},
        {"service": "nginx", "port": 8443, "host": "192.168.10.5"},
        {"service": "pveproxy", "port": 8006, "host": ""},
    ]
    assert out["denied"] == []


def test_a_user_who_sees_only_its_own_sockets_says_so():
    out = logic.parse_running("#loskai-status 6\n#systemd\n#listen\n!partial\nLISTEN 0 1 0.0.0.0:80 0.0.0.0:*\n")

    assert out["denied"] == ["listen"] and out["listening"] == []


def test_a_machine_without_ss_says_so_instead_of_listing_nothing():
    # v6 prints `#listen` only where `ss` exists; an empty list must not read as "nothing listens".
    out = logic.parse_running("#loskai-status 6\n#docker\n#systemd\n")

    assert out["denied"] == ["ss"] and out["listening"] == []


def test_a_listener_bound_to_an_interface_is_on_its_addresses():
    out = logic.parse_running(
        "#loskai-status 6\n#listen\n"
        "LISTEN 0 511 0.0.0.0%eth0:80 0.0.0.0:* users:((nginx,pid=10,fd=6))\n@10 nginx.service\n"
        "LISTEN 0 511 [fe80::1]%eth0:8443 [::]:* users:((nginx,pid=10,fd=7))\n@10 nginx.service\n"
    )

    assert out["listening"] == [
        {"service": "nginx", "port": 80, "host": ""},
        {"service": "nginx", "port": 8443, "host": "fe80::1"},
    ]


def test_a_published_range_is_each_of_its_ports_unless_it_is_wide():
    out = logic.parse_running(
        "#loskai-status 6\n#docker\n"
        "web|nginx|Up|0.0.0.0:8000-8002->8000-8002/tcp\n"
        "media|jellyfin|Up|0.0.0.0:10000-11000->10000-11000/tcp\n#listen\n"
    )

    assert {c["name"]: c["ports"] for c in out["containers"]} == {
        "web": [8000, 8001, 8002], "media": [10000],
    }


def test_a_list_the_user_may_not_read_says_so():
    out = logic.parse_running("#loskai-status 1\n#docker\n!denied\n#systemd\n")

    assert out["denied"] == ["docker"] and out["containers"] == []


def test_output_that_is_not_the_status_command_s_is_refused():
    with pytest.raises(ValueError):
        logic.parse_running("Welcome to Ubuntu\n$ ")


def test_the_running_list_reads_the_older_status_line_too():
    # A machine not yet reinstalled keeps its running list; only the overview needs v2.
    assert logic.parse_running(OUTPUT.replace("status 1", "status 2"))["services"] == ["docker", "nginx"]


# --- A machine's overview ---

FACTS = """\
#loskai-status 5
#=os
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
ID=debian
# a comment line os-release may have
#=kernel
Linux 6.8.12-4-pve
#=uptime
86461.32
#=memory
MemTotal:       16303916 kB
MemAvailable:    9893212 kB
#=disks
Filesystem     1024-blocks     Used Available Capacity Mounted on
udev               8128348        0   8128348       0% /dev
tmpfs              1630392     1772   1628620       1% /run
rpool/ROOT/pve-1 100000000 25000000  75000000      25% /
/dev/sda2         97411380 34403488  58013488      38% /mnt/data
/dev/sda2         97411380 34403488  58013488      38% /srv/same-disk
/dev/loop3           65536    65536         0     100% /snap/core/1
/dev/nvme0n1p1     1098628     6288   1092340       1% /boot/efi
#=updates
apt 12
#=tools
tmux
docker
pct
#=tmux
build|1793212547|1|2
not a session line
#=tailscale
100.101.102.103
#=tailnet
100.101.102.103  codebox      sunde@       linux   -
100.64.0.2       phone        sunde@       iOS     active; relay "fra", tx 1 rx 2
100.64.0.3       nas          sunde@       linux   offline
# Health check:
#     - some warning
#=sudo
on
#=projects
projects/loskai|main|1|1793212000|2|1793211000|Tools: tmux | and Tailscale
loskai|-|0|0|-|0|
odd|row
"""


def test_the_overview_reads_os_memory_disks_updates_tools_and_tmux():
    out = logic.parse_facts(FACTS)

    assert out["os"] == "Debian GNU/Linux 12 (bookworm)" and out["os_id"] == "debian"
    assert out["kernel"] == "Linux 6.8.12-4-pve" and out["uptime"] == 86461
    assert out["memory"] == {"total": 16303916 * 1024, "available": 9893212 * 1024}
    # Storage only: the root (a ZFS dataset here), each block device once, no tmpfs or snaps.
    assert [d["mount"] for d in out["disks"]] == ["/", "/mnt/data", "/boot/efi"]
    assert out["disks"][1] == {"mount": "/mnt/data", "device": "/dev/sda2", "size": 97411380 * 1024, "used": 34403488 * 1024}
    assert out["updates"] == {"manager": "apt", "count": 12}
    assert out["programs"] == ["tmux", "docker", "pct"]
    assert out["tmux"] == [{"name": "build", "created": 1793212547, "attached": True, "windows": 2}]
    assert out["tailscale"] == "100.101.102.103"
    assert out["tailnet"] == [
        {"ip": "100.101.102.103", "name": "codebox", "os": "linux", "online": True, "self": True, "status": "-"},
        {"ip": "100.64.0.2", "name": "phone", "os": "iOS", "online": True, "self": False,
         "status": 'active; relay "fra", tx 1 rx 2'},
        {"ip": "100.64.0.3", "name": "nas", "os": "linux", "online": False, "self": False, "status": "offline"},
    ]
    assert out["projects"] == [
        {"path": "projects/loskai", "folder": "projects", "name": "loskai", "branch": "main", "dirty": True,
         "claude": 1793212000, "ahead": 2, "committed": 1793211000, "subject": "Tools: tmux | and Tailscale"},
        {"path": "loskai", "folder": "", "name": "loskai", "branch": None, "dirty": False,
         "claude": 0, "ahead": None, "committed": 0, "subject": ""},
    ]


def test_an_older_status_line_has_no_overview():
    with pytest.raises(logic.OldStatusLine):
        logic.parse_facts(OUTPUT)
    with pytest.raises(logic.OldStatusLine):
        logic.parse_facts(FACTS.replace("status 5", "status 4"))
    with pytest.raises(ValueError):
        logic.parse_facts("Welcome to Ubuntu\n$ ")


@pytest.mark.parametrize("request_", ["facts", "running", None])
def test_the_forced_command_runs_in_sh_and_answers_each_request(request_):
    # The real command, on this machine: whatever is installed, it must parse.
    assert '"' not in logic.STATUS_COMMAND and "\\" not in logic.STATUS_COMMAND
    env = {k: v for k, v in os.environ.items() if k != "SSH_ORIGINAL_COMMAND"}
    if request_:
        env["SSH_ORIGINAL_COMMAND"] = request_
    out = subprocess.run(["sh", "-c", logic.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30).stdout

    if request_ == "facts":
        facts = logic.parse_facts(out)
        assert facts["kernel"] and facts["uptime"] and facts["memory"]["total"] > 0
        assert set(facts["programs"]) <= set(logic.PROGRAMS)
    else:
        running = logic.parse_running(out)
        assert set(running) == {"containers", "services", "hidden", "guests", "listening", "denied"}
        assert running["listening"] is not None


def test_the_projects_are_the_git_repos_in_the_home_folder_read_without_the_shell(tmp_path):
    def git(*args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})

    home = tmp_path / "home"
    site = home / "projects" / "site"
    site.mkdir(parents=True)
    git("init", "-q", "-b", "main", cwd=site)
    (site / "a").write_text("a")
    git("add", "a", cwd=site)
    git("commit", "-q", "-m", "First", cwd=site)
    # An upstream it is one commit ahead of.
    git("clone", "-q", "--bare", str(site), str(tmp_path / "remote.git"), cwd=tmp_path)
    git("remote", "add", "origin", str(tmp_path / "remote.git"), cwd=site)
    git("fetch", "-q", "origin", cwd=site)
    git("branch", "-q", "-u", "origin/main", cwd=site)
    # Not pushed, and a subject the shell would glob and split, were it ever to see it.
    git("commit", "-q", "--allow-empty", "-m", "Add  * | $(touch pwned)", cwd=site)
    (site / "b").write_text("b")  # uncommitted
    (home / "empty").mkdir()
    git("init", "-q", "-b", "trunk", cwd=home / "empty")
    (home / "with space").mkdir()
    git("init", "-q", cwd=home / "with space")
    conversations = home / ".claude" / "projects" / str(site).replace("/", "-").replace("_", "-")
    conversations.mkdir(parents=True)
    (conversations / "one.jsonl").write_text("{}")

    env = {"PATH": os.environ["PATH"], "HOME": str(home), "SSH_ORIGINAL_COMMAND": "facts"}
    out = subprocess.run(["sh", "-c", logic.STATUS_COMMAND], capture_output=True, text=True, env=env,
                         cwd=tmp_path, timeout=30).stdout
    projects = {p["path"]: p for p in logic.parse_facts(out)["projects"]}

    assert set(projects) == {"projects/site", "empty"}  # "with space" is skipped
    assert projects["projects/site"]["subject"] == "Add  * | $(touch pwned)"
    assert projects["projects/site"]["ahead"] == 1
    assert projects["projects/site"]["branch"] == "main" and projects["projects/site"]["dirty"] is True
    assert projects["projects/site"]["committed"] > 0 and projects["projects/site"]["claude"] > 0
    assert projects["empty"] == {"path": "empty", "folder": "", "name": "empty", "branch": "trunk", "dirty": False,
                                 "claude": 0, "ahead": None, "committed": 0, "subject": ""}
    assert not (tmp_path / "pwned").exists()


def test_the_overview_says_whether_loskai_s_sudo_rule_is_there():
    assert logic.parse_facts(FACTS)["sudo_rule"] == "on"
    assert logic.parse_facts(FACTS.replace("#=sudo\non\n", "#=sudo\noff\n"))["sudo_rule"] == "off"
    # Its folder not searchable by the user: the machine doesn't say.
    assert logic.parse_facts(FACTS.replace("#=sudo\non\n", "#=sudo\n"))["sudo_rule"] is None


def test_taking_off_loskai_s_things_starts_with_the_sudo_rule():
    # While Loskai's key still gets in: the rule allows its own removal, so no password.
    script = logic.UNINSTALL_SCRIPT
    assert script.index("sudo -n rm -f /etc/sudoers.d/loskai") < script.index("authorized_keys")
    assert "echo '!sudo-rule'" in script
