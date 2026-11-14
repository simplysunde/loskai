"""The status key's contract: the forced command, run for real by sh where it can be, and the
parsers of what it answers."""

import os
import shutil
import subprocess

import pytest

from loskai.modules.ssh import status


# --- The status key ---


def test_the_status_line_is_restricted_to_its_command_and_the_docker_host():
    line = status.status_line("ssh-ed25519 AAAA loskai-status", "192.168.10.216")

    options, _, key = line.partition(" ssh-ed25519")
    assert options.startswith('restrict,from="192.168.10.216",command="')
    assert key == " AAAA loskai-status"
    # The forced command sits inside command="…", which a double quote would end early.
    assert '"' not in status.STATUS_COMMAND and "\\" not in status.STATUS_COMMAND


def test_without_the_docker_host_the_status_line_is_still_restricted():
    assert status.status_line("ssh-ed25519 AAAA loskai-status", None).startswith('restrict,command="')


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
    out = status.parse_running(OUTPUT)

    assert [c["name"] for c in out["containers"]] == ["bambuddy", "jellyfin"]
    assert out["containers"][1] == {
        "name": "jellyfin", "image": "jellyfin/jellyfin:12.2", "status": "Up 2 days (healthy)", "ports": [],
    }
    # The base system's services are counted, not listed: cron, getty, ssh, journald. Proxmox's
    # web UI is listed, though base: it is worth a route, and only what is listed offers one.
    assert out["services"] == ["docker", "nginx", "pveproxy"]
    assert out["hidden"] == 4
    assert out["guests"] == [
        {"id": "101", "name": "adguard", "kind": "lxc", "addresses": []},
        {"id": "200", "name": "haos", "kind": "vm", "addresses": []},
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
    out = status.parse_running(LISTEN_OUTPUT)

    assert {c["name"]: c["ports"] for c in out["containers"]} == {"jellyfin": [8096], "postgres": []}


def test_a_service_s_ports_are_those_off_loopback_with_a_unit_not_the_base_system_s():
    out = status.parse_running(LISTEN_OUTPUT)

    # Left out: Docker's proxy (jellyfin lists 8096), a process with no unit, loopback (DNS,
    # redis), ssh — base. Proxmox's web UI stays, though base.
    assert out["listening"] == [
        {"service": "nginx", "port": 80, "host": ""},
        {"service": "nginx", "port": 8443, "host": "192.168.10.5"},
        {"service": "pveproxy", "port": 8006, "host": ""},
    ]
    assert out["denied"] == []


def test_a_user_who_sees_only_its_own_sockets_says_so():
    out = status.parse_running("#loskai-status 6\n#systemd\n#listen\n!partial\nLISTEN 0 1 0.0.0.0:80 0.0.0.0:*\n")

    assert out["denied"] == ["listen"] and out["listening"] == []


def test_a_machine_without_ss_says_so_instead_of_listing_nothing():
    # v6 prints `#listen` only where `ss` exists; an empty list must not read as "nothing listens".
    out = status.parse_running("#loskai-status 6\n#docker\n#systemd\n")

    assert out["denied"] == ["ss"] and out["listening"] == []


@pytest.mark.parametrize("host,loopback", [
    ("127.0.0.1", True), ("127.0.0.53%lo", True), ("[::1]", True), ("*%lo", True),
    ("[::ffff:127.0.0.1]", True),  # an IPv4 loopback, as a dual-stack socket shows it
    ("0.0.0.0", False), ("[::]", False), ("*", False), ("", False), ("192.168.10.5", False),
    ("[fe80::1]%eth0", False), ("0.0.0.0%eth0", False), ("127.example", False),
])
def test_loopback_is_the_address_parsed_not_its_text(host, loopback):
    assert status._loopback(host) is loopback


def test_a_listener_bound_to_an_interface_is_on_its_addresses():
    out = status.parse_running(
        "#loskai-status 6\n#listen\n"
        "LISTEN 0 511 0.0.0.0%eth0:80 0.0.0.0:* users:((nginx,pid=10,fd=6))\n@10 nginx.service\n"
        "LISTEN 0 511 [fe80::1]%eth0:8443 [::]:* users:((nginx,pid=10,fd=7))\n@10 nginx.service\n"
    )

    assert out["listening"] == [
        {"service": "nginx", "port": 80, "host": ""},
        {"service": "nginx", "port": 8443, "host": "fe80::1"},
    ]


def test_a_published_range_is_each_of_its_ports_unless_it_is_wide():
    out = status.parse_running(
        "#loskai-status 6\n#docker\n"
        "web|nginx|Up|0.0.0.0:8000-8002->8000-8002/tcp\n"
        "media|jellyfin|Up|0.0.0.0:10000-11000->10000-11000/tcp\n#listen\n"
    )

    assert {c["name"]: c["ports"] for c in out["containers"]} == {
        "web": [8000, 8001, 8002], "media": [10000],
    }


def test_each_guest_has_its_addresses_from_v7_those_it_may_be_named_by():
    out = status.parse_running(
        "#loskai-status 7\n#listen\n#pct\n"
        "VMID       Status     Lock         Name\n"
        "100        running                 wireguard\n"
        "#qm\n"
        "      VMID NAME                 STATUS     MEM(MB)    BOOTDISK(GB) PID\n"
        "       101 NAS                  running    4096              32.00 1234\n"
        "       303 noagent              running    2048              32.00 3456\n"
        # As the command prints them: an LXC's Docker bridge and IPv6 too, a VM's loopback;
        # a VM without the guest agent, nothing.
        "#addr\n100 192.168.10.110 172.17.0.1 fe80::1\n303\n101 127.0.0.1 192.168.10.101\n"
    )

    assert {g["id"]: g["addresses"] for g in out["guests"]} == {
        "100": ["192.168.10.110", "172.17.0.1"], "101": ["192.168.10.101"], "303": [],
    }
    # v7 has v6's ports.
    assert out["listening"] == [] and "ss" not in out["denied"]


def test_a_list_the_user_may_not_read_says_so():
    out = status.parse_running("#loskai-status 1\n#docker\n!denied\n#systemd\n")

    assert out["denied"] == ["docker"] and out["containers"] == []


def test_output_that_is_not_the_status_command_s_is_refused():
    with pytest.raises(ValueError):
        status.parse_running("Welcome to Ubuntu\n$ ")


def test_the_running_list_reads_the_older_status_line_too():
    # A machine not yet reinstalled keeps its running list; only the overview needs v2.
    assert status.parse_running(OUTPUT.replace("status 1", "status 2"))["services"] == ["docker", "nginx", "pveproxy"]


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
    out = status.parse_facts(FACTS)

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
         "claude": 1793212000, "ahead": 2, "committed": 1793211000, "subject": "Tools: tmux | and Tailscale",
         "key": None},
        {"path": "loskai", "folder": "", "name": "loskai", "branch": None, "dirty": False,
         "claude": 0, "ahead": None, "committed": 0, "subject": "", "key": None},
    ]
    # A line before v11 can't say which keys there are.
    assert out["ssh_keys"] is None


