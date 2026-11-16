# Docker mounts /etc/hosts, /etc/hostname and /etc/resolv.conf from the host's disk, and the
# overview lists a disk by its first mount — which made a NAS's disk "/etc/hosts". Their
# contents are kept and the mounts dropped (it runs privileged, as systemd needs too), so the
# storage volume at /srv/storage is what it shows, as a real NAS would.
for f in /etc/hosts /etc/hostname /etc/resolv.conf; do
  cp "$f" "/tmp/${f##*/}" && umount "$f" && cp "/tmp/${f##*/}" "$f"
done
echo "homelab:$MACHINE_PASSWORD" | chpasswd
# systemd, as PID 1: the machine's services are real units, which is what Loskai lists.
exec /sbin/init
