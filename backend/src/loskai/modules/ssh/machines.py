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


def rename_refusal(prev: Instance | None, alias: str) -> str | None:
    """Before a save: why renaming `prev` to `alias` can't carry to the config — `alias`
    already has an entry of its own (None: it can). Which of the two to keep is the user's
    call, so neither is merged nor removed."""
    old = prev.subdomain if prev else None
    if not old or old == alias:
        return None
    try:
        text = client.read_config()
    except OSError:
        return None
    if logic.rename_collides(text, old, alias):
        return f"'{alias}' already has an entry in the SSH config — remove it or pick another name"
    return None


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


def prepare_removal(inst: Instance):
    """Before anything of a machine's delete — or its SSH connection's removal — happens:
    where Loskai's lines are, to take them off once nothing else can stop it (None: there
    are none). SshError 423 while the key is locked — the page asks for your password,
    nothing changed."""
    return connect.removal(inst.id)


def prepare_user_change(prev: Instance, ssh) -> tuple[object | None, str | None]:
    """Before a machine's SSH user changes: where Loskai's lines are under the old user — its
    key, and the sudo rule written for that user, which the new one may not see (where
    /etc/sudoers.d is 0750) — to take off once the save has gone through, as removing the
    connection does. `(None, None)` when the user stays. A locked key doesn't stop the
    change: `(None, warning)`, saying what stayed."""
    if ssh is KEEP or ssh is None:
        return None, None
    try:
        old = connect.target(prev.id).user
    except connect.SshError:
        return None, None  # no SSH user before: nothing of Loskai's under one
    if old == ssh.user:
        return None, None
    try:
        return connect.removal(prev.id), None
    except connect.SshError:
        return None, (
            f"Loskai's key was locked, so what it put on the machine for {old} stayed — "
            f"remove its loskai lines from {old}'s ~/.ssh/authorized_keys, and as root: rm -f {logic.SUDO_RULE}"
        )


async def remove_keys(inst: Instance, removal) -> str | None:
    """Take what Loskai put on a machine — its sudo rule, its lines — off it, when the machine
    or its SSH connection goes. Best-effort: a machine that can't be reached goes anyway,
    and the warning says what is still there."""
    if removal is None:
        return None
    try:
        sudo_left = await connect.uninstall(*removal)
    except connect.SshError as exc:
        connect.log("uninstall", inst.id, None, ok=False, error=exc.detail)
        return (
            f"Loskai's key and any sudo rule it added are still on the machine ({exc.detail}) — "
            f"remove its loskai lines from ~/.ssh/authorized_keys by hand, and as root: rm -f {logic.SUDO_RULE}"
        )
    connect.log("uninstall", inst.id, None, ok=True, **({"sudo_rule_left": True} if sudo_left else {}))
    if sudo_left:
        return f"Loskai's key is off, but its sudo rule stayed — as root: rm -f {logic.SUDO_RULE}"
    return None


def forget_trust(inst: Instance) -> None:
    """A machine whose SSH connection was removed: its trusted host key goes too, so adding
    one back trusts the machine afresh. Best-effort."""
    try:
        connect.forget(inst.id)
    except OSError as exc:
        logger.warning("Host key of machine '%s' not forgotten: %s", inst.id, exc)


def forget_machine(inst: Instance) -> None:
    """A deleted machine's entry and trusted host key go with it. Best-effort: the delete
    has happened."""
    try:
        connect.forget(inst.id)
        if inst.subdomain:
            client.update_config(lambda text: logic.remove_host(text, inst.subdomain))
    except OSError as exc:
        logger.warning("SSH entry for deleted machine '%s' not removed: %s", inst.id, exc)