def test_an_overview_from_an_older_line_is_read_and_says_so():
    """Read as before — but a fix since (v10: no logged sudo refusal) needs it installed again."""
    older = status.parse_facts(FACTS)
    assert older["os"] and older["outdated"] is True
    assert status.parse_facts(FACTS.replace(FACTS.splitlines()[0], status.STATUS_VERSION, 1))["outdated"] is False


def test_an_older_status_line_has_no_overview():
    with pytest.raises(status.OldStatusLine):
        status.parse_facts(OUTPUT)
    with pytest.raises(status.OldStatusLine):
        status.parse_facts(FACTS.replace("status 5", "status 4"))
    with pytest.raises(ValueError):
        status.parse_facts("Welcome to Ubuntu\n$ ")


@pytest.mark.parametrize("head, version", [
    ("#loskai-status 1", 1),
    (status.STATUS_VERSION, status.STATUS_LINE),
    (f"#loskai-status {status.STATUS_LINE + 1}", None),  # newer than this Loskai: not read
    ("#loskai-status 05", None),
    ("#loskai-status", None),
    ("Welcome to Ubuntu", None),
])
def test_a_status_line_s_version_is_its_number(head, version):
    assert status.line_version(head) == version


def test_every_line_since_v5_gives_an_overview_and_every_one_since_v6_its_ports():
    # Nothing to bump when a version is added: each later line is read like the one before.
    for n in range(status.FACTS_SINCE, status.STATUS_LINE + 1):
        assert status.parse_facts(FACTS.replace("status 5", f"status {n}", 1))["os"]
        listening = status.parse_running(f"#loskai-status {n}\n#listen\n")["listening"]
        assert (listening is not None) == (n >= status.LISTEN_SINCE)


