[Docs](../README.md) › [Contributing](../README.md#contributing)

# Releasing

**Read this when** you are publishing a version: Loskai's two images to a registry, and the
tag to the repo. The first release has steps that later ones don't (marked *first time*).

An install pulls two images, `loskai` (the `Dockerfile`) and `loskai-caddy`
(`caddy/Dockerfile`), from `ghcr.io/simplysunde` unless `LOSKAI_REGISTRY` says otherwise
([deployment.md](../guides/deployment.md#images-and-releases)). `make release` builds both for
`amd64` and `arm64` (a Raspberry Pi), pushes them tagged with the version *and* `latest`, and
tags the commit `v<version>` on origin.

## Before

- Everything in the [checklist](../../CONTRIBUTING.md) passes.
- [`CHANGELOG.md`](../../CHANGELOG.md): the Unreleased section is moved under
  `## <version> — <date>`, committed and pushed.
- The animations match the UI ([demo.md](demo.md)).

## 1. A token that can push packages (*first time*)

GitHub's container registry takes a **classic** personal access token. Fine-grained tokens
can't push packages.

1. GitHub → *Settings* → *Developer settings* → *Personal access tokens* → *Tokens (classic)*
   → *Generate new token (classic)*.
2. Tick **`write:packages`**, which includes `read:packages`. Give it an expiry. If GitHub
   ticks `repo` along with it, that is GitHub's default for packages linked to a repo.
3. Copy the token. GitHub shows it once.

## 2. Log in to the registry

```bash
echo '<token>' | docker login ghcr.io -u simplysunde --password-stdin
```

`Login Succeeded` is the check. Without a credential helper, Docker keeps the token in
`~/.docker/config.json`, base64-encoded but readable by anyone who can read that file, so
`docker logout ghcr.io` after the release.

## 3. Release

```bash
make release VERSION=0.1.0
```

Before building it checks, and stops with what to do: the tree is clean, its commit is on
origin's `main`, the version isn't tagged, `CHANGELOG.md` has its heading, and you are
logged in to the registry. If this machine can't build `arm64` it installs QEMU for it,
which lasts until reboot. Then it lists what it will publish and asks **Publish? [y/N]**.

On a yes it builds `loskai` and then `loskai-caddy`, pushes each as `:0.1.0` and `:latest`,
tags the commit `v0.1.0` and pushes that tag to origin. The `arm64` half builds under
emulation, so expect it to take far longer than a normal build. The tag comes last, so a
run that fails partway leaves none and can be rerun with the same version; pushing a version
again overwrites its tags in the registry.

With a push mirror, sync it so the tag reaches GitHub too.

## 4. Make the packages public (*first time*)

A package pushed to GHCR is private at first, and an install's `docker compose pull` fails
on a private one. For **each** of `loskai` and `loskai-caddy`:

1. Open `https://github.com/users/simplysunde/packages/container/<name>/settings`.
2. *Danger Zone* → *Change visibility* → **Public**, and type the name to confirm.
3. The package's own page names `simplysunde/loskai` as its repository: the script writes
   it into the image, with a description. If it shows **Connect repository** instead,
   connect it there, so the package shows on the repo's page.

Visibility is kept from then on: later releases need neither step.

## 5. Check it as a stranger would

Logged out, so your own access doesn't hide a private package:

```bash
docker logout ghcr.io
docker buildx imagetools inspect ghcr.io/simplysunde/loskai:0.1.0         # linux/amd64 and linux/arm64
docker buildx imagetools inspect ghcr.io/simplysunde/loskai-caddy:0.1.0
```

Both must list the two platforms. A `denied` or `unauthorized` error means the package is
still private. Then run the README's *Quick start* on a machine that has never had Loskai: the
three lines, the first-run admin account, a recipe sync, and one route opened over HTTPS.
