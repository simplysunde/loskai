"""Keeping the SSH config in step with the machines.

A machine's entry is the `Host` named after its hostname, with its address as `HostName`.
The config is the record of the SSH details (user, port); a machine's own form edits them,
and renaming, moving or deleting the machine carries over to its entry. An entry that names
no machine is never touched.
"""

import logging

from ...shared.instances import Instance
from . import client, connect, logic

logger = logging.getLogger(__name__)

# The save said nothing about SSH: keep the entry's details, only follow a rename or a move.
KEEP = object()


def follow_machine(prev: Instance | None, inst: Instance, ssh) -> str | None:
    """Carry a machine save to the config. `ssh` is KEEP, None (remove the entry), or an
    object with `user` and `port`. Returns a warning when the file couldn't be written —
    the machine itself is saved either way, like a DNS rewrite that fails."""
    old, alias = (prev.subdomain if prev else None), inst.subdomain
    if not alias or not inst.upstream:
        return None

    def mutate(text: str) -> str:
        if old and old != alias:
            text = logic.rename_host(text, old, alias)
        if ssh is KEEP:
            if alias in logic.hosts(text):
                text = logic.set_host(text, alias, {"HostName": inst.upstream})
        elif ssh is None:
            text = logic.remove_host(text, alias)
        else:
            text = logic.set_host(text, alias, logic.machine_options(inst.upstream, ssh.user, ssh.port))
        return text

    try:
        client.update_config(mutate)
    except OSError as exc:
        logger.warning("SSH config not updated for machine '%s': %s", inst.id, exc)
        return f"The SSH config wasn't updated: {exc}."
    return None


def forget_machine(inst: Instance) -> None:
    """A deleted machine's entry and trusted host key go with it. Best-effort: the delete
    has happened."""
    try:
        connect.forget(inst.id)
        if inst.subdomain:
            client.update_config(lambda text: logic.remove_host(text, inst.subdomain))
    except OSError as exc:
        logger.warning("SSH entry for deleted machine '%s' not removed: %s", inst.id, exc)