def test_a_proxmox_host_s_guests_are_listed_once_and_their_addresses_read(tmp_path):
    # Proxmox's commands, faked: two running guests of each kind, one VM without the agent.
    # Each fake notes its call, so the test sees `qm list` — slow on a real host — run once.
    calls = tmp_path / "calls"
    fakes = {
        "pct": f"echo pct $1 >> {calls}\ncat <<'T'\nVMID       Status     Lock         Name\n100        running                 wg\n"
        "105        stopped                 old\nT",
        "lxc-info": "[ $2 = 100 ] && printf '192.168.10.110\\n172.17.0.1\\n'",
        "qm": f"echo qm $1 >> {calls}\n"
        "if [ $1 = list ]; then cat <<'T'\n      VMID NAME     STATUS     MEM(MB)\n"
        "       101 NAS      running    4096\n       303 bare     running    2048\nT\nexit; fi\n"
        "[ $3 = 101 ] || exit 2\n"
        "echo '[ { \"ip-addresses\" : [ { \"ip-address\" : \"127.0.0.1\" } ] },'\n"
        "echo '  { \"ip-addresses\" : [ { \"ip-address\" : \"192.168.10.101\" } ] } ]'",
    }
    for name, body in fakes.items():
        (tmp_path / name).write_text(f"#!/bin/sh\n{body}\n")
        (tmp_path / name).chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"}
    out = subprocess.run(
        ["sh", "-c", status._PVE_LOOP, "sh", "#pct", "#qm", "#addr", "!denied"],
        capture_output=True, text=True, env=env, timeout=30,
    ).stdout
    running = status.parse_running("#loskai-status 8\n" + out)

    assert running["guests"] == [
        {"id": "100", "name": "wg", "kind": "lxc", "addresses": ["192.168.10.110", "172.17.0.1"]},
        {"id": "101", "name": "NAS", "kind": "vm", "addresses": ["192.168.10.101"]},
        {"id": "303", "name": "bare", "kind": "vm", "addresses": []},
    ]
    listed = [c for c in calls.read_text().split("\n") if c.endswith(" list")]
    assert sorted(listed) == ["pct list", "qm list"]


def test_a_failing_proxmox_list_is_denied_not_empty(tmp_path):
    for name in ("pct", "qm"):
        (tmp_path / name).write_text("#!/bin/sh\nexit 1\n")
        (tmp_path / name).chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"}
    out = subprocess.run(
        ["sh", "-c", status._PVE_LOOP, "sh", "#pct", "#qm", "#addr", "!denied"],
        capture_output=True, text=True, env=env, timeout=30,
    ).stdout

    assert status.parse_running("#loskai-status 8\n#listen\n" + out)["denied"] == ["pct", "qm"]


def _sudo_lists(rules: str | None) -> str:
    """A fake sudo: `-n -l` prints `rules` as sudo lists them, or is refused (None); a
    command is allowed by `-n -l <command>`, as with any rule for ALL."""
    listing = f"User loskai may run the following commands on box:\n{rules}" if rules is not None else ""
    return (f"case \"$*\" in \"-n -l\") [ -n '{listing}' ] || exit 1; printf '%s\\n' '{listing}'; exit 0;; "
            "\"-n -l \"*) exit 0;; esac\nexit 0")


# The rules sudo lists for each kind of user, as `sudo -n -l` prints them.
PASSWORD_ALL = "    (ALL : ALL) ALL"
LOSKAI_RULE = "    (root) NOPASSWD: /usr/bin/apt-get update, /usr/bin/apt-get -y dist-upgrade"
FREE_ALL = "    (ALL) NOPASSWD: ALL"


