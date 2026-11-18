[Docs](../README.md) › [Guides](../README.md#guides)

# Trusting the certificate

**Read this when** a browser warns that one of your names isn't secure, or a new device
joins your network.

Caddy makes the certificates for your names itself, so there is no domain to buy. Your
devices don't know Caddy yet: each trusts Caddy's root certificate once, and then every name
opens without a warning, the ones you add later too.

## Trust the certificate on a device

1. On the device, open `http://<docker-host>:8080/certificate`. Use the address, not a
   name: the device doesn't trust the names yet. No login is needed.
2. Under **Download the certificate**, click **caddy-root.crt**. The browser may warn that
   you are installing something: the file is a certificate, not a program.
3. Under **Add it to your trust store**, the tab for this device is picked. Follow its steps:
   - **Windows:** open the file, **Install Certificate**, **Local Machine**, then **Place all
     certificates in the following store** › **Trusted Root Certification Authorities**.
   - **macOS:** run the command the tab shows, in Terminal. It asks for your password.
   - **iPhone and iPad:** open the file, then switch it on under Settings › General › About ›
     Certificate Trust Settings. The steps are on the **macOS** tab.
   - **Linux:** run the commands for your distribution. Chrome and Chromium keep a store of
     their own on Linux: the tab has the command for it too.
   - **Firefox**, on any system, keeps its own store as well: Settings › Privacy & Security ›
     Certificates › View Certificates › Authorities › Import. Tick "Trust this CA to identify
     websites".
4. Open one of your names over `https://`. The browser shows a padlock. A tab that was open
   before needs a reload.

If the page says **Nothing to install.**, Caddy doesn't use certificates of its own and your
names are trusted already. If it says **Couldn't reach Caddy to fetch the root certificate**:
[A module shows unreachable](troubleshooting.md#a-module-shows-unreachable).

## When Loskai is down

Caddy has the same page itself, at `http://<caddy-ip>/`: the Caddy LXC's address, or the
Docker host's when Caddy runs beside Loskai. Use the address: a name there is sent on to
HTTPS.

If its **caddy-root.crt** isn't found, Caddy hasn't made its root certificate yet. It does the
first time it serves a name over HTTPS: open one of your names once, then try again.

## Hiding the tab

**Settings** › **Network** › **Certificate page in the sidebar** decides who sees the
**Certificate** tab:

- **Everyone — including logged-out visitors**, the default;
- **Only once logged in**;
- **Never — using publicly trusted certs**.

`CERTIFICATE_TAB` in `.env` sets the same, as `public`, `admin` or `hidden`. Only the link
moves: `/certificate` opens for everyone, since the certificate is public. Without Caddy
there is no tab.

## Update Caddy's page

With Caddy beside Loskai, the page comes with Caddy's image: updating Loskai updates it.

A Caddy LXC fetched the page once, when it was made. To update it, in the LXC:

```bash
REPO_RAW_BASE=https://raw.githubusercontent.com/simplysunde/loskai/main
curl -fsSL "$REPO_RAW_BASE/caddy/setup/index.html" -o /srv/setup/index.html
```

Caddy reads the file fresh, so nothing needs restarting.

---

**Next:** a backend's own page, like Proxmox on `:8006`, warns too?
[Backend certificates →](backend-certificates.md)
