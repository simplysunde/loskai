#!/bin/sh
#
# container-entrypoint.sh — Loskai's container starts here, as root, and runs the app as
# whoever owns ./data.
#
# Everything Loskai writes on the host (its state in ./data, a stack's compose.yml and .env)
# should belong to the person who cloned the repo, so it can be read and edited over SSH
# without sudo. Root is needed only for the moment it takes to look that owner up, hand back
# what an older, root-run Loskai left behind, and drop to it. The docker socket's group is
# added because the socket lets in only root and that group, whose number differs per host.
#
# Nothing to set: the owner of ./data decides. A ./data owned by root, or a container
# started with `user:`, runs as it always did.

set -eu

data="${LOSKAI_DATA_DIR:-/data}"
socket=/var/run/docker.sock

if [ "$(id -u)" != 0 ] || [ ! -d "$data" ] || [ "$(stat -c %u "$data")" = 0 ]; then
	exec "$@"
fi
uid=$(stat -c %u "$data")
gid=$(stat -c %g "$data")

# Hand back what a root-run Loskai wrote. In ./data that is everything. In a stack it is the
# folder and the files Loskai writes, nothing deeper: the rest is the app's own data, owned
# by whatever user the app runs as.
find "$data" -user 0 -exec chown "$uid:$gid" {} +
[ -f "$data/session_secret" ] && chmod 600 "$data/session_secret"
if [ -d "${STACKS_DIR:-}" ]; then
	find "$STACKS_DIR" -mindepth 1 -maxdepth 1 -type d -user 0 -exec chown "$uid:$gid" {} +
	find "$STACKS_DIR" -mindepth 2 -maxdepth 2 -type f -user 0 \
		\( -name '*compose*.y*ml' -o -name .env \) -exec chown "$uid:$gid" {} +
	find "$STACKS_DIR" -mindepth 2 -maxdepth 2 -type f -name .env -user "$uid" -exec chmod 600 {} +
fi

groups=$gid
[ -S "$socket" ] && groups="$groups,$(stat -c %g "$socket")"

# Root's home is closed to that user, and git and the docker CLI both look there. The uid
# has no entry in the image's /etc/passwd, so name it too: asyncssh asks for the local user
# name and, without one, refuses every SSH connection.
export HOME=/tmp USER=loskai LOGNAME=loskai
exec setpriv --reuid="$uid" --regid="$gid" --groups="$groups" "$@"