@pytest.mark.skipif(os.geteuid() == 0, reason="as root, sudo is never asked")
@pytest.mark.parametrize("rules", [
    None,  # no passwordless rule: `-n -l` itself is refused, quietly
    PASSWORD_ALL + "\n" + LOSKAI_RULE,  # %sudo with a password, and Loskai's rule for updates
    FREE_ALL + "\n" + PASSWORD_ALL,  # sudo goes by the last rule: that one wants a password
    "    (www-data) NOPASSWD: ALL",  # passwordless, but not as root
])
def test_sudo_runs_nothing_it_would_refuse(tmp_path, rules):
    """`sudo -n true` is logged as an incident for a user sudo refuses — every poll, and it
    may mail root. `sudo -n -l` answers without logging, but as soon as any one rule needs no
    password: with Loskai's own rule for updates, every command it was asked about was
    "allowed" while running it wanted the password — refused, and logged. So sudo is used
    only where the last rule for ALL, as root, needs none. Docker, Proxmox and ss are faked
    so that every list would fall back to sudo."""
    calls = tmp_path / "calls"
    fakes = {
        "sudo": f'echo "$*" >> {calls}\n{_sudo_lists(rules)}',
        "docker": "exit 1", "pct": "exit 1", "qm": "exit 1", "ss": "exit 0",
    }
    for name, body in fakes.items():
        (tmp_path / name).write_text(f"#!/bin/sh\n{body}\n")
        (tmp_path / name).chmod(0o755)
    env = {"PATH": f"{tmp_path}:{os.environ['PATH']}", "HOME": str(tmp_path)}
    out = subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30).stdout

    asked = calls.read_text().split("\n")[:-1]
    assert asked == ["-n -l"]  # asked once, quietly; nothing run
    assert set(status.parse_running(out)["denied"]) >= {"docker", "pct", "qm"}
    assert "listen" in status.parse_running(out)["denied"]  # read as the user, and said so


@pytest.mark.skipif(os.geteuid() == 0, reason="as root, sudo is never asked")
@pytest.mark.parametrize("rules", [FREE_ALL, PASSWORD_ALL + "\n" + LOSKAI_RULE + "\n" + FREE_ALL])
def test_a_user_sudo_allows_still_gets_the_root_lists(tmp_path, rules):
    calls = tmp_path / "calls"
    (tmp_path / "sudo").write_text(f'#!/bin/sh\necho "$*" >> {calls}\n{_sudo_lists(rules)}\n')
    for name, body in {"sudo": None, "pct": "exit 1", "ss": "exit 0"}.items():
        if body:
            (tmp_path / name).write_text(f"#!/bin/sh\n{body}\n")
        (tmp_path / name).chmod(0o755)
    env = {"PATH": f"{tmp_path}:{os.environ['PATH']}", "HOME": str(tmp_path)}
    subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30)

    ran = [a for a in calls.read_text().split("\n") if a and not a.startswith("-n -l")]
    # The listeners and Proxmox's lists, each a whole script as root.
    assert [a.split(" ", 3)[:3] for a in ran] == [["-n", "sh", "-c"], ["-n", "sh", "-c"]]


def test_the_networks_a_machine_shares_with_its_tailnet_and_which_are_approved(tmp_path):
    # Tailscale, faked as it answers without root: two networks shared, one approved. The
    # AllowedIPs before PrimaryRoutes hold an address too, and must not be read as a route.
    answer = (
        '{\n  "BackendState": "Running",\n  "Self": {\n    "AllowedIPs": [\n      "100.64.0.1/32"\n    ],\n'
        '    "PrimaryRoutes": [\n      "192.168.10.0/24"\n    ],\n    "Online": true\n  }\n}'
    )
    (tmp_path / "tailscale").write_text(
        "#!/bin/sh\ncase $1 in\n"
        "  get) echo 192.168.10.0/24,10.0.0.0/24 ;;\n"
        f"  status) [ $2 = --json ] && printf '%s\\n' '{answer}' ;;\n"
        "  ip) echo 100.64.0.1 ;;\nesac\n"
    )
    (tmp_path / "tailscale").chmod(0o755)
    env = {"PATH": f"{tmp_path}:{os.environ['PATH']}", "HOME": str(tmp_path), "SSH_ORIGINAL_COMMAND": "facts"}
    out = subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30).stdout

    assert status.parse_facts(out)["tailscale_self"] == {
        "state": "on", "shared": ["192.168.10.0/24", "10.0.0.0/24"], "approved": ["192.168.10.0/24"],
    }


@pytest.mark.parametrize("backend,state", [
    ("Running", "on"), ("Stopped", "off"), ("NeedsLogin", "login"), ("NeedsMachineAuth", "approval"),
    ("Starting", None), ("", None),
])
def test_the_tailscale_state_and_shared_networks_leave_out_an_exit_node_and_need_v9(backend, state):
    v9 = FACTS.replace("status 5", "status 9").replace(
        "#=sudo", f"#=tsself\nstate {backend}\nshared 192.168.10.0/24 0.0.0.0/0 ::/0\napproved\n#=sudo"
    )
    assert status.parse_facts(v9)["tailscale_self"] == {"state": state, "shared": ["192.168.10.0/24"], "approved": []}


