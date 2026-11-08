# A machine on the demo's LAN (scripts/record-demo.sh): Debian with sshd, the programs
# Loskai's overview and tools look for, and a user in the sudo group. The password is set
# when the container starts, from MACHINE_PASSWORD, so none is baked into the image.
FROM debian:stable-slim
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends openssh-server sudo tmux git curl ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -s /bin/bash -G sudo homelab \
 && mkdir -p /run/sshd
COPY start.sh /start.sh
CMD ["sh", "/start.sh"]
