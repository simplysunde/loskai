[Docs](../README.md) › [Guides](../README.md#guides)

# Trusting a backend's own certificate (Proxmox and friends)

**Read this when** you open a service on its own port, like Proxmox on `:8006` or a NAS's
page, and want no warning there either.

Some services serve HTTPS themselves, with a certificate of their own: Proxmox, a NAS's admin
page, a server's management board. The usual way is a route with **Backend speaks HTTPS**
ticked: Caddy reaches the service and your browser trusts Caddy. Nothing here replaces that.

This page is for opening such a service **directly**, at `https://proxmox.home.lan:8006`,
without a warning. The service gets a certificate from Caddy's own certificate authority,
which your devices already trust: Caddy hands them out like Let's Encrypt does, through ACME.

[Trusting the certificate](certificate-setup.md) comes first: it makes your *devices* trust
Caddy. This page makes a *service* hold a certificate they trust.

## Is it worth it?

| | A route (the usual way) | Its own certificate (this page) |
|---|---|---|
| To set up | one route in Loskai | the steps below, on Caddy and on the service |
| Works for | anything | services with an ACME client, like Proxmox or a Linux machine with `certbot` |
| Opened on its own port | warns | trusted |

Do it for the few services you open on their own port. And give such a service two names,
since one name can't do both.

## One name can't be both

A name answers one address. A route's name answers **Caddy's** address, so a certificate
for that name can't be checked at the service. Use two names:

| Name | What it is in Loskai | For |
|---|---|---|
| `proxmox.home.lan` | a **machine**, at `192.168.10.177` | opening it directly, `https://proxmox.home.lan:8006`, with its own certificate |
| `pve.home.lan` | a **route** to `192.168.10.177:8006`, **Backend speaks HTTPS** ticked | its card on the Dashboard, through Caddy |

Name the machine on the **Machines** tab with **Name a machine**. Add the route from its row
(**Add a route on this machine**): type `8006` as the **Port**, or pick `pveproxy` from the
**Machines** list when the machine has SSH set up. Both move together if the machine's
address changes.

## 1. Give Caddy's address a name

Your services will ask Caddy for certificates by a name, and that name needs a DNS entry
Loskai keeps. On the **Machines** tab, name Caddy's address: the Caddy LXC's, or the Docker
host's when Caddy runs beside Loskai. If it has a name already, like the Docker host's, use
that one. The examples use `caddy.home.lan`.

An entry added by hand in AdGuard for Caddy's address wouldn't last: **Sync** removes it.

## 2. Turn Caddy into an ACME server

1. **Edit Caddy's Caddyfile.**
   - **Caddy LXC:** `/etc/caddy/Caddyfile`, in the LXC.
   - **Caddy beside Loskai:** its Caddyfile is inside Caddy's image, so copy it out and mount
     your copy. In Loskai's folder:

     ```bash
     docker compose cp caddy:/etc/caddy/Caddyfile ./Caddyfile
     ```

     and in `compose.override.yml`:

     ```yaml
     services:
       caddy:
         volumes:
           - ./Caddyfile:/etc/caddy/Caddyfile:ro
     ```

2. **Add two things.** Inside the block at the top, the one with `local_certs`, add the
   `pki` lines. At the end, add a site for the name from step 1:

   ```caddyfile
   {
   	admin 0.0.0.0:2019
   	local_certs
   	pki {
   		ca local {
   			intermediate_lifetime 30d
   		}
   	}
   }

   # … the rest of the file as it is …

   caddy.home.lan {
   	acme_server {
   		ca local
   		lifetime 168h
   	}
   }
   ```

   `lifetime 168h` makes each certificate last a week. Caddy's default is 12 hours, and
   Proxmox renews only once a day, so the certificate would lapse every day. A longer
   `lifetime` needs a longer `intermediate_lifetime`: with the leaf outliving it, Caddy
   refuses with a `500`.
3. **Make Caddy read it.** Caddy starts from its saved config, not the Caddyfile, so remove
   the save and restart it ([Caddy's saved config](deployment.md#caddys-saved-config)). With
   Caddy beside Loskai, `docker compose up -d caddy` first, to mount the file.
4. **Click Sync** on **Routing**: it puts Loskai's routes back. The ACME site stays.
5. **Check it.** With the certificate from Loskai's **Certificate** page saved as
   `caddy-root.crt`:

   ```bash
   curl --cacert caddy-root.crt https://caddy.home.lan/acme/local/directory
   ```

   It answers with a short JSON list of addresses, `newOrder` among them. That address,
   `https://caddy.home.lan/acme/local/directory`, is what your services ask.

Caddy then hands a certificate to any machine on your network that asks. To limit that, its
`acme_server` takes `allow` and `deny` blocks, by `domains` and `ip_ranges`: worth it on a
network with guests.

## 3. Prepare the service's machine

1. **Trust Caddy's root certificate**, so the machine can talk to Caddy over HTTPS. On a
   Debian-based machine, like Proxmox:

   ```bash
   curl -fsSL http://<caddy-ip>/caddy-root.crt -o /usr/local/share/ca-certificates/caddy-root.crt
   update-ca-certificates
   ```

2. **Ask AdGuard for names**, so it finds `caddy.home.lan`. Proxmox often asks another DNS
   server: check `/etc/resolv.conf`, or **Node** › **System** › **DNS** in Proxmox, and set
   AdGuard's address there.

Caddy's own machine has to ask AdGuard too: Caddy checks the service at its name before it
hands the certificate out. If your devices get AdGuard from your router, it does already.

## 4. Ask Caddy for the certificate

### Proxmox

In the Proxmox shell, as Proxmox's documentation describes. In the web UI the same is
**Datacenter** › **ACME** for the account, then **Node** › **System** › **Certificates** for
the name.

```bash
# 1. An account at your own ACME server. Choose "Custom" when asked,
#    and give the address from step 2.5.
pvenode acme account register loskai you@example.com

# 2. The name the node should hold a certificate for: its machine name from Loskai.
pvenode config set --acme domains=proxmox.home.lan

# 3. Order it.
pvenode acme cert order
```

Proxmox renews it by itself, every day, once it has less than 30 days left. With a week's
`lifetime`, that is every day.

### Any other Linux machine

With `certbot`, while nothing else uses port 80 on the machine:

```bash
certbot certonly --standalone -n --agree-tos --register-unsafely-without-email \
  --server https://caddy.home.lan/acme/local/directory -d nas.home.lan
```

The certificate is then in `/etc/letsencrypt/live/nas.home.lan/`, and
`openssl x509 -in cert.pem -noout -issuer` there names **Caddy Local Authority - ECC
Intermediate**. Point the service at those files.

## If it doesn't work

| What you see | What to do |
|---|---|
| The order fails with a TLS or certificate error | The machine doesn't trust Caddy's root yet: [step 3.1](#3-prepare-the-services-machine) |
| The order can't find `caddy.home.lan` | The machine doesn't ask AdGuard: step 3.2 |
| The check fails, or the certificate names the wrong machine | The name answers Caddy, not the service: [one name can't be both](#one-name-cant-be-both). Or Caddy's machine doesn't ask AdGuard |
| The directory address gives a certificate error, or nothing | Caddy didn't read the new Caddyfile: step 2.3 |
| Caddy answers an order with `500` | `lifetime` is longer than `intermediate_lifetime` allows |
| The certificate lapses between renewals | `lifetime` was left at 12 hours |
| The browser still warns after the order worked | That device doesn't trust Caddy's root yet: [Trusting the certificate](certificate-setup.md) |