def test_an_older_line_or_no_tailscale_has_no_tailscale_self():
    # No section: not known, rather than "off" or "nothing shared".
    assert status.parse_facts(FACTS)["tailscale_self"] is None
    assert status.parse_facts(FACTS.replace("status 5", "status 8"))["tailscale_self"] is None


@pytest.mark.parametrize("request_", ["facts", "running", None])
def test_the_forced_command_runs_in_sh_and_answers_each_request(request_):
    # The real command, on this machine: whatever is installed, it must parse.
    assert '"' not in status.STATUS_COMMAND and "\\" not in status.STATUS_COMMAND
    env = {k: v for k, v in os.environ.items() if k != "SSH_ORIGINAL_COMMAND"}
    if request_:
        env["SSH_ORIGINAL_COMMAND"] = request_
    out = subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env, timeout=30).stdout

    if request_ == "facts":
        facts = status.parse_facts(out)
        assert facts["kernel"] and facts["uptime"] and facts["memory"]["total"] > 0
        assert set(facts["programs"]) <= set(status.PROGRAMS)
    else:
        running = status.parse_running(out)
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
    out = subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True, env=env,
                         cwd=tmp_path, timeout=30).stdout
    projects = {p["path"]: p for p in status.parse_facts(out)["projects"]}

    assert set(projects) == {"projects/site", "empty"}  # "with space" is skipped
    assert projects["projects/site"]["subject"] == "Add  * | $(touch pwned)"
    assert projects["projects/site"]["ahead"] == 1
    assert projects["projects/site"]["branch"] == "main" and projects["projects/site"]["dirty"] is True
    assert projects["projects/site"]["committed"] > 0 and projects["projects/site"]["claude"] > 0
    assert projects["empty"] == {"path": "empty", "folder": "", "name": "empty", "branch": "trunk", "dirty": False,
                                 "claude": 0, "ahead": None, "committed": 0, "subject": "", "key": None}
    assert not (tmp_path / "pwned").exists()


@pytest.mark.skipif(not shutil.which("ssh-keygen"), reason="needs ssh-keygen")
def test_the_overview_lists_the_users_keys_and_which_one_each_project_uses(tmp_path):
    home = tmp_path / "home"
    (home / ".ssh").mkdir(parents=True)
    for name in ("site", "blog", "odd"):
        subprocess.run(["git", "init", "-q", str(home / "projects" / name)], check=True)
    for key, comment in (("id_ed25519", "vm@box"), ("deploy_site", "vm@box site")):
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", str(home / ".ssh" / key)], check=True)
    (home / ".ssh" / "with space.pub").write_text((home / ".ssh" / "id_ed25519.pub").read_text())

    def git_config(project, value):
        subprocess.run(["git", "-C", str(home / "projects" / project), "config", "core.sshCommand", value], check=True)

    git_config("site", f"ssh -i '{home}/.ssh/deploy_site' -o IdentitiesOnly=yes")  # as Own key sets it
    git_config("odd", "ssh -o ProxyJump=x")  # a command of its own, naming no key

    env = {"PATH": os.environ["PATH"], "HOME": str(home), "SSH_ORIGINAL_COMMAND": "facts"}
    out = status.parse_facts(subprocess.run(["sh", "-c", status.STATUS_COMMAND], capture_output=True, text=True,
                                            env=env, cwd=tmp_path, timeout=30).stdout)

    assert {p["name"]: p["key"] for p in out["projects"]} == {"site": "deploy_site", "blog": None, "odd": ""}
    keys = {k["name"]: k for k in out["ssh_keys"]}
    assert set(keys) == {"id_ed25519", "deploy_site"}  # "with space" is skipped
    assert keys["deploy_site"]["comment"] == "vm@box site" and keys["deploy_site"]["type"] == "ED25519"
    assert keys["id_ed25519"]["fingerprint"].startswith("SHA256:") and keys["id_ed25519"]["bits"] == 256
    # Only the public halves are read: nothing private in what is served.
    assert "PRIVATE" not in str(out)


def test_the_overview_says_whether_loskai_s_sudo_rule_is_there():
    assert status.parse_facts(FACTS)["sudo_rule"] == "on"
    assert status.parse_facts(FACTS.replace("#=sudo\non\n", "#=sudo\noff\n"))["sudo_rule"] == "off"
    # Its folder not searchable by the user: the machine doesn't say.
    assert status.parse_facts(FACTS.replace("#=sudo\non\n", "#=sudo\n"))["sudo_rule"] is None
