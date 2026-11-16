[Docs](../README.md) › [Contributing](../README.md#contributing)

# Releasing

**Read this when** you are publishing a version: Loskai's two images to a registry, and the
tag to the repo. The first release has steps that later ones don't (marked *first time*).

An install pulls two images, `loskai` (the `Dockerfile`) and `loskai-caddy`
(`caddy/Dockerfile`), from `ghcr.io/simplysunde` unless `LOSKAI_REGISTRY` says otherwise
([deployment.md](../guides/deployment.md#images-and-releases)). `make release` builds both for
`amd64` and `arm64` (a Raspberry Pi), pushes them tagged with the version *and* `latest`, and
tags the commit `v<version>`.

## Before

- `main` is pushed to GitHub, and everything in the [checklist](../../CONTRIBUTING.md) passes.
- [`CHANGELOG.md`](../../CHANGELOG.md): the Unreleased section is moved under
  `## <version> — <date>`, and committed. The script refuses a tree with uncommitted changes,
  so an image is always a commit.
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

## 3. QEMU, for the platform this machine isn't (once per boot)

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

The script checks for this and says so if it's missing. `docker buildx ls` lists
`linux/arm64` among the platforms once it's in.

## 4. Build and push

```bash
make release VERSION=0.1.0
```

It makes a `docker-container` buildx builder called `loskai-release` the first time, builds
`loskai` and then `loskai-caddy`, and pushes each as `:0.1.0` and `:latest`. The `arm64` half of
`loskai` builds under emulation, the frontend's `npm ci` and build included, so expect it to
take far longer than a normal build.

It tags the commit `v0.1.0` only at the very end, so a run that fails partway can be rerun
with the same version. Pushing a version again overwrites its tags in the registry.

## 5. Push the tag

```bash
git push <github-remote> v0.1.0
```

Push it to every remote that has `main`.

## 6. Make the packages public (*first time*)

A package pushed to GHCR is private at first, and an install's `docker compose pull` fails
on a private one. For **each** of `loskai` and `loskai-caddy`:

1. Open `https://github.com/users/simplysunde/packages/container/<name>/settings`.
2. *Danger Zone* → *Change visibility* → **Public**, and type the name to confirm.
3. On the package's own page, **Connect repository** → `simplysunde/loskai`, so the
   package shows on the repo's page and the repo's README shows on the package's.

Visibility is kept from then on: later releases need neither step.

## 7. Check it as a stranger would

Logged out, so your own access doesn't hide a private package:

```bash
docker logout ghcr.io
docker buildx imagetools inspect ghcr.io/simplysunde/loskai:0.1.0         # linux/amd64 and linux/arm64
docker buildx imagetools inspect ghcr.io/simplysunde/loskai-caddy:0.1.0
```

Both must list the two platforms. A `denied` or `unauthorized` error means the package is
still private. Then run the README's *Quick start* on a machine that has never had Loskai: the
three lines, the first-run admin account, a recipe sync, and one route opened over HTTPS.
