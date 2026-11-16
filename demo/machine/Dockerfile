# A machine on the demo's LAN (scripts/record-demo.sh): Debian with systemd, so it runs
# services as a real one does — a file share (Samba) and a web page (nginx) beside sshd —
# the programs Loskai's overview and tools look for, a user who may use sudo, and two git
# projects. The password is set when the container starts, from MACHINE_PASSWORD, so none
# is baked into the image.
FROM debian:stable-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      systemd systemd-sysv dbus openssh-server sudo tmux git curl ca-certificates procps iproute2 samba nginx-light \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -s /bin/bash -G sudo homelab \
 && echo 'homelab ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/homelab && chmod 440 /etc/sudoers.d/homelab \
 && systemctl enable ssh smbd nmbd nginx >/dev/null 2>&1 \
 # What a container has no use for, and systemd would wait on or fail at.
 && systemctl mask systemd-logind getty.target console-getty systemd-udevd systemd-resolved \
      systemd-timesyncd systemd-networkd systemd-modules-load apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1
# A stand-in for Claude Code: the real one needs an account, whose name would be in a public
# image. It keeps its tmux session open, which is all Loskai's card looks at; its screen is
# never recorded.
COPY claude /usr/local/bin/claude
COPY start.sh /start.sh
RUN chmod +x /usr/local/bin/claude \
 && su homelab -c 'for p in homelab backup-scripts; do mkdir -p ~/projects/$p && cd ~/projects/$p && git init -q -b main \
      && echo "# $p" > README.md && git add README.md \
      && git -c user.name=homelab -c user.email=homelab@nas.home.lan commit -q -m "Start $p"; done'
STOPSIGNAL SIGRTMIN+3
CMD ["sh", "/start.sh"]
